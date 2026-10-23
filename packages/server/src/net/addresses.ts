import os from "node:os";

/**
 * Network addresses of this machine.
 *
 * A school installs the server on one machine and then types an address into
 * a phone. The interface asks the server what that address is, rather than
 * making the administrator work it out from the router's configuration page
 * or by running a command.
 */

/** An address another device can use to reach this server. */
export interface NetworkAddress {
  /** The address itself, for example `192.168.1.20`. */
  readonly address: string;
  /** The name of the interface the address belongs to. */
  readonly interface: string;
  /** True for addresses on a private network, which is what a school uses. */
  readonly private: boolean;
}

const PRIVATE_PATTERNS = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** True for the loopback addresses, which other devices cannot reach. */
function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address.startsWith("127.");
}

/**
 * The IPv4 addresses of every non-internal interface.
 *
 * Virtual interfaces (Hyper-V, VirtualBox, Docker, WSL) are excluded where
 * possible: they are usually not on the school's network, and listing them
 * would send an administrator to the wrong address.
 */
export function networkAddresses(): NetworkAddress[] {
  const interfaces = os.networkInterfaces();
  const found: NetworkAddress[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      // Node 18+ reports the address family as a number: 4 is IPv4.
      if (entry.family !== "IPv4" && (entry.family as unknown as number) !== 4) {
        continue;
      }
      if (entry.internal || isLoopback(entry.address)) {
        continue;
      }
      found.push({
        address: entry.address,
        interface: name,
        private: PRIVATE_PATTERNS.some((pattern) => pattern.test(entry.address)),
      });
    }
  }

  // A private address is the one a school will use; it comes first.
  return found.sort((left, right) => Number(right.private) - Number(left.private));
}

/** The address most likely to be the one a phone should use. */
export function primaryAddress(): NetworkAddress | undefined {
  return networkAddresses()[0];
}
