import * as z from "zod";
import { EntityMeta, EntityId, Gender, IsoDate, StudentStatus } from "./common.ts";

/**
 * People: students and the guardians responsible for them.
 *
 * A guardian is modelled as a first-class record rather than embedded in a
 * student, because one guardian commonly has several children and one
 * student may have several guardians. The link is a first-class entity so
 * that it can carry its own attributes (relationship, primary contact).
 */

export const Student = EntityMeta.extend({
  /** School-assigned admission number. Unique within the school. */
  admissionNumber: z.string().min(1).max(64),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  middleName: z.string().max(120).nullable().default(null),
  dateOfBirth: IsoDate.nullable().default(null),
  gender: Gender.default("undisclosed"),
  email: z.email().nullable().default(null),
  phone: z.string().max(40).nullable().default(null),
  address: z.string().max(500).nullable().default(null),
  status: StudentStatus.default("active"),
  admissionDate: IsoDate.nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});
export type Student = z.infer<typeof Student>;

export const Guardian = EntityMeta.extend({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  /** Free-text relationship to the student, e.g. "mother", "uncle". */
  relationship: z.string().max(60).nullable().default(null),
  email: z.email().nullable().default(null),
  phone: z.string().max(40).nullable().default(null),
  alternatePhone: z.string().max(40).nullable().default(null),
  address: z.string().max(500).nullable().default(null),
  /** National identity number, used by government reporting integrations. */
  nationalId: z.string().max(120).nullable().default(null),
  occupation: z.string().max(120).nullable().default(null),
});
export type Guardian = z.infer<typeof Guardian>;

export const StudentGuardian = EntityMeta.extend({
  studentId: EntityId,
  guardianId: EntityId,
  /** Denormalised for convenience when listing a student's guardians. */
  relationship: z.string().max(60).nullable().default(null),
  /** Exactly one guardian per student is the primary billing contact. */
  isPrimary: z.boolean().default(false),
});
export type StudentGuardian = z.infer<typeof StudentGuardian>;

/** A student with their name resolved for display. */
export function studentDisplayName(student: Student): string {
  return [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
}
