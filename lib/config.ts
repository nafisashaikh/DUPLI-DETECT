// Small config helpers for both server/client bundles.

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readNumber(envValue: string | undefined): number | undefined {
  if (!envValue) return undefined;
  const n = Number(envValue);
  return Number.isFinite(n) ? n : undefined;
}

export function defaultThreshold01(): number {
  // Stored as 0..1 for API; allow user to set either percent (70) or ratio (0.7)
  const raw = readNumber(process.env.NEXT_PUBLIC_DEFAULT_THRESHOLD);
  if (raw === undefined) return 0.7;
  const as01 = raw > 1 ? raw / 100 : raw;
  return clamp(as01, 0.01, 0.99);
}

export function defaultThresholdPercent(): number {
  return Math.round(defaultThreshold01() * 100);
}

export function defaultBulkChunkSize(): number {
  const raw = readNumber(process.env.NEXT_PUBLIC_BULK_CHUNK_SIZE);
  if (raw === undefined) return 200;
  return Math.floor(clamp(raw, 1, 2000));
}
