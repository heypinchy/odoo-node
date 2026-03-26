# odoo-node

Typed Odoo JSON-RPC client for Node.js.

## Features

- Full Odoo JSON-RPC 2.0 support
- TypeScript with strict types
- Zero runtime dependencies (uses native `fetch`)
- CRUD operations: `searchRead`, `create`, `write`, `unlink`
- `readGroup` support for aggregation queries
- Schema introspection: `models()`, `fields()`
- Static `authenticate()` helper

## Installation

```bash
npm install odoo-node
```

## Usage

```typescript
import { OdooClient } from "odoo-node";

const client = new OdooClient({
  url: "https://mycompany.odoo.com",
  db: "mycompany",
  uid: 2,
  apiKey: "your-api-key",
});

// Search and read records
const { records, total } = await client.searchRead("res.partner", [
  ["is_company", "=", true],
], { fields: ["name", "email"], limit: 10 });

// Create a record
const id = await client.create("res.partner", { name: "Acme Corp" });

// Read group (aggregation)
const { groups } = await client.readGroup(
  "sale.order",
  [["state", "=", "sale"]],
  ["amount_total:sum"],
  ["partner_id"],
);
```

## Authentication

```typescript
// Get uid from login credentials
const uid = await OdooClient.authenticate({
  url: "https://mycompany.odoo.com",
  db: "mycompany",
  login: "admin",
  apiKey: "your-api-key",
});
```

## License

MIT
