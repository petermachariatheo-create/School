import { useMemo, useState, useRef } from "react";
import type { ReplicaRecord } from "../data/db.ts";
import {
  listEntities,
  recordLabel,
  tableColumns,
  relatedTypes,
  type EntityMeta,
} from "../app/fields.ts";
import {
  entityGroups,
  descriptionFor,
  headingFor,
  iconFor,
  cardSpecFor,
  listViewFor,
  PROFILE_TYPES,
} from "../app/catalog.ts";
import { downloadText, exportCsv } from "../app/export.ts";
import { useLabels, useOutbox, useRecords } from "../app/hooks.ts";
import {
  editPlace,
  listPlace,
  newPlace,
  overlayPlace,
  recordPlace,
  useNavigation,
} from "../app/place.ts";
import { useStore } from "../app/store.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/icons.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import { ConnectPanel } from "./ConnectPanel.tsx";
import { ImportDialog } from "./ImportDialog.tsx";
import { RecordEditor } from "./form/RecordEditor.tsx";
import { RecordProfile } from "./form/RecordProfile.tsx";
import { RecordTable } from "./RecordTable.tsx";
import { ConfirmDestructiveAction } from "./form/ConfirmDestructiveAction.tsx";
import { RecordGrid } from "./RecordGrid.tsx";
import { TimetablePage } from "./TimetablePage.tsx";
import { Welcome } from "./Welcome.tsx";
import { sortPeople } from "../app/people.ts";

/**
 * The application shell.
 *
 * The shell is deliberately small: a grouped list of entity types, a table
 * of the records of the selected type, and a page of its own for editing
 * one record. Every screen reads from the local replica, so the whole
 * application works with the network switched off.
 */

const ENTITIES = listEntities();

export function App(): React.ReactNode {
  const {
    ready,
    status,
    error,
    syncNow,
    clearError,
    settings,
    serverInfo,
    updateSettings,
    resetFromServer,
  } = useStore();
  const { place, show, back } = useNavigation(ENTITIES[0]?.type ?? "student");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showOutbox, setShowOutbox] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" } | null>(null);

  const entity = useMemo<EntityMeta>(
    () => ENTITIES.find((candidate) => candidate.type === place.entityType) ?? ENTITIES[0]!,
    [place.entityType],
  );

  const { records, loading } = useRecords(entity.type);
  const outbox = useOutbox();

  const columns = useMemo(() => tableColumns(entity), [entity]);
  const labels = useLabels(relatedTypes(columns));

  const isStudent = entity.type === "student";
  const cardSpec = cardSpecFor(entity.type);
  const listView = listViewFor(entity.type);

  // The timetables page shows the week of every class, so it needs the
  // classes to choose from.
  const { records: classRecords } = useRecords("class");

  const columnRenderers = useMemo(() => {
    if (!isStudent) return {};
    return {
      status: (record: ReplicaRecord) => {
        const value = record.data.status;
        return <StatusBadge status={typeof value === "string" ? value : null} />;
      },
      gender: (record: ReplicaRecord) => {
        const gender = record.data.gender;
        if (typeof gender !== "string" || gender === "") {
          return <span className="muted">—</span>;
        }
        return (
          <span className="gender-badge" title={gender} aria-label={gender}>
            {gender.charAt(0).toUpperCase()}
          </span>
        );
      },
    };
  }, []);

  const handleSort = (field: string): void => {
    if (sort?.field === field) {
      setSort({ field, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      setSort({ field, direction: "asc" });
    }
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") {
      return records;
    }
    return records.filter((record) =>
      recordLabel(entity.type, record.data).toLowerCase().includes(needle),
    );
  }, [records, search, entity.type]);

  const sortedRecords = useMemo(() => {
    if (!sort) return filtered;
    return sortPeople(
      filtered as unknown as { data: Record<string, unknown> }[],
      sort.field,
      sort.direction,
    ) as unknown as ReplicaRecord[];
  }, [filtered, sort]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => entityGroups(ENTITIES), []);

  const chooseEntity = (type: string): void => {
    show(listPlace(type));
    setSearch("");
    setPage(1);
    setSort(null);
  };

  const openRecord = (record: ReplicaRecord | null, type: string): void => {
    if (record === null) {
      show(newPlace(type));
      return;
    }
    // A type with a profile is read before it is changed; the rest open
    // straight into the form, as they always have.
    show(PROFILE_TYPES.includes(type) ? recordPlace(type, record.id) : editPlace(type, record.id));
  };

  const handleExport = (): void => {
    const csv = exportCsv(entity.type, records);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`${entity.restPath}-${stamp}.csv`, csv, "text/csv;charset=utf-8");
  };

  if (!ready) {
    return (
      <div className="boot">
        <p>Opening the local data store…</p>
      </div>
    );
  }

  // A device that has not been set up yet gets the welcome screen, so that
  // somebody who has never used the system does not have to work out what
  // to do with an empty table of students.
  if (!settings.setupComplete) {
    return (
      <>
        <Welcome
          info={serverInfo}
          onShowConnect={() => show(overlayPlace(entity.type, "connect"))}
          onComplete={(schoolName) => {
            void updateSettings({ schoolName, setupComplete: true });
          }}
        />
        {place.overlay === "connect" && <ConnectPanel info={serverInfo} onClose={back} />}
      </>
    );
  }

  // The record on show is looked up in the replica rather than kept in the
  // history, so that a record that has been changed on the server is shown
  // as it is now rather than as it was when the page was opened.
  const openRecordId = place.recordId;
  const found =
    openRecordId === null ? undefined : records.find((record) => record.id === openRecordId);
  const editing =
    place.creating || found !== undefined
      ? { entity, record: place.creating ? null : (found ?? null) }
      : null;

  // A record of a type with a profile is read before it is changed. The
  // rest open straight into the form, as they always have.
  const profile =
    found !== undefined && !place.editing && PROFILE_TYPES.includes(entity.type) ? found : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true" />
          <div>
            <span className="topbar__school">{settings.schoolName}</span>
            <p className="topbar__subtitle">
              {status.online ? "Connected to the school server" : "Working offline"}
            </p>
          </div>
        </div>

        <div className="topbar__status">
          <span className="topbar__cursor" title="Changes applied from the server">
            cursor {status.cursor}
          </span>

          <span
            className={
              status.pending > 0
                ? "sync-indicator sync-indicator--pending"
                : "sync-indicator sync-indicator--synced"
            }
            role="status"
            aria-label={
              status.pending > 0
                ? `${status.pending} change${status.pending === 1 ? "" : "s"} waiting to be sent`
                : "All changes synced"
            }
            title={
              status.pending > 0
                ? `${status.pending} change${status.pending === 1 ? "" : "s"} waiting to be sent`
                : "All changes synced"
            }
          >
            {status.pending > 0 && <span className="sync-indicator__count">{status.pending}</span>}
          </span>

          {status.failed > 0 && (
            <span className="pill pill--deleted" title="Changes the server refused">
              {status.failed} refused
            </span>
          )}

          <span
            className="topbar__time"
            title={
              status.lastSyncAt === null
                ? "This device has not synced yet"
                : `Last synced at ${new Date(status.lastSyncAt).toLocaleTimeString()}`
            }
          >
            {status.lastSyncAt === null
              ? "never synced"
              : new Date(status.lastSyncAt).toLocaleTimeString()}
          </span>

          <Button variant="primary" icon="sync" onClick={() => void syncNow()}>
            {status.syncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button
            variant="quiet"
            icon="device"
            onClick={() => show(overlayPlace(entity.type, "connect"))}
            title="Show the address another device can use"
          >
            Add device
          </Button>
          <Button variant="quiet" icon="list" onClick={() => setShowOutbox((current) => !current)}>
            Outbox ({outbox.length})
          </Button>
        </div>
      </header>

      {!status.online && (
        <div className="banner banner--offline" role="status">
          <Icon name="offline" size={16} />
          <span>
            Working offline. Changes are kept on this device and sent to the school server when the
            connection comes back.
          </span>
        </div>
      )}

      {error !== null && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
          <Button variant="quiet" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="layout">
        <nav className="sidebar" aria-label="Entity types">
          <div className="sidebar__types">
            {groups.map((entry) => (
              <div className="sidebar__group" key={entry.group.id}>
                <h2 className="sidebar__title">{entry.group.label}</h2>
                <ul>
                  {entry.types.map((type) => {
                    const candidate = ENTITIES.find((item) => item.type === type);
                    if (candidate === undefined) {
                      return null;
                    }
                    const active = candidate.type === entity.type && editing === null;
                    return (
                      <li key={candidate.type}>
                        <button
                          type="button"
                          className={active ? "navlink navlink--active" : "navlink"}
                          aria-current={active ? "page" : undefined}
                          onClick={() => chooseEntity(candidate.type)}
                        >
                          <Icon name={iconFor(candidate.type)} size={16} />
                          <span>{candidate.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {showOutbox && (
            <div className="outbox">
              <h2>Outbox</h2>
              {outbox.length === 0 ? (
                <p className="empty">Nothing is waiting to be sent.</p>
              ) : (
                <ul>
                  {outbox.map((entry) => (
                    <li key={entry.opId} className={`outbox__item outbox__item--${entry.status}`}>
                      <span className="outbox__op">
                        {entry.operation} {entry.entityType}
                      </span>
                      {entry.status === "failed" && entry.lastError !== null && (
                        <span className="outbox__error">{entry.lastError}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </nav>

        <main className="content">
          {editing === null ? (
            <>
              <div className="page-head">
                <div className="page-head__text">
                  <h1 className="page-head__title">{headingFor(entity.label)}</h1>
                  {descriptionFor(entity.type) !== "" && (
                    <p className="page-head__lede">{descriptionFor(entity.type)}</p>
                  )}
                  <span className="page-head__count">
                    {search.trim() === ""
                      ? `${records.length} on this device`
                      : `${sortedRecords.length} of ${records.length} on this device`}
                  </span>
                </div>

                <div className="page-head__actions">
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() => openRecord(null, entity.type)}
                  >
                    New {entity.label.toLowerCase()}
                  </Button>
                </div>
              </div>

              {listView !== "week" && (
                <div className="toolbar">
                  <div className="toolbar__search">
                    <Icon name="search" size={16} />
                    <input
                      type="search"
                      placeholder={`Search ${entity.label.toLowerCase()}s`}
                      value={search}
                      aria-label={`Search ${entity.label.toLowerCase()}s`}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                  <span className="spacer" />
                  <div className="toolbar__controls">
                    {cardSpec !== null && (
                      <div className="view-toggle" role="group" aria-label="How to show the list">
                        <button
                          type="button"
                          className={
                            view === "grid"
                              ? "view-toggle__button view-toggle__button--on"
                              : "view-toggle__button"
                          }
                          aria-pressed={view === "grid"}
                          title="Show as cards"
                          onClick={() => setView("grid")}
                        >
                          <Icon name="grid" size={15} />
                          <span className="visually-hidden">Cards</span>
                        </button>
                        <button
                          type="button"
                          className={
                            view === "list"
                              ? "view-toggle__button view-toggle__button--on"
                              : "view-toggle__button"
                          }
                          aria-pressed={view === "list"}
                          title="Show as a table"
                          onClick={() => setView("list")}
                        >
                          <Icon name="list" size={15} />
                          <span className="visually-hidden">Table</span>
                        </button>
                      </div>
                    )}

                    <div className="toolbar__menu" ref={menuRef}>
                      <Button
                        variant="quiet"
                        icon="more"
                        onClick={() => setMenuOpen(!menuOpen)}
                        aria-expanded={menuOpen}
                        aria-haspopup="true"
                        aria-label="More actions"
                        title="More actions"
                      />
                      {menuOpen && (
                        <div className="toolbar__dropdown">
                          <button
                            className="dropdown__item"
                            onClick={() => {
                              show(overlayPlace(entity.type, "import"));
                              setMenuOpen(false);
                            }}
                          >
                            <Icon name="upload" size={16} />
                            <span>Import CSV</span>
                          </button>
                          <button
                            className="dropdown__item"
                            onClick={() => {
                              handleExport();
                              setMenuOpen(false);
                            }}
                          >
                            <Icon name="download" size={16} />
                            <span>Export CSV</span>
                          </button>
                          <button
                            className="dropdown__item"
                            onClick={() => {
                              setMenuOpen(false);
                              setResetting(true);
                            }}
                          >
                            <Icon name="sync" size={16} />
                            <span>Reset local data</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {loading ? (
                <p className="empty">Loading…</p>
              ) : listView === "week" ? (
                <TimetablePage classes={classRecords} />
              ) : cardSpec !== null && view === "grid" ? (
                <RecordGrid
                  entityType={entity.type}
                  label={headingFor(entity.label)}
                  records={sortedRecords}
                  page={page}
                  onPageChange={setPage}
                  onSelect={(record) => openRecord(record, entity.type)}
                  emptyMessage={
                    search.trim() === ""
                      ? `No ${entity.label.toLowerCase()}s on this device yet. Add one, or sync to download the school's data.`
                      : `No ${entity.label.toLowerCase()}s match “${search.trim()}”.`
                  }
                />
              ) : (
                <RecordTable
                  entity={entity}
                  records={sortedRecords}
                  page={page}
                  onPageChange={setPage}
                  emptyMessage={
                    search.trim() === ""
                      ? `No ${entity.label.toLowerCase()} records on this device yet. Add one, or sync to download the school's data.`
                      : `No ${entity.label.toLowerCase()} records match “${search.trim()}”.`
                  }
                  onSelect={(record) => openRecord(record, entity.type)}
                  columns={columns}
                  labels={labels}
                  columnRenderers={columnRenderers}
                  sort={sort}
                  onSort={handleSort}
                />
              )}
            </>
          ) : profile !== null ? (
            <RecordProfile
              key={profile.id}
              entityType={entity.type}
              record={profile}
              onEdit={() => show(editPlace(entity.type, profile.id))}
              onClose={back}
              onOpen={(type, id) => show(recordPlace(type, id))}
            />
          ) : (
            <RecordEditor
              key={editing.record?.id ?? `new-${editing.entity.type}`}
              entityType={entity.type}
              record={editing.record}
              onClose={back}
            />
          )}
        </main>
      </div>

      {place.overlay === "import" && (
        <ImportDialog entity={entity} onClose={back} onImported={() => void syncNow()} />
      )}

      {place.overlay === "connect" && <ConnectPanel info={serverInfo} onClose={back} />}

      <ConfirmDestructiveAction
        open={resetting}
        subject="the data on this device"
        consequence="Everything on this device is discarded and the school's data is downloaded again. Changes that have not reached the school yet are lost."
        onCancel={() => setResetting(false)}
        onConfirm={() => {
          setResetting(false);
          void resetFromServer().then(() => void syncNow());
        }}
      />
    </div>
  );
}
