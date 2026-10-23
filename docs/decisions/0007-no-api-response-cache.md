# 0007 — The service worker caches the program, never the data

**Status:** accepted

## Context

The client is a progressive web application. A service worker is what makes it
installable and what makes it start with no network.

The usual offline-PWA recipe is to cache API responses as well as the
application shell, using a cache-first or stale-while-revalidate strategy.
That is the wrong shape for this system, because this system already has a
correct data cache.

## Decision

The service worker **precaches the application shell only** — the HTML, the
JavaScript, the CSS, the icons and the web manifest. API requests are given to
the `NetworkOnly` handler and are never written to a cache.

```ts
runtimeCaching: [
  { urlPattern: ({ url }) => url.pathname.startsWith("/api/"), handler: "NetworkOnly" },
];
```

All record data lives in the IndexedDB replica, which the sync engine owns and
which has an explicit, correct invalidation story: the server's change feed.

## Consequences

**Good.**

- **One copy of the data.** The replica is the client's cache of record data.
  There is no second copy in a Cache Storage bucket to disagree with it.
- **No stale cache.** A record's freshness is decided by its revision and the
  change feed, not by a cache-control header or a heuristic expiry.
- **No accidental data leakage.** A cached API response could survive a logout
  on a shared device. The replica is cleared with the database.
- **Offline reads still work**, because the replica is a complete local copy —
  not a partial one that depends on what happened to be cached.

**Bad, and accepted.**

- The first load of a new entity type needs the server. The replica fills
  incrementally as the client pulls the change feed.
- The service worker must be updated when the application is updated. The
  plugin handles this with `registerType: "autoUpdate"`, and because data
  lives in IndexedDB rather than in the cache, an update cannot lose data.

## Alternatives considered

**Cache-first with a background refresh for API responses.** Rejected. It
produces two sources of truth for the same record, and the two would disagree
after any edit made while the device was offline.

**Network-first with a cache fallback.** Rejected for the same reason, and it
also makes every read wait for a timeout when the device is offline.

**Caching the API and dropping the replica.** Rejected. It cannot support
offline _writes_, and it makes the conflict model undecidable: the client
would not know what the server's copy of a record looked like when the user
started editing.
