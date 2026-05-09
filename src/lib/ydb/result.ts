type YdbCell = {
  bytesValue?: Uint8Array | Buffer;
  textValue?: string;
  uint32Value?: number;
  uint64Value?: string | number | { toString(): string };
};

type YdbRow = {
  items?: YdbCell[];
};

export function rowsFromResult(result: unknown): YdbRow[] {
  const resultSets = (result as { resultSets?: Array<{ rows?: YdbRow[] }> })
    .resultSets;
  return resultSets?.[0]?.rows ?? [];
}

export function textAt(row: YdbRow, index: number): string {
  return row.items?.[index]?.textValue ?? "";
}

export function uintAt(row: YdbRow, index: number): number {
  const cell = row.items?.[index];
  const value = cell?.uint32Value ?? cell?.uint64Value ?? 0;
  return Number(value);
}

export function bytesAt(row: YdbRow, index: number): Buffer {
  const value = row.items?.[index]?.bytesValue;
  if (!value) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
