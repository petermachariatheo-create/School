/**
 * What the client needs to know about the server it is talking to.
 *
 * The `/api/v1/meta` endpoint reports the entity catalogue and the network
 * addresses of the server. The addresses are what a person types into a
 * phone to open the same school, so the interface can show them instead of
 * making the person work them out.
 */

export interface ServerAddress {
  readonly address: string;
  readonly interface: string;
  readonly private: boolean;
}

export interface ServerInfo {
  readonly port: number;
  /** The encrypted port, when the server has a certificate. */
  readonly securePort: number | null;
  readonly addresses: readonly ServerAddress[];
}

export interface ServerMeta {
  readonly contractVersion: string;
  readonly apiVersion: string;
  readonly entityTypes: readonly { type: string; path: string; label: string }[];
  readonly network?: {
    readonly port: number;
    readonly securePort: number | null;
    readonly addresses: readonly ServerAddress[];
  };
}

/**
 * The address a phone should use, and the ones it could use instead.
 *
 * The addresses are checked before they are used: they end up in a code
 * that is scanned by a camera, and a server that said something unexpected
 * should not be able to turn that into anything other than an address.
 */
export function connectUrls(info: ServerInfo): {
  primary: string;
  all: string[];
  securePrimary: string | null;
  secureAll: string[];
} {
  const addresses = info.addresses
    .map((entry) => entry.address)
    .filter((address) => IPV4.test(address));

  const all = addresses.map((address) => `http://${address}:${info.port}`);
  const secureAll =
    info.securePort === null
      ? []
      : addresses.map((address) => `https://${address}:${info.securePort}`);

  const primary = all[0] ?? `http://localhost:${info.port}`;
  return { primary, all, securePrimary: secureAll[0] ?? null, secureAll };
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
