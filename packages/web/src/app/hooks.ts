import { useEffect, useState } from "react";
import { getDatabase, type OutboxEntry, type ReplicaRecord } from "../data/db.ts";
import { Outbox } from "../data/outbox.ts";
import { Replica } from "../data/replica.ts";
import { recordLabel } from "./fields.ts";
import { useStore } from "./store.tsx";

/**
 * Read the local replica.
 *
 * The hook reads from IndexedDB rather than from the server, so the
 * interface renders the same data whether or not the device is connected.
 * It re-reads whenever the store reports that the replica changed.
 */
export function useRecords(entityType: string): {
  records: ReplicaRecord[];
  loading: boolean;
} {
  const { version } = useStore();
  const [records, setRecords] = useState<ReplicaRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const db = await getDatabase();
      const replica = new Replica(db);
      const rows = await replica.list(entityType);
      if (!cancelled) {
        setRecords(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, version]);

  return { records, loading };
}

/** Read the durable outbox. */
export function useOutbox(): OutboxEntry[] {
  const { version } = useStore();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getDatabase();
      const outbox = new Outbox(db);
      const rows = await outbox.all();
      if (!cancelled) {
        setEntries(rows);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  return entries;
}

/**
 * The records that point at a record.
 *
 * A student's guardians are held on the link between them, and the client's
 * replica holds the link, so the profile of a student can say who the
 * guardians are without asking the server.
 *
 * A record of a type points at the record through a field named after it:
 * "student_guardian" points at a student through "studentId". The rule is
 * the same for every type.
 */
export function useRelatedRecords(
  entityType: string,
  recordId: string,
  types: readonly string[],
): { type: string; records: ReplicaRecord[] }[] {
  const { version } = useStore();
  const [related, setRelated] = useState<{ type: string; records: ReplicaRecord[] }[]>([]);
  const wanted = types.join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getDatabase();
      const replica = new Replica(db);
      const found: { type: string; records: ReplicaRecord[] }[] = [];
      for (const type of wanted === "" ? [] : wanted.split(",")) {
        const field = `${entityType}Id`;
        const records = (await replica.list(type)).filter(
          (record) => record.data[field] === recordId,
        );
        found.push({ type, records });
      }
      if (!cancelled) {
        setRelated(found);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, entityType, recordId, version]);

  return related;
}

/**
 * The lessons of a record's week.
 *
 * A class's lessons are its own. A student's are the lessons of the classes
 * they are enrolled in, which is what "what do I have today" means.
 */
export function useTimetable(
  entityType: string,
  recordId: string | null,
): { lessons: ReplicaRecord[]; loading: boolean } {
  const { version } = useStore();
  const [lessons, setLessons] = useState<ReplicaRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getDatabase();
      const replica = new Replica(db);
      const all = await replica.list("timetable");
      let found: ReplicaRecord[] = [];

      if (entityType === "class") {
        found = all.filter((lesson) => lesson.data["classId"] === recordId);
      } else if (entityType === "student") {
        const enrolments = await replica.list("enrollment");
        const classes = new Set(
          enrolments
            .filter((enrolment) => enrolment.data["studentId"] === recordId)
            .map((enrolment) => String(enrolment.data["classId"])),
        );
        found = all.filter((lesson) => classes.has(String(lesson.data["classId"])));
      }

      if (!cancelled) {
        setLessons(found);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, recordId, version]);

  return { lessons, loading };
}

export function useLabels(types: readonly string[]): ReadonlyMap<string, string> {
  const { version } = useStore();
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
  const wanted = types.join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getDatabase();
      const replica = new Replica(db);
      const found = new Map<string, string>();
      for (const type of wanted === "" ? [] : wanted.split(",")) {
        for (const record of await replica.list(type)) {
          found.set(record.id, recordLabel(type, record.data));
        }
      }
      if (!cancelled) {
        setLabels(found);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, version]);

  return labels;
}
