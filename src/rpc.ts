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
    // The original error stays as the cause: its name tells a timeout (a write may have
    // committed) from a refused connection.
    throw new OdooError(err instanceof Error ? err.message : "Network error", 0, undefined, {
      cause: err,
    });
  }

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel();
    throw new OdooError(
      `Odoo answered with a redirect (HTTP ${response.status}); odoo-node does not follow ` +
        "redirects. Use the address Odoo is actually served from.",
      response.status,
    );
  }

  if (!response.ok) {
    // An unread body keeps its connection busy until something times out.
    await response.body?.cancel();
    throw new OdooError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  const json = await readJsonRpc<T>(response);

  if (json.error) {
    throw new OdooError(
      json.error.data.message,
      json.error.code,
      json.error.data as unknown as Record<string, unknown>,
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
async function readJsonRpc<T>(response: Response): Promise<JsonRpcResponse<T>> {
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    // The original error stays as the cause: its name tells a timeout (a write may have
    // committed) from a refused connection.
    throw new OdooError(err instanceof Error ? err.message : "Network error", 0, undefined, {
      cause: err,
    });
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
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().slice(0, 100);
    throw new OdooError(
      `Response is not JSON-RPC (HTTP ${response.status}, ${contentType || "no content type"})`,
      response.status,
    );
  }

  return json as JsonRpcResponse<T>;
}
