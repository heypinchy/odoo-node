# odoo-node

Typed Odoo JSON-RPC client for Node.js with `read_group` support. Zero runtime dependencies.

## Installation

```bash
npm install odoo-node
```

## Quick Start

```typescript
import { OdooClient } from "odoo-node";

// Authenticate first (one-time)
const uid = await OdooClient.authenticate({
  url: "https://your-odoo.com",
  db: "production",
  login: "admin",
  apiKey: "your-api-key",
});

// Create client
const client = new OdooClient({
  url: "https://your-odoo.com",
  db: "production",
  uid,
  apiKey: "your-api-key",
});

// Query data
const { records, total } = await client.searchRead("sale.order", [
  ["state", "=", "sale"],
], { fields: ["name", "amount_total", "partner_id"], limit: 10 });

// Server-side aggregation
const { groups } = await client.readGroup(
  "sale.order",
  [["state", "=", "sale"]],
  ["partner_id", "amount_total:sum"],
  ["partner_id"],
);
```

## API

### `OdooClient.authenticate(config)` (static)

Authenticate with Odoo and get the user ID. Returns `uid: number`.

### `new OdooClient(config)`

Create a client. Config: `{ url, db, uid, apiKey }`, plus the optional transport fields below.

### Transport: your own `fetch` and `signal`

Both the constructor and `authenticate` take two optional fields that control how requests reach Odoo:

- `fetch` — used for every request instead of the global `fetch`. It is always called with a URL string and a `RequestInit`, never a `Request`. Use it to pin the connection to addresses you checked, send it through a proxy or a custom dispatcher, or add a timeout, without replacing the process-wide `fetch`.
- `signal` — an `AbortSignal` passed to every request. Aborting it fails the call in flight with an `OdooError` whose `cause` is the abort reason. The signal belongs to the client: once aborted, every later call fails at once, so use it for shutdown. For a deadline per call, add it in `fetch`, as below.

```typescript
const client = new OdooClient({
  url: "https://mycompany.odoo.com",
  db: "mycompany",
  uid,
  apiKey: "your-api-key",
  // Combine with init.signal: it carries the `signal` you configured, if any.
  fetch: (url, init) => {
    const timeout = AbortSignal.timeout(30_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(url, { ...init, signal });
  },
});
```

`AbortSignal.any` needs Node 20.3 or later. Without these fields, odoo-node uses the global `fetch` and requests have no deadline. Redirects are refused with either (see Security).

### Introspection

- `version()` — Server version info
- `models()` — List all models with human-readable names
- `fields(model)` — Field definitions for a model

### Read

- `searchRead(model, domain, options?)` — Query records. Returns `{ records, total, limit, offset }`.
- `searchCount(model, domain)` — Count matching records.
- `readGroup(model, domain, fields, groupby, options?)` — Server-side aggregation with sum, avg, min, max.

### Write

- `create(model, values)` — Create record, returns ID.
- `write(model, ids, values)` — Update records.
- `unlink(model, ids)` — Delete records.

### Methods

- `callMethod(model, method, args?, kwargs?)` — Invoke an arbitrary model method via `execute_kw`. The generic escape hatch behind the typed helpers, for record methods without a dedicated wrapper (e.g. `client.callMethod("mail.activity", "action_feedback", [[id]], { feedback: "Done" })`). For methods that operate on a recordset, the first element of `args` is the list of record ids.

### Domain Filters

Standard Odoo domain syntax: `[["field", "operator", value]]`

Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not in`, `like`, `ilike`

Logic: `&` (AND, default), `|` (OR), `!` (NOT) — Polish notation.

## Security

- **Redirects are refused, never followed.** If the Odoo URL answers with a 3xx, the call fails with `Odoo answered with a redirect (HTTP 307); odoo-node does not follow redirects. Use the address Odoo is actually served from.` and the redirect target receives no request. If you validate the Odoo URL before connecting (for example against SSRF rules that refuse loopback, link-local, or cloud-metadata addresses), that validation stays meaningful: a redirect cannot hand the request — and, for 307/308, the POST body with the API key — to an address you never checked. Odoo's JSON-RPC endpoint does not redirect; if yours does (e.g. `http://` → `https://`), configure the address it is actually served from. This holds for a `fetch` you pass in too: odoo-node asks it for `redirect: "manual"` and refuses any 3xx it returns. Keep that option when you wrap `fetch`. If your `fetch` follows the redirect anyway, the request has already reached the target; odoo-node still refuses the answer (`response.redirected`), so it never returns data from an address you did not check.
- **Response bodies stay out of error messages.** An answer that is not a JSON-RPC envelope (an HTML login page, a proxy error, plain text) is reported as `Response is not JSON-RPC (HTTP <status>, <content type>)`, without quoting the body. Error messages from a valid JSON-RPC error payload are Odoo's own message, unchanged (or the error's own `message`, when a server that is not Odoo sends no `data`). An error envelope with neither is reported as not JSON-RPC. A JSON-RPC answer without a `result` is not an error: Odoo leaves `result` out when the method returns `None` (e.g. `account.move.line.reconcile`), and the call resolves to `undefined`.

## Compatibility

Works with Odoo 14+ (Community and Enterprise). Uses JSON-RPC with API key authentication.

## License

MIT — Clemens Helm
