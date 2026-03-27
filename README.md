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

### Domain Filters

Standard Odoo domain syntax: `[["field", "operator", value]]`

Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not in`, `like`, `ilike`

Logic: `&` (AND, default), `|` (OR), `!` (NOT) — Polish notation.

## Compatibility

Works with Odoo 14+ (Community and Enterprise). Uses JSON-RPC with API key authentication.

## License

MIT — Clemens Helm
