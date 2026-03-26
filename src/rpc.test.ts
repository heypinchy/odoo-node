import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jsonRpc, OdooError } from "./rpc.js";

describe("jsonRpc", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct JSON-RPC 2.0 envelope", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 42 })),
    );

    await jsonRpc("https://odoo.example.com", "common", "version", []);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://odoo.example.com/jsonrpc",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: expect.any(Number),
      method: "call",
      params: {
        service: "common",
        method: "version",
        args: [],
      },
    });
  });

  it("returns result on success", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { version: "17.0" } })),
    );

    const result = await jsonRpc("https://odoo.example.com", "common", "version", []);
    expect(result).toEqual({ version: "17.0" });
  });

  it("throws OdooError on JSON-RPC error response", async () => {
    const errorBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: 200,
        message: "Odoo Server Error",
        data: { message: "Access Denied" },
      },
    });
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response(errorBody));

    await expect(
      jsonRpc("https://odoo.example.com", "object", "execute_kw", []),
    ).rejects.toThrow(OdooError);

    await expect(
      jsonRpc("https://odoo.example.com", "object", "execute_kw", []),
    ).rejects.toThrow("Access Denied");
  });

  it("OdooError has code and data fields", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: 200,
            message: "Odoo Server Error",
            data: { message: "Record not found", debug: "traceback..." },
          },
        }),
      ),
    );

    try {
      await jsonRpc("https://odoo.example.com", "object", "execute_kw", []);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OdooError);
      const odooErr = err as OdooError;
      expect(odooErr.code).toBe(200);
      expect(odooErr.data).toEqual({ message: "Record not found", debug: "traceback..." });
    }
  });

  it("throws OdooError on HTTP error", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(
      async () => new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
    );

    await expect(
      jsonRpc("https://odoo.example.com", "common", "version", []),
    ).rejects.toThrow(OdooError);

    await expect(
      jsonRpc("https://odoo.example.com", "common", "version", []),
    ).rejects.toThrow("HTTP 500: Internal Server Error");
  });

  it("throws OdooError on network failure", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      jsonRpc("https://odoo.example.com", "common", "version", []),
    ).rejects.toThrow(OdooError);
  });
});
