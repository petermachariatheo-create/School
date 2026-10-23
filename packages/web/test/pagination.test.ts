import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAGE_SIZE, pageNumbers, paginate } from "../src/app/pagination.ts";

/**
 * Paging.
 *
 * A school may hold more students than a table can show at once.
 */

describe("paging a list", () => {
  test("shows the first page by default", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    const page = paginate(items, 1);
    assert.equal(page.items.length, DEFAULT_PAGE_SIZE);
    assert.equal(page.items[0], 0);
    assert.equal(page.pages, 2);
    assert.equal(page.total, 30);
  });

  test("shows the page that was asked for", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    const page = paginate(items, 2);
    assert.equal(page.items[0], 25);
    assert.equal(page.items.length, 5);
  });

  test("a page beyond the end shows the last page", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    const page = paginate(items, 9);
    assert.equal(page.page, 2);
    assert.equal(page.items.length, 5);
  });

  test("a page before the beginning shows the first page", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    assert.equal(paginate(items, 0).page, 1);
    assert.equal(paginate(items, -3).page, 1);
  });

  test("an empty list is still one page", () => {
    const page = paginate([], 1);
    assert.equal(page.pages, 1);
    assert.equal(page.total, 0);
    assert.deepEqual(page.items, []);
  });

  test("a page size of nothing is treated as one", () => {
    const page = paginate([1, 2, 3], 1, 0);
    assert.equal(page.items.length, 1);
    assert.equal(page.pages, 3);
  });
});

describe("the numbers in a pager", () => {
  test("offers the first and the last page", () => {
    assert.deepEqual(pageNumbers(5, 9), [1, 4, 5, 6, 9]);
  });

  test("offers only what exists", () => {
    assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  });

  test("a single page needs no numbers but one", () => {
    assert.deepEqual(pageNumbers(1, 1), [1]);
  });
});
