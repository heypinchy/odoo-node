/**
 * How odoo-node reaches Odoo. Both are optional; without them every call uses the global `fetch`
 * and has no deadline.
 */
export interface OdooTransport {
  /**
   * The `fetch` every request goes through, instead of the global one. Use it to control the
   * connection without replacing the process-wide `fetch`: pin it to addresses you checked, send
   * it through a proxy or a custom dispatcher, add a timeout. It is always called with a URL
   * string, never a `Request`. It must not follow redirects itself: odoo-node asks for
   * `redirect: "manual"` and refuses any answer that comes from a redirect.
   */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * Passed to every request. Aborting it fails the call in flight with an `OdooError`. It belongs
   * to the client: once aborted, every later call fails at once. For a deadline per call, add it
   * in `fetch` instead.
   */
  signal?: AbortSignal;
}

export interface OdooClientConfig extends OdooTransport {
  url: string;
  db: string;
  uid: number;
  apiKey: string;
}

export interface OdooAuthConfig extends OdooTransport {
  url: string;
  db: string;
  login: string;
  apiKey: string;
}

export interface OdooVersion {
  serverVersion: string;
  serverVersionInfo: (number | string)[];
  protocolVersion: number;
}

export interface OdooModel {
  model: string;
  name: string;
}

export interface OdooField {
  name: string;
  string: string;
  type: string;
  required: boolean;
  readonly: boolean;
  relation?: string;
  selection?: [string, string][];
}

export type OdooDomainTuple = [string, string, unknown];
export type OdooDomainOperator = "&" | "|" | "!";
export type OdooDomain = (OdooDomainTuple | OdooDomainOperator)[];

export interface SearchReadOptions {
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
}

export interface SearchReadResult<T> {
  records: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReadGroupOptions {
  orderby?: string;
  limit?: number;
  offset?: number;
  lazy?: boolean;
}

export interface ReadGroupResult {
  groups: Record<string, unknown>[];
}

export interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    /** Odoo always sends it; a plain JSON-RPC 2.0 error does not. */
    data?: { message: string };
  };
}
