import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { registry, ulid } from "@school/shared";
import { ApiClient } from "../api/client.ts";
import { getDatabase, type OutboxEntry } from "../data/db.ts";
import { Outbox } from "../data/outbox.ts";
import { Replica } from "../data/replica.ts";
import { SyncEngine, describeError, type SyncStatus } from "../sync/engine.ts";
import { DEFAULT_SETTINGS, readSettings, writeSettings, type SchoolSettings } from "./settings.ts";
import type { ServerInfo } from "./server.ts";

/**
 * Application state.
 *
 * The store owns the three pieces of machinery the interface needs: the
 * local replica, the durable outbox and the sync engine. Components read
 * from the replica through hooks, so a screen never waits on the network.
 */

export interface StoreValue {
  readonly ready: boolean;
  readonly status: SyncStatus;
  readonly error: string | null;
  /** Bumped whenever the replica changes, so views can re-read it. */
  readonly version: number;
  /** The settings that belong to this device. */
  readonly settings: SchoolSettings;
  /** What the server reports about itself, once it has been reached. */
  readonly serverInfo: ServerInfo | null;
  syncNow(): Promise<void>;
  save(entityType: string, id: string | null, patch: Record<string, unknown>): Promise<void>;
  remove(entityType: string, id: string): Promise<void>;
  resetFromServer(): Promise<void>;
  clearError(): void;
  updateSettings(patch: Partial<SchoolSettings>): Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (value === null) {
    throw new Error("useStore must be used inside <StoreProvider>");
  }
  return value;
}

/** How often the client retries while it believes the server is reachable. */
const SYNC_INTERVAL_MS = 30_000;

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SchoolSettings>(DEFAULT_SETTINGS);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [status, setStatus] = useState<SyncStatus>({
    syncing: false,
    online: true,
    cursor: 0,
    pending: 0,
    failed: 0,
    lastSyncAt: null,
    lastError: null,
    serverCursor: null,
  });

  const engineRef = useRef<SyncEngine | null>(null);
  const replicaRef = useRef<Replica | null>(null);
  const outboxRef = useRef<Outbox | null>(null);
  const apiRef = useRef<ApiClient | null>(null);

  const bump = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  const refreshStatus = useCallback(async () => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    const next = await engine.status();
    setStatus((current) => ({ ...next, syncing: current.syncing }));
  }, []);

  /**
   * Ask the server where it can be reached.
   *
   * This is what lets the interface tell somebody which address to type into
   * a phone, instead of leaving them to work it out.
   */
  const refreshServerInfo = useCallback(async () => {
    const api = apiRef.current;
    if (api === null) {
      return;
    }
    try {
      const meta = await api.meta();
      setServerInfo({
        port: meta.network?.port ?? 8080,
        securePort: meta.network?.securePort ?? null,
        addresses: meta.network?.addresses ?? [],
      });
    } catch {
      // The server is not reachable. The interface keeps what it had.
    }
  }, []);

  // ---- start-up ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      const db = await getDatabase();
      const replica = new Replica(db);
      const outbox = new Outbox(db);
      const api = new ApiClient({ baseUrl: import.meta.env["VITE_API_BASE_URL"] ?? "" });
      const engine = new SyncEngine({ api, replica, outbox });

      replicaRef.current = replica;
      outboxRef.current = outbox;
      engineRef.current = engine;
      apiRef.current = api;

      const stored = await readSettings();
      if (cancelled) {
        return;
      }
      setSettings(stored);
      setReady(true);
      await refreshStatus();
      void refreshServerInfo();
      // Try to catch up immediately, but do not block the first paint on it.
      void syncOnce(engine, refreshStatus, bump, setError);
    };

    void start();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- periodic and event-driven sync -----------------------------------

  const syncNow = useCallback(async () => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    await syncOnce(engine, refreshStatus, bump, setError);
  }, [bump, refreshStatus]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    const onOnline = (): void => {
      void syncNow();
    };
    window.addEventListener("online", onOnline);

    const timer = window.setInterval(() => {
      void syncNow();
    }, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [ready, syncNow]);

  // ---- mutations --------------------------------------------------------

  const save = useCallback(
    async (entityType: string, id: string | null, patch: Record<string, unknown>) => {
      const replica = replicaRef.current;
      const outbox = outboxRef.current;
      if (replica === null || outbox === null) {
        return;
      }

      const now = new Date().toISOString();
      const entityId = id ?? ulid();
      const existing = id === null ? null : await replica.get(entityType, entityId);

      // Only the fields that actually changed are sent, so a conflict is
      // resolved per field rather than per record.
      const changed: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(patch)) {
        const previous = existing?.data[field];
        if (JSON.stringify(previous ?? null) !== JSON.stringify(value ?? null)) {
          changed[field] = value;
        }
      }

      if (Object.keys(changed).length === 0) {
        return;
      }

      // The replica is the client's own copy of the truth, so it holds the
      // values the server works out as well: an invoice edited offline
      // shows the total it will have, not the total it had.
      const local = { ...changed };
      const derived = registry.applyDerived(entityType, {
        ...existing?.data,
        ...changed,
      });
      for (const entry of registry.derivedFields(entityType)) {
        const value = derived[entry.field];
        if (value !== undefined) {
          local[entry.field] = value;
        }
      }

      await replica.applyLocalEdit(entityType, entityId, local, {
        created: existing === null,
        now,
      });

      const entry: OutboxEntry = {
        opId: `op-${ulid()}`,
        entityType,
        entityId,
        operation: "upsert",
        patch: changed,
        baseRevision: existing?.revision ?? 0,
        clientTime: now,
        createdAt: now,
        attempts: 0,
        status: "pending",
        lastError: null,
      };
      await outbox.enqueue(entry);

      bump();
      await refreshStatus();
      void syncNow();
    },
    [bump, refreshStatus, syncNow],
  );

  const remove = useCallback(
    async (entityType: string, id: string) => {
      const replica = replicaRef.current;
      const outbox = outboxRef.current;
      if (replica === null || outbox === null) {
        return;
      }

      const existing = await replica.get(entityType, id);
      if (existing === null) {
        return;
      }

      const now = new Date().toISOString();
      await replica.applyLocalDelete(entityType, id, now);

      const entry: OutboxEntry = {
        opId: `op-${ulid()}`,
        entityType,
        entityId: id,
        operation: "delete",
        patch: null,
        baseRevision: existing.revision,
        clientTime: now,
        createdAt: now,
        attempts: 0,
        status: "pending",
        lastError: null,
      };
      await outbox.enqueue(entry);

      bump();
      await refreshStatus();
      void syncNow();
    },
    [bump, refreshStatus, syncNow],
  );

  const resetFromServer = useCallback(async () => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    await engine.resetFromServer();
    bump();
    await refreshStatus();
  }, [bump, refreshStatus]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<SchoolSettings>) => {
    await writeSettings(patch);
    setSettings(await readSettings());
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      status,
      error,
      version,
      settings,
      serverInfo,
      syncNow,
      save,
      remove,
      resetFromServer,
      clearError,
      updateSettings,
    }),
    [
      ready,
      status,
      error,
      version,
      settings,
      serverInfo,
      syncNow,
      save,
      remove,
      resetFromServer,
      clearError,
      updateSettings,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/**
 * Run one sync cycle and fold the result into the interface state.
 *
 * A failure is reported to the user but never loses data: the outbox keeps
 * the change and the next cycle retries it.
 */
async function syncOnce(
  engine: SyncEngine,
  refreshStatus: () => Promise<void>,
  bump: () => void,
  setError: (message: string | null) => void,
): Promise<void> {
  try {
    await engine.sync();
    setError(null);
  } catch (error) {
    setError(describeError(error));
  } finally {
    await refreshStatus();
    bump();
  }
}
