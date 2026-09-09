/** Accepted formatting retained by a pending formatting proposal. */
export type ReviewFormatRun = Readonly<{ text: string; format: number }>;

export function isSupportedFormat(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 15
  );
}

export function isValidFormatRuns(
  value: unknown,
): value is readonly ReviewFormatRun[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (run) =>
        typeof run === "object" &&
        run !== null &&
        Object.keys(run).length === 2 &&
        typeof run.text === "string" &&
        run.text.length > 0 &&
        isSupportedFormat(run.format),
    )
  );
}

export function canonicalFormatRuns(
  runs: readonly ReviewFormatRun[],
): ReviewFormatRun[] {
  const result: Array<{ text: string; format: number }> = [];
  for (const run of runs) {
    const last = result.at(-1);
    if (last?.format === run.format) last.text += run.text;
    else result.push({ text: run.text, format: run.format });
  }
  return result;
}

export function sameFormatRuns(
  left: readonly ReviewFormatRun[],
  right: readonly ReviewFormatRun[],
): boolean {
  return (
    JSON.stringify(canonicalFormatRuns(left)) ===
    JSON.stringify(canonicalFormatRuns(right))
  );
}
