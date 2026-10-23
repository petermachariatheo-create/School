import type { ReplicaRecord } from "../data/db.ts";

/**
 * A week of lessons.
 *
 * The week is the shape a school thinks in: five days, and the lessons that
 * fall in them. It is drawn as a grid, the way a timetable is drawn on a
 * wall: the days down the left, the times across the top, and each lesson
 * in the slot it belongs to.
 *
 * Each lesson says when it is, what it is, who teaches it and where. A
 * student reads that to answer "what do I have today"; a teacher reads it
 * to answer "what am I teaching".
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

const DAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
};

/** The day it is today, in the words the week uses. */
function today(): string {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()] ?? "";
}

export interface TimetableWeekProps {
  /** The lessons of the week. */
  readonly lessons: readonly ReplicaRecord[];
  /** The names of the records the lessons point at, by identifier. */
  readonly labels?: ReadonlyMap<string, string>;
  /** What to say when there is nothing in the week. */
  readonly emptyMessage: string;
  /** True while the week is being read. */
  readonly loading?: boolean;
}

export function TimetableWeek({
  lessons,
  labels = new Map(),
  emptyMessage,
  loading = false,
}: TimetableWeekProps): React.ReactNode {
  if (loading) {
    return <p className="empty">Loading the timetable…</p>;
  }

  if (lessons.length === 0) {
    return (
      <div className="empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  // The times across the top are the ones the lessons actually use, so a
  // class that meets twice a week does not get a grid of empty slots.
  const times = [
    ...new Set(lessons.map((lesson) => String(lesson.data["startTime"] ?? ""))),
  ].sort();

  const slot = new Map<string, ReplicaRecord[]>();
  for (const lesson of lessons) {
    const key = `${String(lesson.data["day"] ?? "")}@${String(lesson.data["startTime"] ?? "")}`;
    const list = slot.get(key) ?? [];
    list.push(lesson);
    slot.set(key, list);
  }
  for (const list of slot.values()) {
    list.sort(
      (a, b) =>
        String(a.data["startTime"]).localeCompare(String(b.data["startTime"])) ||
        String(a.data["subject"]).localeCompare(String(b.data["subject"])),
    );
  }

  const currentDay = today();

  return (
    <div className="week-scroll">
      <div
        className="week"
        style={{ gridTemplateColumns: `auto repeat(${times.length}, minmax(9rem, 1fr))` }}
      >
        <div className="week__corner" aria-hidden="true" />
        {times.map((time) => (
          <div className="week__time" key={time}>
            {time}
          </div>
        ))}

        {DAYS.map((day) => (
          <div className="week__row" key={day}>
            <div className={day === currentDay ? "week__day week__day--today" : "week__day"}>
              <span className="week__day-name">{DAY_LABELS[day] ?? day}</span>
              {day === currentDay && <span className="week__today">Today</span>}
            </div>

            {times.map((time) => {
              const here = slot.get(`${day}@${time}`) ?? [];
              return (
                <div className="week__cell" key={`${day}-${time}`}>
                  {here.map((lesson) => {
                    const classId = lesson.data["classId"];
                    const className = typeof classId === "string" ? labels.get(classId) : undefined;
                    return (
                      <div className="lesson" key={lesson.id}>
                        <div className="lesson__head">
                          <span className="lesson__time">
                            {String(lesson.data["startTime"] ?? "")}–
                            {String(lesson.data["endTime"] ?? "")}
                          </span>
                          <span className="lesson__day">{DAY_LABELS[day] ?? day}</span>
                        </div>
                        <span className="lesson__subject">
                          {String(lesson.data["subject"] ?? "")}
                        </span>
                        <span className="lesson__detail">
                          {[
                            className,
                            typeof lesson.data["teacherName"] === "string"
                              ? lesson.data["teacherName"]
                              : null,
                            typeof lesson.data["room"] === "string" ? lesson.data["room"] : null,
                          ]
                            .filter((part): part is string => part !== null && part !== "")
                            .join(" · ")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
