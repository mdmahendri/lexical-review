/**
 * Plain text intent: insertion, deletion, and replacement against accepted
 * content and text proposals. One kind owner among four; the dispatch in
 * ReviewIntentDispatch decides when a classified target reaches this module.
 *
 * This module owns intent semantics (granularity defaults, claim routing,
 * resolution execution). All target mechanics (maps, offsets, mutation,
 * caret restore) live behind the $commitTargetEdit seam in
 * ReviewTargetEdit: after classification this module coordinates nothing.
 */
import { $getReviewInputFormat } from "./ReviewInputFormatting";
import type { ReviewAuthoringOptions } from "./ReviewAuthoring";
export type {
  ReviewAuthoringOptions,
  ReviewProposalIdFactory,
} from "./ReviewAuthoring";
import { changed, unchanged, type ReviewIntentOutcome } from "./ReviewIntent";
export type {
  ReviewIntentRefusalCode,
  ReviewIntentRefusal,
  ReviewIntentError,
  ReviewIntentOutcome,
} from "./ReviewIntent";
import {
  $classifyReviewDeletion,
  $commitTargetEdit,
  buildTextInsertionPlan,
  selectedWrapperSide,
} from "./ReviewTargetEdit";
import type { ReviewTarget } from "./ReviewTargeting";

import { resolveProposal, resolveReplacement } from "./ReviewResolution";

/**
 * Insert into the classified target as plain text intent. The dispatch
 * validates the input and only calls this module after the fragment claim
 * declines.
 */
export function $claimTextInsertion(
  target: ReviewTarget,
  text: string,
  options: ReviewAuthoringOptions,
): ReviewIntentOutcome {
  const plan = buildTextInsertionPlan(
    target.kind,
    selectedWrapperSide(target),
    text,
    $getReviewInputFormat(target.selection),
    options,
  );
  if (plan.status !== "ready") return plan;
  const result = $commitTargetEdit(target, plan.value);
  if (result.status !== "ready") return result;
  return result.value.kind === "mutated" ? changed() : unchanged();
}

/**
 * Delete the classified target as plain text intent. The dispatch only calls
 * this module after fragment and structural claims decline.
 */
export function $claimTextDeletion(
  target: ReviewTarget,
  backward: boolean,
  options: ReviewDeletionOptions,
): ReviewIntentOutcome {
  const plan = $classifyReviewDeletion(
    target,
    backward,
    options.granularity ?? "character",
    options,
  );
  if (plan.status !== "ready") return plan;
  const result = $commitTargetEdit(target, plan.value);
  if (result.status !== "ready") return result;
  if (result.value.kind === "mutated") return changed();
  if (result.value.kind === "no-op") return unchanged();
  return result.value.action === "accept-deletion"
    ? resolveProposal(result.value.proposalId, true, "deletion")
    : resolveReplacement(result.value.proposalId, false);
}

export type ReviewInsertionProposal = Readonly<{
  proposalId: string;
  text: string;
}>;

export type ReviewDeletionOptions = ReviewAuthoringOptions &
  Readonly<{
    granularity?: "character" | "word";
  }>;
export type ReviewDeletionProposal = ReviewInsertionProposal;

export type ReviewReplacementProposal = Readonly<{
  proposalId: string;
  oldText: string;
  newText: string;
}>;
