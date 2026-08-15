import type { Driver } from "ydb-sdk";

export const TypedValues: typeof import("ydb-sdk").TypedValues;
type CliEnvironment = Record<string, string | undefined>;

export function readYdbCliConfig(env?: CliEnvironment): {
  endpoint: string;
  database: string;
};
export function createYdbCliDriver(options?: {
  env?: CliEnvironment;
}): { endpoint: string; database: string; driver: Driver };
export function withYdbCliDriver<T>(
  callback: (driver: Driver) => Promise<T>,
  options?: { env?: CliEnvironment; readyTimeoutMs?: number },
): Promise<T>;
export function executeYdbQuery(
  driver: Driver,
  statement: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export function rowsFromResult(result: unknown): unknown[];
export function textAt(row: unknown, index: number): string;
export function uint32At(row: unknown, index: number): number;
export function parseStringArray(value: string): string[];
export function isLocalYdbEndpoint(value: string): boolean;
