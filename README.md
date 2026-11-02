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

Create a client. Config: `{ url, db, uid, apiKey }`.

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

- **Redirects are refused, never followed.** If the Odoo URL answers with a 3xx, the call fails with `Odoo answered with a redirect (HTTP 307); odoo-node does not follow redirects. Use the address Odoo is actually served from.` and the redirect target receives no request. If you validate the Odoo URL before connecting (for example against SSRF rules that refuse loopback, link-local, or cloud-metadata addresses), that validation stays meaningful: a redirect cannot hand the request — and, for 307/308, the POST body with the API key — to an address you never checked. Odoo's JSON-RPC endpoint does not redirect; if yours does (e.g. `http://` → `https://`), configure the address it is actually served from.
- **Response bodies stay out of error messages.** An answer that is not a JSON-RPC envelope (an HTML login page, a proxy error, plain text) is reported as `Response is not JSON-RPC (HTTP <status>, <content type>)`, without quoting the body. Error messages from a valid JSON-RPC error payload are Odoo's own message, unchanged. A JSON-RPC answer without a `result` is not an error: Odoo leaves `result` out when the method returns `None` (e.g. `account.move.line.reconcile`), and the call resolves to `undefined`.

## Compatibility

Works with Odoo 14+ (Community and Enterprise). Uses JSON-RPC with API key authentication.

## License

MIT — Clemens Helm
