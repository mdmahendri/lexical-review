import { validateReviewDocument, type ReviewDocumentV3 } from "lexical-review";

export type FragmentExportContext = Readonly<{
  /** Exact source artifact identifier or semantic fingerprint, supplied by the caller. */
  inputRef: string;
}>;
export type FragmentMappingReport = Readonly<{
  id: string;
  adapter: { id: string; version: string };
  profile: { id: string; version: string };
  direction: "native-to-wer-v1";
  boundary: "serialized-document-export";
  inputRef: string;
  outputRef: null;
  outputMutation: "none";
  authorizedActions: readonly [];
  outcome: "unsupported";
  issues: readonly Readonly<{
    stage: "export";
    proposalIds: readonly string[];
    fields: readonly string[];
    condition: "unsupported";
    action: "refused";
    impact: "none";
    recoverability: "requires-intervention";
    expected: string;
    observed: string;
  }>[];
}>;

/**
 * Final mutation-free export refusal for native fragments, not a general WER mapper.
 * A not-applicable result delegates the current kind to the future #82/#69 mapper;
 * it does not claim that other proposals are portable or preserve portable identity.
 * This boundary accepts serialized documents only and never receives a live editor.
 */
export function exportAtomicFragmentToWERv1(
  input: ReviewDocumentV3,
  context: FragmentExportContext,
):
  | { status: "unsupported"; mappingReport: FragmentMappingReport }
  | { status: "not-applicable" }
  | { status: "failed"; message: string } {
  if (
    !context ||
    typeof context.inputRef !== "string" ||
    !context.inputRef.trim()
  )
    return {
      status: "failed",
      message: "An exact input artifact reference is required.",
    };
  const validated = validateReviewDocument(input);
  if (validated.status !== "valid")
    return {
      status: "failed",
      message: "Expected a supported valid native review document.",
    };
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (
      record.type === "review-fragment" &&
      typeof record.proposalId === "string"
    )
      ids.add(record.proposalId);
    Object.values(record).forEach(visit);
  };
  visit(validated.value.root);
  if (!ids.size) return { status: "not-applicable" };
  return {
    status: "unsupported",
    mappingReport: {
      id: `fragment-refusal:${context.inputRef}`,
      adapter: { id: "lexical-review-wer", version: "0.0.0" },
      profile: { id: "lexical-review-atomic-fragment-refusal", version: "1" },
      direction: "native-to-wer-v1",
      boundary: "serialized-document-export",
      inputRef: context.inputRef,
      outputRef: null,
      outputMutation: "none",
      authorizedActions: [],
      outcome: "unsupported",
      issues: [
        {
          stage: "export",
          proposalIds: [...ids],
          fields: ["proposal.kind", "proposal.payload", "resolution.atomicity"],
          condition: "unsupported",
          action: "refused",
          impact: "none",
          recoverability: "requires-intervention",
          expected:
            "One independently reviewable proposal preserves the complete current fragment and its atomic resolution.",
          observed:
            "WER v1 has no equivalent atomic document-fragment kind. No output was produced and no split/insert decomposition was attempted.",
        },
      ],
    },
  };
}
