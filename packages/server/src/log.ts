import fs from "node:fs";
import path from "node:path";

/**
 * Server logging.
 *
 * When the server is started from a launcher — a double-clicked shortcut, or
 * a sign-in task — it has no console to write to, and the person who needs
 * the output is not watching the screen. `SCHOOL_LOG_FILE` points it at a
 * file instead, so that the record of what happened is still there when
 * somebody asks what went wrong.
 *
 * Without the setting the server writes to the console, which is what a
 * developer and a system administrator both want.
 */

const LOG_FILE = process.env["SCHOOL_LOG_FILE"];

function write(stream: NodeJS.WriteStream, message: string): void {
  try {
    stream.write(message);
  } catch {
    // A broken output stream must never take the server down.
  }
}

function appendToFile(message: string): void {
  if (!LOG_FILE) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}`);
  } catch {
    // If the log cannot be written, the server still runs.
  }
}

/** Record something that happened. */
export function logInfo(message: string): void {
  if (LOG_FILE) {
    appendToFile(message);
    return;
  }
  write(process.stdout, message);
}

/** Record something that went wrong. */
export function logError(message: string): void {
  if (LOG_FILE) {
    appendToFile(message);
    return;
  }
  write(process.stderr, message);
}
