import * as z from "zod";
import {
  AttendanceStatus,
  EntityId,
  EntityMeta,
  EnrollmentStatus,
  IsoDate,
  IsoDateTime,
} from "./common.ts";

/**
 * Academic structure: classes, enrolments, attendance and assessment.
 */

/** A teaching group. Named `SchoolClass` to avoid colliding with the `class` keyword. */
export const SchoolClass = EntityMeta.extend({
  name: z.string().min(1).max(120),
  /** e.g. "Grade 5", "Form 2". */
  gradeLevel: z.string().min(1).max(40),
  /** Academic year in `YYYY/YYYY` form, e.g. `2026/2027`. */
  academicYear: z.string().regex(/^\d{4}\/\d{4}$/, "Expected academic year as YYYY/YYYY"),
  teacherName: z.string().max(120).nullable().default(null),
  /** Maximum number of students, used for capacity reporting. */
  capacity: z.int().min(1).nullable().default(null),
  room: z.string().max(60).nullable().default(null),
});
export type SchoolClass = z.infer<typeof SchoolClass>;

export const Enrollment = EntityMeta.extend({
  studentId: EntityId,
  classId: EntityId,
  status: EnrollmentStatus.default("enrolled"),
  enrolledAt: IsoDate,
  endedAt: IsoDate.nullable().default(null),
  notes: z.string().max(1000).nullable().default(null),
});
export type Enrollment = z.infer<typeof Enrollment>;

/** The days a school teaches on. */
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;

/** A time of day, e.g. `09:30`. */
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time as HH:MM");

/**
 * One lesson in a class's week.
 *
 * A class does not keep its timetable on itself: the same class is taught
 * by different teachers in different subjects, and a teacher teaches several
 * classes. The lessons are their own records, so a class's week is read
 * from them and a teacher's week is read from the same ones.
 */
export const TimetableEntry = EntityMeta.extend({
  classId: EntityId,
  /** The subject taught, e.g. "Mathematics". */
  subject: z.string().min(1).max(120),
  /** The teacher who teaches it, when it is known. */
  teacherName: z.string().max(120).nullable().default(null),
  day: Weekday,
  startTime: TimeOfDay,
  endTime: TimeOfDay,
  /** The room the lesson is taught in, when it is known. */
  room: z.string().max(60).nullable().default(null),
});
export type TimetableEntry = z.infer<typeof TimetableEntry>;

/**
 * Attendance for one student on one calendar date.
 *
 * Keyed by (studentId, classId, date) — a student attending two classes on
 * the same day has two records.
 */
export const AttendanceRecord = EntityMeta.extend({
  studentId: EntityId,
  classId: EntityId,
  date: IsoDate,
  status: AttendanceStatus,
  note: z.string().max(500).nullable().default(null),
  /** Username of the staff member who recorded the attendance. */
  recordedBy: z.string().max(120).nullable().default(null),
});
export type AttendanceRecord = z.infer<typeof AttendanceRecord>;

export const Assessment = EntityMeta.extend({
  title: z.string().min(1).max(200),
  classId: EntityId,
  subject: z.string().max(120).nullable().default(null),
  /** Maximum obtainable score, used to normalise percentages. */
  maxScore: z.number().min(0),
  /** Relative weight of this assessment in the class grade, 0..1. */
  weight: z.number().min(0).max(1).default(1),
  date: IsoDate,
  notes: z.string().max(2000).nullable().default(null),
});
export type Assessment = z.infer<typeof Assessment>;

export const AssessmentResult = EntityMeta.extend({
  assessmentId: EntityId,
  studentId: EntityId,
  /** Null while the result has not been graded. */
  score: z.number().nullable().default(null),
  /** Letter grade or band, e.g. "A1", "B2". */
  grade: z.string().max(20).nullable().default(null),
  note: z.string().max(1000).nullable().default(null),
  gradedAt: IsoDateTime.nullable().default(null),
});
export type AssessmentResult = z.infer<typeof AssessmentResult>;
