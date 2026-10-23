# 0006 — RFC 9457 Problem Details for every error

**Status:** accepted

## Context

Every error the API can produce has to be understandable by two audiences at
once:

- a **person** — the school administrator who sees a message in the interface;
- a **program** — a script or an integration that has to know whether to
  retry, and which field to ask about again.

Ad-hoc error shapes (`{"error": "not found"}`, `{"ok": false, "msg": "..."}`)
satisfy neither reliably: they differ from endpoint to endpoint, and they do
not carry the machine-readable information a client needs to react.

## Decision

Use **RFC 9457 Problem Details** for every error response, and
`application/problem+json` as the content type.

```json
{
  "type": "https://school.local/problems/validation_failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "The student record failed validation",
  "instance": "/api/v1/students",
  "errors": [
    {
      "path": "lastName",
      "message": "Too small: expected string to have >=1 characters",
      "code": "too_small"
    }
  ]
}
```

The error code is encoded in the `type` URI, which gives a stable, machine-
readable discriminator while staying a valid URI.

The set of codes is fixed in `packages/shared/src/contracts/errors.ts`, together
with the title and the HTTP status for each:

| Code                     | Status | Meaning                                                       |
| ------------------------ | ------ | ------------------------------------------------------------- |
| `validation_failed`      | 422    | The payload did not satisfy the schema.                       |
| `malformed_request`      | 400    | The payload was not parseable, or the method was not allowed. |
| `not_found`              | 404    | No such record.                                               |
| `conflict`               | 409    | The request conflicts with the current state.                 |
| `unauthorized`           | 401    | Authentication is required.                                   |
| `forbidden`              | 403    | Authenticated, but not allowed.                               |
| `unsupported_media_type` | 415    | The content type is not supported.                            |
| `unprocessable_entity`   | 422    | Well-formed, but cannot be processed.                         |
| `rate_limited`           | 429    | Too many requests.                                            |
| `internal_error`         | 500    | An unexpected failure.                                        |

Validation failures are translated from Zod's issue list by
`zodIssuesToDetails`, so the field-level messages are the same ones the
developer's own test suite sees.

## Consequences

**Good.**

- One error format for the whole API. A client writes one handler.
- Field-level errors carry a dotted path (`lineItems.0.unitAmount`), so a
  client can attach a message to the right input.
- Standard tooling — a browser, an HTTP proxy, a monitoring agent — can read
  the response without knowing anything about this API.
- The mapping from code to status is one table, so it cannot be inconsistent
  between endpoints.

**Bad, and accepted.**

- The `type` URI points at `https://school.local/problems/...`, which is not a
  real public URL. It is a stable identifier, not a link that resolves. That
  is the normal practice for a private deployment and keeps the system free of
  an external dependency.
- The `detail` field is prose and may change between versions. Clients should
  branch on `type` or on the code, never on `detail`.

## Alternatives considered

**A flat `{"error": {...}}` envelope.** Rejected. It is less standard and
forces every consumer to learn a private shape.

**HTTP status codes only.** Rejected. A 422 with no body tells a user nothing
about which field is wrong.

**JSON:API's error format.** Rejected. It is a good format, but it assumes a
JSON:API resource shape, which this API does not use.
