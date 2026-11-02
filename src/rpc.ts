import type { JsonRpcResponse } from "./types.js";

export class OdooError extends Error {
  code: number;
  data?: Record<string, unknown>;

  constructor(message: string, code: number = 0, data?: Record<string, unknown>) {
    super(message);
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
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Never follow a redirect. Callers validate the Odoo URL (e.g. against SSRF rules) before
      // connecting; following a 3xx would hand the request to an address nobody validated, and a
      // 307/308 re-sends this POST body, API key included. Odoo's JSON-RPC endpoint never
      // redirects. "manual" rather than "error": "error" surfaces as a bare "fetch failed",
      // while "manual" lets us name the status in the error.
      redirect: "manual",
    });
  } catch (err) {
    throw new OdooError(err instanceof Error ? err.message : "Network error");
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
    throw new OdooError(err instanceof Error ? err.message : "Network error");
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
