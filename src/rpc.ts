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
    });
  } catch (err) {
    throw new OdooError(
      err instanceof Error ? err.message : "Network error",
    );
  }

  if (!response.ok) {
    throw new OdooError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
    );
  }

  const json = (await response.json()) as JsonRpcResponse<T>;

  if (json.error) {
    throw new OdooError(
      json.error.data.message,
      json.error.code,
      json.error.data as unknown as Record<string, unknown>,
    );
  }

  return json.result as T;
}
