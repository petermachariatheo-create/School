import { ulid } from "@school/shared";
import { loadConfig } from "../config.ts";
import { openDatabase } from "../db/database.ts";
import { ENTITY_TABLES } from "../db/migrations.ts";
import { migrate } from "../db/migrate.ts";
import { RepositorySet } from "../db/repository.ts";

/**
 * Seed the database with a plausible school.
 *
 * The data is generated rather than listed, so the seed covers a realistic
 * spread: several classes, students across all of them, guardians, daily
 * attendance, assessments with results, and invoices with part payments.
 *
 * Usage:
 *   node src/cli/seed.ts [--force] [--students 200]
 */

interface Options {
  readonly force: boolean;
  readonly studentCount: number;
}

function parseOptions(argv: string[]): Options {
  let force = false;
  let studentCount = 120;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--force") {
      force = true;
    } else if (argument === "--students") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        studentCount = value;
        index += 1;
      }
    }
  }

  return { force, studentCount };
}

const FIRST_NAMES = [
  "Ada",
  "Alan",
  "Grace",
  "Katherine",
  "Edsger",
  "Barbara",
  "Donald",
  "Jean",
  "Tim",
  "Margaret",
  "Linus",
  "Radia",
  "Ken",
  "Anita",
  "Vint",
  "Shafi",
  "Leslie",
  "Bjarne",
  "Carol",
];
const LAST_NAMES = [
  "Lovelace",
  "Turing",
  "Hopper",
  "Johnson",
  "Bartik",
  "BernersLee",
  "Hamilton",
  "Torvalds",
  "Perlman",
  "Thompson",
  "Borg",
  "Cerf",
  "Goldwasser",
  "Lamport",
  "Stroustrup",
  "Shaw",
];
const RELATIONSHIPS = ["mother", "father", "guardian", "grandmother", "uncle"];

function pick<T>(values: readonly T[], index: number): T {
  return values[index % values.length] as T;
}

const options = parseOptions(process.argv.slice(2));
const config = loadConfig();

const db = openDatabase({ file: config.databaseFile, synchronous: config.synchronous });
migrate(db);

const repositories = new RepositorySet(db);
const students = repositories.get("student");
const guardians = repositories.get("guardian");
const links = repositories.get("student_guardian");
const classes = repositories.get("class");
const enrollments = repositories.get("enrollment");
const attendance = repositories.get("attendance");
const assessments = repositories.get("assessment");
const results = repositories.get("assessment_result");
const invoices = repositories.get("invoice");
const payments = repositories.get("payment");

const existing = students.count();
if (existing > 0 && !options.force) {
  process.stdout.write(
    `[seed] the database already holds ${existing} students; nothing to do. Use --force to seed it again.\n`,
  );
  db.close();
  process.exit(0);
}

if (options.force && existing > 0) {
  // The seed writes the same natural keys every time, so the records it
  // wrote before have to go: the database's own uniqueness rules would
  // refuse them.
  process.stdout.write("[seed] clearing the records already there\n");
  for (const spec of ENTITY_TABLES) {
    db.prepare(`DELETE FROM ${spec.table}`).run();
  }
}

const year = new Date().getUTCFullYear();
const academicYear = `${year}/${year + 1}`;

process.stdout.write(`[seed] writing to ${config.databaseFile}\n`);

// ---- classes ----------------------------------------------------------------

const classNames = ["A", "B", "C", "D", "E"];
const classIds = classNames.map((stream, index) => {
  const created = classes.upsert({
    id: ulid(),
    name: `Grade ${7 + Math.floor(index / 2)} ${stream}`,
    gradeLevel: `Grade ${7 + Math.floor(index / 2)}`,
    academicYear,
    teacherName: `Teacher ${index + 1}`,
    capacity: 40,
    room: `Room ${index + 1}`,
  });
  return String(created.record["id"]);
});

// ---- timetables ------------------------------------------------------------

/**
 * The week of lessons for each class.
 *
 * A school day is four periods of an hour, and the subjects rotate: a
 * class does the same subject at the same time on the same day every week,
 * which is what a timetable is.
 */
const SUBJECTS = ["Mathematics", "English", "Science", "Humanities", "Creative Arts", "Computing"];

const PERIODS: readonly { start: string; end: string }[] = [
  { start: "08:00", end: "09:00" },
  { start: "09:15", end: "10:15" },
  { start: "10:30", end: "11:30" },
  { start: "13:30", end: "14:30" },
];

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

const timetables = repositories.get("timetable");
let lessonCount = 0;
for (const [index, classId] of classIds.entries()) {
  for (const [dayIndex, day] of DAYS.entries()) {
    for (const [periodIndex, period] of PERIODS.entries()) {
      // The same slot on the same day must not repeat within a class, so
      // the subject is chosen from the period and the day.
      const subject = SUBJECTS[(index + dayIndex + periodIndex) % SUBJECTS.length] as string;
      timetables.upsert({
        id: ulid(),
        classId,
        subject,
        teacherName: `Teacher ${((index + dayIndex) % classIds.length) + 1}`,
        day,
        startTime: period.start,
        endTime: period.end,
        room: `Room ${(index % classIds.length) + 1}`,
      });
      lessonCount += 1;
    }
  }
}

// ---- students and guardians --------------------------------------------------

const studentIds: string[] = [];
let created = 0;

for (let index = 0; index < options.studentCount; index++) {
  const firstName = pick(FIRST_NAMES, index * 7 + 3);
  const lastName = pick(LAST_NAMES, index * 11 + 5);
  const admissionNumber = `ADM-${String(1000 + index)}`;

  const student = students.upsert({
    id: ulid(),
    admissionNumber,
    firstName,
    lastName,
    middleName: null,
    dateOfBirth: `${year - 13 - (index % 5)}-${String((index % 12) + 1).padStart(2, "0")}-15`,
    gender: index % 3 === 0 ? "female" : index % 3 === 1 ? "male" : "undisclosed",
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.edu`,
    phone: `+254700${String(100000 + index).slice(-6)}`,
    address: `${index + 1} Example Road`,
    status: "active",
    admissionDate: `${year - (index % 3)}-${String((index % 8) + 1).padStart(2, "0")}-10`,
    notes: null,
  });
  created += 1;
  studentIds.push(String(student.record["id"]));

  const guardian = guardians.upsert({
    id: ulid(),
    firstName: `Guardian${index}`,
    lastName,
    relationship: pick(RELATIONSHIPS, index),
    email: `guardian${index}@example.edu`,
    phone: `+254711${String(100000 + index).slice(-6)}`,
    alternatePhone: null,
    address: `${index + 1} Example Road`,
    nationalId: null,
    occupation: "Parent",
  });

  links.upsert({
    id: ulid(),
    studentId: student.record["id"],
    guardianId: guardian.record["id"],
    relationship: pick(RELATIONSHIPS, index),
    isPrimary: true,
  });
}

// ---- enrolments and attendance -----------------------------------------------

let attendanceCount = 0;

studentIds.forEach((studentId, index) => {
  const classId = classIds[index % classIds.length] as string;

  enrollments.upsert({
    id: ulid(),
    studentId,
    classId,
    status: "enrolled",
    enrolledAt: `${year}-01-10`,
    endedAt: null,
    notes: null,
  });

  for (let day = 0; day < 5; day++) {
    const status =
      attendanceCount % 17 === 0 ? "absent" : attendanceCount % 7 === 0 ? "late" : "present";
    attendance.upsert({
      id: ulid(),
      studentId,
      classId,
      date: `${year}-0${(day % 9) + 1}-1${day % 9}`,
      status,
      note: null,
      recordedBy: `Teacher ${(index % classIds.length) + 1}`,
    });
    attendanceCount += 1;
  }
});

// ---- assessments and results ---------------------------------------------------

classIds.forEach((classId, classIndex) => {
  const assessment = assessments.upsert({
    id: ulid(),
    title: `Mid-term assessment ${classIndex + 1}`,
    classId,
    subject: pick(["Mathematics", "English", "Science", "History"], classIndex),
    maxScore: 100,
    weight: 0.25,
    date: `${year}-05-20`,
    notes: null,
  });

  studentIds.forEach((studentId, index) => {
    if (index % classIds.length !== classIndex) {
      return;
    }
    results.upsert({
      id: ulid(),
      assessmentId: assessment.record["id"],
      studentId,
      score: 45 + ((index * 7) % 55),
      grade: null,
      note: null,
      gradedAt: `${year}-05-25T09:00:00.000Z`,
    });
  });
});

// ---- invoices and payments ------------------------------------------------------

studentIds.slice(0, 20).forEach((studentId, index) => {
  const lineItems = [
    { description: "Tuition — term 1", quantity: 1, unitAmount: 45000, accountCode: "TUITION" },
    { description: "Transport", quantity: 1, unitAmount: 12000, accountCode: "TRANSPORT" },
  ];
  const totalAmount = lineItems.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);

  const invoice = invoices.upsert({
    id: ulid(),
    invoiceNumber: `INV-${String(5000 + index)}`,
    studentId,
    guardianId: null,
    term: `Term 1 ${year}`,
    issueDate: `${year}-01-15`,
    dueDate: `${year}-02-15`,
    currency: "KES",
    // The invoice is issued; whether it has been paid for, and whether it
    // is late, are worked out by the server from the payment below.
    status: "issued",
    lineItems,
    totalAmount,
    // The amount paid is the sum of the payments below, and the server
    // keeps it up to date, so it is not stated here.
    notes: null,
  });

  payments.upsert({
    id: ulid(),
    paymentNumber: `PAY-${String(9000 + index)}`,
    invoiceId: invoice.record["id"],
    studentId,
    amount: 30000,
    currency: "KES",
    method: "mobile_money",
    receivedAt: `${year}-01-20T10:15:00.000Z`,
    recordedBy: "Cashier",
    externalReference: `MPESA-${index}`,
    notes: null,
  });
});

process.stdout.write(
  `[seed] done: ${created} students, ${classIds.length} classes, ${lessonCount} lessons, ${attendanceCount} attendance records\n`,
);
db.close();
