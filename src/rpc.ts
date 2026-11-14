import type { JsonRpcResponse, OdooTransport } from "./types.js";

export class OdooError extends Error {
  code: number;
  data?: Record<string, unknown>;

  constructor(
    message: string,
    code: number = 0,
    data?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "OdooError";
    this.code = code;
    this.data = data;
  }
}

let requestId = 0;

export async function jsonRpc<T>(
  baseUrl: string,
  service: string,
  method: string,
  args: unknown[],
  transport: OdooTransport = {},
): Promise<T> {
  const id = ++requestId;
  const url = `${baseUrl}/jsonrpc`;
  const payload = {
    jsonrpc: "2.0",
    id,
    method: "call",
    params: { service, method, args },
  };

  let response: Response;
  try {
    const send = transport.fetch ?? fetch;
    response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Never follow a redirect. Callers validate the Odoo URL (e.g. against SSRF rules) before
      // connecting; following a 3xx would hand the request to an address nobody validated, and a
      // 307/308 re-sends this POST body, API key included. Odoo's JSON-RPC endpoint never
      // redirects. "manual" rather than "error": "error" surfaces as a bare "fetch failed",
      // while "manual" lets us name the status in the error.
      redirect: "manual",
      signal: transport.signal,
    });
  } catch (err) {
    throw networkError(err, transport.signal);
  }

  // `redirected` catches a given fetch that followed the hop itself, whatever it was asked: the
  // request already went out, but its answer came from an address nobody checked. Its status is
  // the target's, so the message names neither.
  if (response.redirected) {
    await discardBody(response);
    throw new OdooError(
      "Odoo's answer came through a redirect that the given fetch followed. Pass a fetch that " +
        'keeps redirect: "manual", and use the address Odoo is actually served from.',
      response.status,
    );
  }

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    await discardBody(response);
    throw new OdooError(
      `Odoo answered with a redirect (HTTP ${response.status}); odoo-node does not follow ` +
        "redirects. Use the address Odoo is actually served from.",
      response.status,
    );
  }

  if (!response.ok) {
    await discardBody(response);
    throw new OdooError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  const json = await readJsonRpc<T>(response, transport.signal);

  if (json.error) {
    // Odoo puts its message in error.data; a plain JSON-RPC 2.0 error (a proxy, a server that
    // is not Odoo) has only error.message. An empty data.message (Odoo's str() of an exception
    // raised without arguments) falls back to error.message. An error carrying neither is not an
    // answer to report.
    const error = json.error as Partial<NonNullable<JsonRpcResponse<T>["error"]>>;
    const message =
      typeof error.data?.message === "string" && error.data.message !== ""
        ? error.data.message
        : typeof error.message === "string"
          ? error.message
          : undefined;
    if (message === undefined) throw notJsonRpc(response);
    throw new OdooError(
      message,
      error.code,
      error.data as unknown as Record<string, unknown> | undefined,
    );
  }

  return json.result as T;
}

// Parses the body as a JSON-RPC envelope. Anything else is reported by status and content type
// only: JSON.parse's SyntaxError quotes the start of the body, and that text is not ours to put
// in an error message callers show to people.
//
// An envelope is a JSON object carrying "jsonrpc", "result" or "error". "result" alone is not
// required: Odoo 14–19 always send {"jsonrpc": "2.0", "id": …} and add "result" only when the
// method returned something other than None, so a void method (account.move.line.reconcile)
// answers without one — after its write committed. "jsonrpc" alone is not required either:
// answers shaped {"result": …} were accepted before and stay accepted.
async function readJsonRpc<T>(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<JsonRpcResponse<T>> {
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw networkError(err, signal);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (
    typeof json !== "object" ||
    json === null ||
    Array.isArray(json) ||
    !("jsonrpc" in json || "result" in json || "error" in json)
  ) {
    throw notJsonRpc(response);
  }

  return json as JsonRpcResponse<T>;
}

// The original error stays as the cause: its name tells a timeout (a write may have committed)
// from a refused connection. An abort whose reason is not an Error (`abort("shutdown")`) rejects
// with that bare reason; it is named as an abort, not as a network failure. An Error is
// recognised by its message, not by `instanceof`: one from another realm (a vm context, jsdom)
// fails that check.
function networkError(err: unknown, signal: AbortSignal | undefined): OdooError {
  const message =
    err instanceof Error || typeof (err as { message?: unknown } | null)?.message === "string"
      ? (err as Error).message
      : signal?.aborted
        ? "Request aborted"
        : "Network error";
  return new OdooError(message, 0, undefined, { cause: err });
}

// An unread body keeps its connection busy until something times out. Releasing it is cleanup
// only: a body that already failed, or one that is not a web stream (node-fetch hands back a
// Node stream without cancel()), must not replace the error the caller is about to get.
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release, or nothing more to do.
  }
}

// Status and content type only, never the body: see readJsonRpc.
function notJsonRpc(response: Response): OdooError {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().slice(0, 100);
  return new OdooError(
    `Response is not JSON-RPC (HTTP ${response.status}, ${contentType || "no content type"})`,
    response.status,
  );
}
