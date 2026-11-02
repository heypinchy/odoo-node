import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { OdooClient } from "./client.js";
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

    await expect(jsonRpc("https://odoo.example.com", "object", "execute_kw", [])).rejects.toThrow(
      OdooError,
    );

    await expect(jsonRpc("https://odoo.example.com", "object", "execute_kw", [])).rejects.toThrow(
      "Access Denied",
    );
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
      async () =>
        new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
    );

    await expect(jsonRpc("https://odoo.example.com", "common", "version", [])).rejects.toThrow(
      OdooError,
    );

    await expect(jsonRpc("https://odoo.example.com", "common", "version", [])).rejects.toThrow(
      "HTTP 500: Internal Server Error",
    );
  });

  it("throws OdooError on network failure", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("fetch failed"));

    await expect(jsonRpc("https://odoo.example.com", "common", "version", [])).rejects.toThrow(
      OdooError,
    );
  });
});

// These run against real HTTP servers on 127.0.0.1 and the real global fetch, not a stub:
// redirect handling is fetch's behaviour, so a stubbed fetch could not prove anything about it.
describe("jsonRpc against a real HTTP server", () => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;

  const servers: Server[] = [];

  async function startServer(handler: Handler): Promise<{ url: string; requests: string[] }> {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push(body);
        handler(req, res);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, requests };
  }

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });

  async function rejectionOf(promise: Promise<unknown>): Promise<OdooError> {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(OdooError);
      return err as OdooError;
    }
    throw new Error("expected the call to reject");
  }

  const jsonRpcResult = JSON.stringify({ jsonrpc: "2.0", id: 1, result: 7 });

  describe.each([301, 302, 303, 307, 308])("when Odoo answers with HTTP %i", (status) => {
    it("refuses the redirect and never contacts the redirect target", async () => {
      // The target stands in for 169.254.169.254 / loopback: anything the caller's
      // SSRF check would have refused had it been the configured URL.
      const target = await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(jsonRpcResult);
      });
      const odoo = await startServer((_req, res) => {
        res.writeHead(status, { Location: `${target.url}/jsonrpc` });
        res.end();
      });

      const err = await rejectionOf(
        jsonRpc(odoo.url, "common", "authenticate", ["db", "admin", "secret-api-key", {}]),
      );

      expect(err.message).toBe(
        `Odoo answered with a redirect (HTTP ${status}); odoo-node does not follow redirects. ` +
          "Use the address Odoo is actually served from.",
      );
      expect(err.code).toBe(status);
      expect(odoo.requests).toHaveLength(1);
      expect(target.requests).toHaveLength(0);
    });
  });

  it("does not send the API key to a redirect target via OdooClient.authenticate", async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(jsonRpcResult);
    });
    const odoo = await startServer((_req, res) => {
      res.writeHead(307, { Location: `${target.url}/jsonrpc` });
      res.end();
    });

    await rejectionOf(
      OdooClient.authenticate({ url: odoo.url, db: "db", login: "admin", apiKey: "secret" }),
    );

    expect(target.requests).toHaveLength(0);
  });

  it("still returns the result of a plain JSON-RPC answer", async () => {
    const odoo = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(jsonRpcResult);
    });

    await expect(jsonRpc(odoo.url, "common", "version", [])).resolves.toBe(7);
  });

  it("reports a non-JSON answer without quoting the response body", async () => {
    const odoo = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>BODY-MARKER internal hostname db-01.corp</body></html>");
    });

    const err = await rejectionOf(jsonRpc(odoo.url, "common", "version", []));

    expect(err.message).toBe("Response is not JSON-RPC (HTTP 200, text/html)");
    expect(err.message).not.toContain("BODY-MARKER");
    expect(JSON.stringify(err)).not.toContain("BODY-MARKER");
    expect(String(err.stack)).not.toContain("BODY-MARKER");
  });

  it("reports an answer without a content type", async () => {
    const odoo = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("BODY-MARKER");
    });

    const err = await rejectionOf(jsonRpc(odoo.url, "common", "version", []));

    expect(err.message).toBe("Response is not JSON-RPC (HTTP 200, no content type)");
  });

  it.each([["null"], ["[1, 2]"], ['"BODY-MARKER"'], ['{"jsonrpc":"2.0","id":1}']])(
    "reports valid JSON that is not a JSON-RPC envelope (%s) the same way",
    async (body) => {
      const odoo = await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      });

      const err = await rejectionOf(jsonRpc(odoo.url, "common", "version", []));

      expect(err.message).toBe("Response is not JSON-RPC (HTTP 200, application/json)");
    },
  );

  it("keeps reporting a JSON-RPC error payload with Odoo's message", async () => {
    const odoo = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: 200, message: "Odoo Server Error", data: { message: "Access Denied" } },
        }),
      );
    });

    const err = await rejectionOf(jsonRpc(odoo.url, "common", "authenticate", []));

    expect(err.message).toBe("Access Denied");
    expect(err.code).toBe(200);
  });
});
