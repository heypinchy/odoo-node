export interface OdooClientConfig {
  url: string;
  db: string;
  uid: number;
  apiKey: string;
}

export interface OdooAuthConfig {
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
    data: { message: string };
  };
}
