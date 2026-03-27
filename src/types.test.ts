import { describe, it, expectTypeOf } from "vitest";
import type {
  OdooClientConfig,
  OdooAuthConfig,
  OdooVersion,
  OdooModel,
  OdooField,
  OdooDomain,
  SearchReadOptions,
  SearchReadResult,
  ReadGroupOptions,
  ReadGroupResult,
  JsonRpcResponse,
} from "./types.js";

describe("types", () => {
  it("OdooClientConfig has required fields", () => {
    expectTypeOf<OdooClientConfig>().toHaveProperty("url");
    expectTypeOf<OdooClientConfig>().toHaveProperty("db");
    expectTypeOf<OdooClientConfig>().toHaveProperty("uid");
    expectTypeOf<OdooClientConfig>().toHaveProperty("apiKey");
    expectTypeOf<OdooClientConfig["url"]>().toBeString();
    expectTypeOf<OdooClientConfig["db"]>().toBeString();
    expectTypeOf<OdooClientConfig["uid"]>().toBeNumber();
    expectTypeOf<OdooClientConfig["apiKey"]>().toBeString();
  });

  it("OdooAuthConfig has required fields", () => {
    expectTypeOf<OdooAuthConfig>().toHaveProperty("url");
    expectTypeOf<OdooAuthConfig>().toHaveProperty("db");
    expectTypeOf<OdooAuthConfig>().toHaveProperty("login");
    expectTypeOf<OdooAuthConfig>().toHaveProperty("apiKey");
  });

  it("OdooVersion has required fields", () => {
    expectTypeOf<OdooVersion>().toHaveProperty("serverVersion");
    expectTypeOf<OdooVersion>().toHaveProperty("serverVersionInfo");
    expectTypeOf<OdooVersion>().toHaveProperty("protocolVersion");
  });

  it("OdooModel has model and name", () => {
    expectTypeOf<OdooModel>().toHaveProperty("model");
    expectTypeOf<OdooModel>().toHaveProperty("name");
    expectTypeOf<OdooModel["model"]>().toBeString();
    expectTypeOf<OdooModel["name"]>().toBeString();
  });

  it("OdooField has required fields", () => {
    expectTypeOf<OdooField>().toHaveProperty("name");
    expectTypeOf<OdooField>().toHaveProperty("string");
    expectTypeOf<OdooField>().toHaveProperty("type");
    expectTypeOf<OdooField>().toHaveProperty("required");
    expectTypeOf<OdooField>().toHaveProperty("readonly");
  });

  it("OdooField has optional relation and selection", () => {
    const field: OdooField = {
      name: "partner_id",
      string: "Partner",
      type: "many2one",
      required: false,
      readonly: false,
      relation: "res.partner",
    };
    expectTypeOf(field.relation).toEqualTypeOf<string | undefined>();
    expectTypeOf(field.selection).toEqualTypeOf<[string, string][] | undefined>();
  });

  it("OdooDomain supports tuples and logic operators", () => {
    const domain: OdooDomain = ["&", ["name", "=", "test"], ["active", "=", true]];
    expectTypeOf(domain).toMatchTypeOf<OdooDomain>();
  });

  it("SearchReadOptions has optional fields", () => {
    const opts: SearchReadOptions = {};
    const full: SearchReadOptions = {
      fields: ["name"],
      limit: 10,
      offset: 0,
      order: "name asc",
    };
    expectTypeOf(opts).toMatchTypeOf<SearchReadOptions>();
    expectTypeOf(full).toMatchTypeOf<SearchReadOptions>();
  });

  it("SearchReadResult is generic", () => {
    type Partner = { name: string; id: number };
    const result: SearchReadResult<Partner> = {
      records: [{ name: "Test", id: 1 }],
      total: 1,
      limit: 100,
      offset: 0,
    };
    expectTypeOf(result.records).toEqualTypeOf<Partner[]>();
    expectTypeOf(result.total).toBeNumber();
  });

  it("ReadGroupOptions has optional fields", () => {
    const opts: ReadGroupOptions = {};
    const full: ReadGroupOptions = {
      orderby: "name asc",
      limit: 10,
      offset: 0,
      lazy: true,
    };
    expectTypeOf(opts).toMatchTypeOf<ReadGroupOptions>();
    expectTypeOf(full).toMatchTypeOf<ReadGroupOptions>();
  });

  it("ReadGroupResult has groups array", () => {
    const result: ReadGroupResult = {
      groups: [{ partner_id: [1, "Test"], partner_id_count: 5 }],
    };
    expectTypeOf(result.groups).toBeArray();
  });

  it("JsonRpcResponse is generic with result or error", () => {
    const success: JsonRpcResponse<number> = {
      jsonrpc: "2.0",
      id: 1,
      result: 42,
    };
    const failure: JsonRpcResponse<number> = {
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: 200,
        message: "Odoo Server Error",
        data: { message: "not found" },
      },
    };
    expectTypeOf(success.result).toEqualTypeOf<number | undefined>();
    expectTypeOf(failure.error).toMatchTypeOf<
      { code: number; message: string; data: { message: string } } | undefined
    >();
  });
});
