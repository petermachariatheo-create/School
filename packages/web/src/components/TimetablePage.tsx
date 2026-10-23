import { useMemo, useState } from "react";
import type { ReplicaRecord } from "../data/db.ts";
import { useLabels, useRecords } from "../app/hooks.ts";
import { exportCsv, downloadText } from "../app/export.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/icons.tsx";
import { TimetableWeek } from "./TimetableWeek.tsx";

/**
 * The timetables.
 *
 * Two people want a timetable for different reasons: a student wants the
 * classes they have today, and a teacher wants the classes they are
 * teaching. Both are answered by the same lessons, so the page offers the
 * same week, looked at by class or by teacher.
 *
 * The classes are listed as collapsed options: a school has many classes
 * and a person wants one of them, so the list stays closed until it is
 * asked for.
 */

export interface TimetablePageProps {
  /** The classes whose weeks can be shown. */
  readonly classes: readonly ReplicaRecord[];
}

export function TimetablePage({ classes }: TimetablePageProps): React.ReactNode {
  const { records: lessons, loading } = useRecords("timetable");
  const labels = useLabels(["class"]);

  const [openClass, setOpenClass] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<string>("");

  const teachers = useMemo(() => {
    const names = new Set<string>();
    for (const lesson of lessons) {
      const name = lesson.data["teacherName"];
      if (typeof name === "string" && name !== "") {
        names.add(name);
      }
    }
    return [...names].sort();
  }, [lessons]);

  const byClass = useMemo(() => {
    const grouped = new Map<string, ReplicaRecord[]>();
    for (const lesson of lessons) {
      if (teacher !== "" && lesson.data["teacherName"] !== teacher) {
        continue;
      }
      const key = String(lesson.data["classId"] ?? "");
      const list = grouped.get(key) ?? [];
      list.push(lesson);
      grouped.set(key, list);
    }
    return grouped;
  }, [lessons, teacher]);

  const shown = useMemo(
    () => classes.filter((entry) => (byClass.get(entry.id) ?? []).length > 0),
    [classes, byClass],
  );

  return (
    <div className="timetable-page">
      <div className="timetable-controls">
        <label className="timetable-control">
          <span className="timetable-control__label">Teacher</span>
          <select
            value={teacher}
            onChange={(event) => setTeacher(event.target.value)}
            aria-label="Choose a teacher"
          >
            <option value="">Every teacher</option>
            {teachers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="timetable-controls__summary">
          {teacher === "" ? "Every class in the school" : `The classes ${teacher} teaches`}
        </p>

        <Button
          variant="quiet"
          icon="download"
          onClick={() => {
            const csv = exportCsv("timetable", lessons);
            const stamp = new Date().toISOString().slice(0, 10);
            downloadText(`timetables-${stamp}.csv`, csv, "text/csv;charset=utf-8");
          }}
        >
          Export CSV
        </Button>
      </div>
      {shown.length === 0 && !loading ? (
        <div className="empty">
          <p>There are no classes with lessons yet.</p>
        </div>
      ) : (
        <div className="timetable-classes">
          {shown.map((entry) => {
            const classLessons = byClass.get(entry.id) ?? [];
            const open = openClass === entry.id;
            return (
              <section className="timetable-class" key={entry.id}>
                <button
                  type="button"
                  className="timetable-class__head"
                  aria-expanded={open}
                  onClick={() => setOpenClass(open ? null : entry.id)}
                >
                  <Icon name="chevron-right" size={16} className="timetable-class__chevron" />
                  <span className="timetable-class__name">
                    {String(entry.data["name"] ?? entry.id)}
                  </span>
                  <span className="timetable-class__detail">
                    {[
                      typeof entry.data["teacherName"] === "string"
                        ? entry.data["teacherName"]
                        : null,
                      typeof entry.data["room"] === "string" ? entry.data["room"] : null,
                      `${classLessons.length} lesson${classLessons.length === 1 ? "" : "s"}`,
                    ]
                      .filter((part): part is string => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </button>

                {open && (
                  <div className="timetable-class__body">
                    <TimetableWeek
                      lessons={classLessons}
                      labels={labels}
                      loading={loading}
                      emptyMessage="This class has no lessons yet."
                    />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
