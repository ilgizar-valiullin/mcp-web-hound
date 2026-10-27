/**
 * Plain JSON tool definitions (zero dependencies).
 * Imported by the cold main at startup so tools/list answers instantly
 * without loading better-sqlite3 / providers / transformers.
 * Handlers live next to them and run in main (github/gitlab) or hot worker.
 */

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: ToolHandler;
}

function reqString(args: Record<string, unknown>, field: string): string {
  const v = args[field];
  if (typeof v !== 'string' || v.length < 1) {
    throw new Error(`'${field}' must be a non-empty string`);
  }
  return v;
}

function optString(args: Record<string, unknown>, field: string): string | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(`'${field}' must be a string`);
  return v;
}

function optEnum<T extends string>(args: Record<string, unknown>, field: string, values: readonly T[], def: T): T {
  const v = args[field];
  if (v === undefined) return def;
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    throw new Error(`'${field}' must be one of: ${values.join(', ')}`);
  }
  return v as T;
}

function optInt(args: Record<string, unknown>, field: string, def: number, min: number): number {
  const v = args[field];
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.floor(v) < min) {
    throw new Error(`'${field}' must be an integer >= ${min}`);
  }
  return Math.floor(v);
}

function optStringArray(args: Record<string, unknown>, field: string, minItems: number): string[] {
  const v = args[field];
  if (!Array.isArray(v) || v.length < minItems || v.some((t) => typeof t !== 'string')) {
    throw new Error(`'${field}' must be an array of at least ${minItems} string(s)`);
  }
  return v as string[];
}

export const validators = { reqString, optString, optEnum, optInt, optStringArray };
