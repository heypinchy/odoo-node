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

  it("reports a JSON-RPC error that carries no data by its own message", async () => {
    // Plain JSON-RPC 2.0, as a proxy or a non-Odoo server sends it: no "data" member.
    const errorBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid Request" },
    });
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response(errorBody));

    const err = await jsonRpc("https://odoo.example.com", "common", "version", []).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(OdooError);
    expect((err as OdooError).message).toBe("Invalid Request");
    expect((err as OdooError).code).toBe(-32600);
  });

  it("reports a JSON-RPC error that carries no message at all as not JSON-RPC", async () => {
    // An envelope of the wrong shape says nothing a caller could use; its members are whatever
    // the other side chose to send.
    const errorBody = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { "my-role": 1 } });
    vi.mocked(globalThis.fetch).mockImplementation(
      async () => new Response(errorBody, { headers: { "Content-Type": "application/json" } }),
    );

    const err = await jsonRpc("https://odoo.example.com", "common", "version", []).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(OdooError);
    expect((err as OdooError).message).toBe(
      "Response is not JSON-RPC (HTTP 200, application/json)",
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

  it("releases the body of an HTTP error instead of leaving it unread", async () => {
    // An unread body keeps its connection busy until something times out — a
    // proxy's multi-megabyte 502 page would otherwise hold the socket.
    const response = new Response("x".repeat(1024 * 1024), { status: 502 });
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    await expect(jsonRpc("https://odoo.example.com", "common", "version", [])).rejects.toThrow(
      "HTTP 502",
    );
    expect(response.bodyUsed).toBe(true);
  });

  it("keeps the network error as the cause, so a timeout can be told from a refusal", async () => {
    const failure = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.mocked(globalThis.fetch).mockRejectedValue(failure);

    const err = await jsonRpc("https://odoo.example.com", "common", "version", []).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OdooError);
    expect((err as OdooError).cause).toBe(failure);
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

  // Odoo 14–19 build every JSON-RPC answer as {"jsonrpc": "2.0", "id": …} and add "result" only
  // when the method returned something other than None (15.0 `_json_response`, 16.0+
  // `JsonRPCDispatcher._response`). So a method that returns None — account.move.line.reconcile,
  // or account.move.js_assign_outstanding_line in Odoo 19 — answers with no "result" key at all,
  // after its write has committed. That is a successful call, not a malformed answer.
  describe("when the Odoo method returns None", () => {
    const voidAnswer = JSON.stringify({ jsonrpc: "2.0", id: 1 });

    function startVoidOdoo() {
      return startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(voidAnswer);
      });
    }

    it("resolves jsonRpc to undefined", async () => {
      const odoo = await startVoidOdoo();

      await expect(jsonRpc(odoo.url, "object", "execute_kw", [])).resolves.toBeUndefined();
    });

    it("resolves OdooClient.callMethod to undefined", async () => {
      const odoo = await startVoidOdoo();
      const client = new OdooClient({ url: odoo.url, db: "db", uid: 2, apiKey: "secret" });

      await expect(
        client.callMethod("account.move.line", "reconcile", [[1, 2]]),
      ).resolves.toBeUndefined();
    });
  });

  it("returns an explicit null result as null", async () => {
    const odoo = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }));
    });

    await expect(jsonRpc(odoo.url, "common", "version", [])).resolves.toBeNull();
  });

  it("still accepts an answer that carries a result but no jsonrpc member", async () => {
    const odoo = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: 7 }));
    });

    await expect(jsonRpc(odoo.url, "common", "version", [])).resolves.toBe(7);
  });

  it("reports an empty 204 answer as not JSON-RPC", async () => {
    const odoo = await startServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    const err = await rejectionOf(jsonRpc(odoo.url, "common", "version", []));

    expect(err.message).toBe("Response is not JSON-RPC (HTTP 204, no content type)");
    expect(err.code).toBe(204);
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

  // An object with none of "jsonrpc", "result" or "error" (a proxy's {"detail": "…"}) is not
  // Odoo's answer; resolving it as a void result would report a write that never ran as done.
  it.each([["null"], ["[1, 2]"], ['"BODY-MARKER"'], ["{}"], ['{"detail":"BODY-MARKER"}']])(
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

// A caller that has to control the connection — pin it to addresses it checked, route it through
// a proxy, bound how long it may take — hands odoo-node its own fetch and signal instead of
// replacing the process-wide global. These run against a real server too: the point is that the
// request goes through the caller's fetch and the global one is never touched.
describe("jsonRpc with a fetch and signal supplied by the caller", () => {
  const servers: Server[] = [];
  const originalFetch = globalThis.fetch;

  async function startServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  function answering(result: unknown) {
    return (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    };
  }

  beforeEach(() => {
    // Any request that reaches the global fetch fails the test.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("the global fetch must not be called");
      }),
    );
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
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

  it("sends the request through the fetch it was given", async () => {
    const url = await startServer(answering(7));
    const ownFetch = vi.fn<typeof fetch>((input, init) => originalFetch(input, init));

    await expect(jsonRpc(url, "common", "version", [], { fetch: ownFetch })).resolves.toBe(7);

    expect(ownFetch).toHaveBeenCalledTimes(1);
    expect(ownFetch.mock.calls[0][0]).toBe(`${url}/jsonrpc`);
    expect(ownFetch.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("still refuses a redirect the given fetch returns", async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(307, { Location: "http://169.254.169.254/jsonrpc" });
      res.end();
    });
    const ownFetch: typeof fetch = (input, init) => originalFetch(input, init);

    await expect(jsonRpc(url, "common", "version", [], { fetch: ownFetch })).rejects.toThrow(
      "Odoo answered with a redirect (HTTP 307)",
    );
  });

  it("hands the signal to fetch, so aborting it ends a request Odoo never answers", async () => {
    // Accepts the connection and never answers: without the signal this call would hang.
    const url = await startServer(() => {});
    const controller = new AbortController();
    const ownFetch: typeof fetch = (input, init) => originalFetch(input, init);

    const call = jsonRpc(url, "common", "version", [], {
      fetch: ownFetch,
      signal: controller.signal,
    });
    controller.abort();

    const err = await call.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OdooError);
    expect((err as OdooError).message).toMatch(/abort/i);
  });

  it("names a deliberate abort even when its reason is not an Error", async () => {
    const url = await startServer(() => {});
    const controller = new AbortController();
    const ownFetch: typeof fetch = (input, init) => originalFetch(input, init);

    const call = jsonRpc(url, "common", "version", [], {
      fetch: ownFetch,
      signal: controller.signal,
    });
    controller.abort("shutdown");

    const err = await call.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OdooError);
    expect((err as OdooError).message).toBe("Request aborted");
    expect((err as OdooError).cause).toBe("shutdown");
  });

  it("refuses an answer the given fetch reached by following a redirect itself", async () => {
    // The target stands in for an address the caller never checked.
    const target = await startServer(answering(2));
    const url = await startServer((_req, res) => {
      res.writeHead(307, { Location: `${target}/jsonrpc` });
      res.end();
    });
    const following: typeof fetch = (input, init) =>
      originalFetch(input, { ...init, redirect: "follow" });

    await expect(jsonRpc(url, "common", "version", [], { fetch: following })).rejects.toThrow(
      "Odoo answered with a redirect",
    );
  });

  it("reports an HTTP error by its status even when its body has already failed", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    const ownFetch: typeof fetch = async () =>
      new Response(broken, { status: 502, statusText: "Bad Gateway" });

    const err = await jsonRpc("http://odoo.test", "common", "version", [], {
      fetch: ownFetch,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OdooError);
    expect((err as OdooError).message).toBe("HTTP 502: Bad Gateway");
  });

  it("routes every OdooClient call through the client's fetch and signal", async () => {
    const url = await startServer(answering(2));
    const signal = new AbortController().signal;
    const ownFetch = vi.fn<typeof fetch>((input, init) => originalFetch(input, init));

    const uid = await OdooClient.authenticate({
      url,
      db: "db",
      login: "admin",
      apiKey: "key",
      fetch: ownFetch,
      signal,
    });
    const client = new OdooClient({ url, db: "db", uid, apiKey: "key", fetch: ownFetch, signal });
    await client.searchCount("res.partner", []);

    expect(ownFetch).toHaveBeenCalledTimes(2);
    for (const [, init] of ownFetch.mock.calls) expect(init?.signal).toBe(signal);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
