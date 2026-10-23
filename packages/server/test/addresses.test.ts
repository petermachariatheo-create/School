import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { networkAddresses, primaryAddress } from "../src/net/addresses.ts";

/**
 * The network addresses of this machine.
 *
 * The interface shows these to somebody who wants to open the school on a
 * phone, so the addresses must be the ones other devices can actually
 * reach: never the loopback address, never a virtual interface's internal
 * address.
 */

describe("network addresses", () => {
  test("returns only routable IPv4 addresses", () => {
    for (const entry of networkAddresses()) {
      assert.match(entry.address, /^(?:\d{1,3}\.){3}\d{1,3}$/, "not an IPv4 address");
      assert.notEqual(entry.address, "127.0.0.1");
      assert.ok(entry.interface.length > 0, "no interface name");
    }
  });

  test("never reports the loopback address", () => {
    for (const entry of networkAddresses()) {
      assert.ok(!entry.address.startsWith("127."), "the loopback address was reported");
    }
  });

  test("the primary address is the first one, and a private one when there is one", () => {
    const all = networkAddresses();
    const first = primaryAddress();
    if (all.length === 0) {
      assert.equal(first, undefined);
      return;
    }
    assert.equal(first?.address, all[0]?.address);
    const privateAddress = all.find((entry) => entry.private);
    if (privateAddress !== undefined) {
      assert.equal(first?.address, privateAddress.address, "a private address should come first");
    }
  });
});
