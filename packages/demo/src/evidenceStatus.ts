/**
 * Document-evidence freshness for #77.
 *
 * The four states are exhaustive: any generation failure (composition gate,
 * preview refusal/throw, invalid export) is `unavailable`, never a
 * side-channel alongside `current`/`stale`. The human-readable reason
 * (composition vs failure message) is derived separately by the caller.
 */
export type EvidenceStatus =
  "not-generated" | "current" | "stale" | "unavailable";

export function deriveEvidenceStatus(
  input: Readonly<{
    isComposing: boolean;
    hasEvidence: boolean;
    isStale: boolean;
    hasGenerationFailure: boolean;
  }>,
): EvidenceStatus {
  if (input.isComposing || input.hasGenerationFailure) return "unavailable";
  if (!input.hasEvidence) return "not-generated";
  if (input.isStale) return "stale";
  return "current";
}
