import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isUlid, resetUlidClock, ulid, ulidTime } from "../src/ids/ulid.ts";

describe("ULID", () => {
  test("generates identifiers of the expected shape", () => {
    resetUlidClock();
    const value = ulid();
    assert.equal(value.length, 26);
    assert.ok(isUlid(value));
  });

  test("encodes the creation time", () => {
    resetUlidClock();
    const now = Date.UTC(2026, 9, 20, 5, 41, 21);
    const value = ulid(now);
    assert.equal(ulidTime(value), now);
  });

  test("is monotonically increasing within the same millisecond", () => {
    resetUlidClock();
    const now = Date.UTC(2026, 9, 20);
    const first = ulid(now);
    const second = ulid(now);
    const third = ulid(now);
    assert.ok(first < second, "first must sort before second");
    assert.ok(second < third, "second must sort before third");
  });

  test("produces distinct identifiers in a tight loop", () => {
    resetUlidClock();
    const values = new Set<string>();
    for (let index = 0; index < 10_000; index++) {
      values.add(ulid());
    }
    assert.equal(values.size, 10_000);
  });

  test("rejects identifiers that are not ULIDs", () => {
    assert.equal(isUlid("not-an-ulid"), false);
    assert.equal(isUlid(""), false);
    assert.equal(isUlid("0123456789ABCDEFGHJKMNPQ"), false, "too short");
  });
});
