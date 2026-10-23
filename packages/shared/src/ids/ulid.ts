/**
 * ULID — 48-bit millisecond timestamp + 80 bits of entropy, Crockford Base32.
 *
 * Lexicographic order equals creation order, which makes ULIDs usable as
 * keyset-pagination cursors and as tie-breakers that never collide.
 * Implemented locally to keep the server dependency-free.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const ENCODED_LENGTH = TIME_LENGTH + RANDOM_LENGTH;
/** The first random character carries only 3 significant bits (spec constraint). */
const MAX_LEADING_RANDOM = 7;

export type Ulid = string & { readonly __brand: "Ulid" };

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function encodeTime(now: number): string {
  let out = "";
  let value = now;
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function randomChars(): string {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    // First character limited to 0-7 to stay inside the 80-bit random budget.
    const limit = i === 0 ? MAX_LEADING_RANDOM : 31;
    out += ALPHABET[(bytes[i] ?? 0) & limit];
  }
  return out;
}

/** Increment a Crockford Base32 string by one, in place, with carry. */
function incrementBase32(value: string): string {
  const chars = value.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const index = ALPHABET.indexOf(chars[i] ?? "0");
    if (index < 31) {
      chars[i] = ALPHABET[index + 1] ?? "0";
      return chars.join("");
    }
    chars[i] = "0";
  }
  return `0${chars.slice(1).join("")}`;
}

let lastTime = -1;
let lastRandom = "";

export function ulid(now: number = Date.now()): Ulid {
  if (now === lastTime && lastRandom !== "") {
    lastRandom = incrementBase32(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomChars();
  }
  return `${encodeTime(now)}${lastRandom}` as Ulid;
}

export function isUlid(value: unknown): value is Ulid {
  return typeof value === "string" && value.length === ENCODED_LENGTH && ULID_PATTERN.test(value);
}

/** Extract the embedded creation timestamp in milliseconds. */
export function ulidTime(value: Ulid): number {
  let time = 0;
  for (let i = 0; i < TIME_LENGTH; i++) {
    time = time * 32 + ALPHABET.indexOf(value.charAt(i));
  }
  return time;
}

/** Test-only reset of the monotonic counter. */
export function resetUlidClock(): void {
  lastTime = -1;
  lastRandom = "";
}
