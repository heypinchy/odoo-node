import { jsonRpc, OdooError } from "./rpc.js";
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
} from "./types.js";

const DEFAULT_LIMIT = 100;

export class OdooClient {
  private url: string;
  private db: string;
  private uid: number;
  private apiKey: string;

  constructor(config: OdooClientConfig) {
    this.url = config.url;
    this.db = config.db;
    this.uid = config.uid;
    this.apiKey = config.apiKey;
  }

  static async authenticate(auth: OdooAuthConfig): Promise<number> {
    const uid = await jsonRpc<number | false>(
      auth.url,
      "common",
      "authenticate",
      [auth.db, auth.login, auth.apiKey, {}],
    );
    if (uid === false) {
      throw new OdooError("Authentication failed");
    }
    return uid;
  }

  async version(): Promise<OdooVersion> {
    const raw = await jsonRpc<{
      server_version: string;
      server_version_info: (number | string)[];
      protocol_version: number;
    }>(this.url, "common", "version", []);

    return {
      serverVersion: raw.server_version,
      serverVersionInfo: raw.server_version_info,
      protocolVersion: raw.protocol_version,
    };
  }

  async models(): Promise<OdooModel[]> {
    return this.execute<OdooModel[]>(
      "ir.model",
      "search_read",
      [[]],
      { fields: ["model", "name"] },
    );
  }

  async fields(model: string): Promise<OdooField[]> {
    const raw = await this.execute<Record<string, Omit<OdooField, "name">>>(
      model,
      "fields_get",
      [],
      {
        attributes: [
          "string",
          "type",
          "required",
          "readonly",
          "relation",
          "selection",
        ],
      },
    );

    return Object.entries(raw).map(([name, field]) => ({
      name,
      ...field,
    }));
  }

  async searchRead<T = Record<string, unknown>>(
    model: string,
    domain: OdooDomain,
    options?: SearchReadOptions,
  ): Promise<SearchReadResult<T>> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const offset = options?.offset ?? 0;

    const [total, records] = await Promise.all([
      this.execute<number>(model, "search_count", [domain], {}),
      this.execute<T[]>(model, "search_read", [domain], {
        fields: options?.fields,
        limit,
        offset,
        order: options?.order,
      }),
    ]);

    return { records, total, limit, offset };
  }

  async searchCount(model: string, domain: OdooDomain): Promise<number> {
    return this.execute<number>(model, "search_count", [domain], {});
  }

  async readGroup(
    model: string,
    domain: OdooDomain,
    fields: string[],
    groupby: string[],
    options?: ReadGroupOptions,
  ): Promise<ReadGroupResult> {
    const groups = await this.execute<Record<string, unknown>[]>(
      model,
      "read_group",
      [domain],
      {
        fields,
        groupby,
        orderby: options?.orderby,
        limit: options?.limit,
        offset: options?.offset,
        lazy: options?.lazy,
      },
    );

    return { groups };
  }

  async create(
    model: string,
    values: Record<string, unknown>,
  ): Promise<number> {
    return this.execute<number>(model, "create", [values], {});
  }

  async write(
    model: string,
    ids: number[],
    values: Record<string, unknown>,
  ): Promise<boolean> {
    return this.execute<boolean>(model, "write", [ids, values], {});
  }

  async unlink(model: string, ids: number[]): Promise<boolean> {
    return this.execute<boolean>(model, "unlink", [ids], {});
  }

  private execute<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs?: Record<string, unknown>,
  ): Promise<T> {
    return jsonRpc<T>(this.url, "object", "execute_kw", [
      this.db,
      this.uid,
      this.apiKey,
      model,
      method,
      args,
      kwargs ?? {},
    ]);
  }
}
