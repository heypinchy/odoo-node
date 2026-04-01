import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./rpc.js", () => ({
  jsonRpc: vi.fn(),
  OdooError: class OdooError extends Error {
    code: number;
    data?: Record<string, unknown>;
    constructor(message: string, code = 0, data?: Record<string, unknown>) {
      super(message);
      this.name = "OdooError";
      this.code = code;
      this.data = data;
    }
  },
}));

import { OdooClient } from "./client.js";
import { jsonRpc } from "./rpc.js";

const mockedJsonRpc = vi.mocked(jsonRpc);

const config = {
  url: "https://odoo.example.com",
  db: "testdb",
  uid: 2,
  apiKey: "test-api-key",
};

describe("OdooClient", () => {
  let client: OdooClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OdooClient(config);
  });

  describe("version", () => {
    it("calls common/version and returns mapped result", async () => {
      mockedJsonRpc.mockResolvedValue({
        server_version: "17.0",
        server_version_info: [17, 0, 0, "final", 0],
        protocol_version: 1,
      });

      const result = await client.version();

      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "common",
        "version",
        [],
      );
      expect(result).toEqual({
        serverVersion: "17.0",
        serverVersionInfo: [17, 0, 0, "final", 0],
        protocolVersion: 1,
      });
    });
  });

  describe("models", () => {
    it("calls search_read on ir.model", async () => {
      mockedJsonRpc.mockResolvedValue([
        { model: "res.partner", name: "Contact" },
        { model: "sale.order", name: "Sales Order" },
      ]);

      const result = await client.models();

      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "ir.model",
          "search_read",
          [[]],
          { fields: ["model", "name"] },
        ],
      );
      expect(result).toEqual([
        { model: "res.partner", name: "Contact" },
        { model: "sale.order", name: "Sales Order" },
      ]);
    });
  });

  describe("fields", () => {
    it("calls fields_get and maps object to array", async () => {
      mockedJsonRpc.mockResolvedValue({
        name: {
          string: "Name",
          type: "char",
          required: true,
          readonly: false,
        },
        partner_id: {
          string: "Partner",
          type: "many2one",
          required: false,
          readonly: false,
          relation: "res.partner",
        },
      });

      const result = await client.fields("res.partner");

      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "res.partner",
          "fields_get",
          [],
          {
            attributes: ["string", "type", "required", "readonly", "relation", "selection"],
          },
        ],
      );
      expect(result).toEqual([
        {
          name: "name",
          string: "Name",
          type: "char",
          required: true,
          readonly: false,
        },
        {
          name: "partner_id",
          string: "Partner",
          type: "many2one",
          required: false,
          readonly: false,
          relation: "res.partner",
        },
      ]);
    });
  });

  describe("searchRead", () => {
    it("calls search_count and search_read in parallel", async () => {
      mockedJsonRpc
        .mockResolvedValueOnce(42) // search_count
        .mockResolvedValueOnce([{ id: 1, name: "Test" }]); // search_read

      const result = await client.searchRead("res.partner", [["is_company", "=", true]]);

      expect(mockedJsonRpc).toHaveBeenCalledTimes(2);

      // search_count call
      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "res.partner",
          "search_count",
          [[["is_company", "=", true]]],
          {},
        ],
      );

      // search_read call
      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "res.partner",
          "search_read",
          [[["is_company", "=", true]]],
          { fields: undefined, limit: 100, offset: 0, order: undefined },
        ],
      );

      expect(result).toEqual({
        records: [{ id: 1, name: "Test" }],
        total: 42,
        limit: 100,
        offset: 0,
      });
    });

    it("uses custom options when provided", async () => {
      mockedJsonRpc.mockResolvedValueOnce(100).mockResolvedValueOnce([{ id: 1, name: "A" }]);

      await client.searchRead("res.partner", [], {
        fields: ["name"],
        limit: 10,
        offset: 20,
        order: "name asc",
      });

      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "res.partner",
          "search_read",
          [[]],
          { fields: ["name"], limit: 10, offset: 20, order: "name asc" },
        ],
      );
    });

    it("defaults limit to 100", async () => {
      mockedJsonRpc.mockResolvedValueOnce(0).mockResolvedValueOnce([]);

      const result = await client.searchRead("res.partner", []);
      expect(result.limit).toBe(100);
    });
  });

  describe("searchCount", () => {
    it("returns count", async () => {
      mockedJsonRpc.mockResolvedValue(15);

      const result = await client.searchCount("res.partner", [["active", "=", true]]);

      expect(result).toBe(15);
      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        ["testdb", 2, "test-api-key", "res.partner", "search_count", [[["active", "=", true]]], {}],
      );
    });
  });

  describe("readGroup", () => {
    it("calls read_group with correct params", async () => {
      mockedJsonRpc.mockResolvedValue([{ partner_id: [1, "Test"], partner_id_count: 5 }]);

      const result = await client.readGroup(
        "sale.order",
        [["state", "=", "sale"]],
        ["amount_total:sum"],
        ["partner_id"],
      );

      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "sale.order",
          "read_group",
          [[["state", "=", "sale"]]],
          {
            fields: ["amount_total:sum"],
            groupby: ["partner_id"],
            orderby: undefined,
            limit: undefined,
            offset: undefined,
            lazy: undefined,
          },
        ],
      );

      expect(result).toEqual({
        groups: [{ partner_id: [1, "Test"], partner_id_count: 5 }],
      });
    });

    it("passes options to read_group", async () => {
      mockedJsonRpc.mockResolvedValue([]);

      await client.readGroup("sale.order", [], ["amount_total:sum"], ["partner_id"], {
        orderby: "partner_id asc",
        limit: 5,
        offset: 0,
        lazy: false,
      });

      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "sale.order",
          "read_group",
          [[]],
          {
            fields: ["amount_total:sum"],
            groupby: ["partner_id"],
            orderby: "partner_id asc",
            limit: 5,
            offset: 0,
            lazy: false,
          },
        ],
      );
    });
  });

  describe("create", () => {
    it("returns created record id", async () => {
      mockedJsonRpc.mockResolvedValue(42);

      const id = await client.create("res.partner", { name: "Acme Corp" });

      expect(id).toBe(42);
      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        ["testdb", 2, "test-api-key", "res.partner", "create", [{ name: "Acme Corp" }], {}],
      );
    });
  });

  describe("write", () => {
    it("returns true on success", async () => {
      mockedJsonRpc.mockResolvedValue(true);

      const result = await client.write("res.partner", [1, 2], {
        name: "Updated",
      });

      expect(result).toBe(true);
      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        ["testdb", 2, "test-api-key", "res.partner", "write", [[1, 2], { name: "Updated" }], {}],
      );
    });
  });

  describe("unlink", () => {
    it("returns true on success", async () => {
      mockedJsonRpc.mockResolvedValue(true);

      const result = await client.unlink("res.partner", [1]);

      expect(result).toBe(true);
      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        ["testdb", 2, "test-api-key", "res.partner", "unlink", [[1]], {}],
      );
    });
  });

  describe("checkAccessRights", () => {
    it("calls check_access_rights with raise_exception false", async () => {
      mockedJsonRpc.mockResolvedValue(true);

      const result = await client.checkAccessRights("sale.order", "read");

      expect(mockedJsonRpc).toHaveBeenCalledWith(
        "https://odoo.example.com",
        "object",
        "execute_kw",
        [
          "testdb",
          2,
          "test-api-key",
          "sale.order",
          "check_access_rights",
          ["read"],
          { raise_exception: false },
        ],
      );
      expect(result).toBe(true);
    });

    it("returns false when user lacks permission", async () => {
      mockedJsonRpc.mockResolvedValue(false);

      const result = await client.checkAccessRights("sale.order", "unlink");

      expect(result).toBe(false);
    });
  });
});

describe("OdooClient.authenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls common/authenticate and returns uid", async () => {
    mockedJsonRpc.mockResolvedValue(2);

    const uid = await OdooClient.authenticate({
      url: "https://odoo.example.com",
      db: "testdb",
      login: "admin",
      apiKey: "test-key",
    });

    expect(uid).toBe(2);
    expect(mockedJsonRpc).toHaveBeenCalledWith(
      "https://odoo.example.com",
      "common",
      "authenticate",
      ["testdb", "admin", "test-key", {}],
    );
  });

  it("throws on authentication failure (false result)", async () => {
    mockedJsonRpc.mockResolvedValue(false);

    await expect(
      OdooClient.authenticate({
        url: "https://odoo.example.com",
        db: "testdb",
        login: "admin",
        apiKey: "wrong-key",
      }),
    ).rejects.toThrow("Authentication failed");
  });
});
