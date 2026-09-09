import { $getSelection, $isRangeSelection } from "lexical";
import {
  $claimFragmentDeletion,
  $claimFragmentInsertion,
  $claimFragmentSplit,
  $moveReviewFragmentCaret,
} from "./ReviewFragment";
import {
  $claimBoundaryDeletion,
  $claimParagraphSplit,
  $moveReviewBoundaryCaret,
} from "./ReviewStructure";
import {
  $claimTextDeletion,
  $claimTextInsertion,
  type ReviewDeletionOptions,
} from "./ReviewText";
import type { ReviewAuthoringOptions } from "./ReviewAuthoring";
import { refusal, unchanged, type ReviewIntentOutcome } from "./ReviewIntent";
import { inspectReviewTarget } from "./ReviewTargeting";

/**
 * Intent dispatch: classify once, then run kind claims in explicit
 * precedence order. Each claim returns null when the selection is not its
 * owner's; the first non-null outcome wins.
 *
 * Precedence (pinned by ReviewIntentDispatch.spec):
 * - deletion: fragment claim, structural claim (character granularity,
 *   collapsed carets), then plain text intent on the classified target.
 * - insertion: fragment claim, then plain text intent on the classified
 *   target. Input validation stays between the two so fragment typing keeps
 *   its current behavior for empty and multiline input.
 * - split: fragment claim, then the structural remainder.
 * - caret moves: fragment claim, then structural claim.
 *
 * Single-owner entries ($set/$toggleReviewFormatting in ReviewFormatting,
 * $mergeReviewParagraph in ReviewStructure) live with their owner and order
 * their one fragment hook explicitly instead of routing through here.
 */
export function $deleteReviewText(
  backward: boolean,
  options: ReviewDeletionOptions = {},
): ReviewIntentOutcome {
  const granularity = options.granularity ?? "character";
  const fragment = $claimFragmentDeletion(backward, granularity);
  if (fragment) return fragment;
  if (granularity === "character") {
    const structural = $claimBoundaryDeletion(backward, options);
    if (structural) return structural;
  }
  const inspection = inspectReviewTarget();
  if (inspection.status !== "ready") {
    return inspection;
  }
  return $claimTextDeletion(inspection.value, backward, options);
}

/** Insert or correct pending insertion content in the current Lexical update. */
export function $insertReviewText(
  text: string,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  const fragment = $claimFragmentInsertion(text);
  if (fragment) return fragment;
  if (text.length === 0) {
    return unchanged();
  }
  if (/\r|\n/u.test(text)) {
    return refusal(
      "unsupported-input",
      "Text insertion supports inline text only; paragraph breaks are unsupported.",
    );
  }
  const inspection = inspectReviewTarget();
  if (inspection.status !== "ready") {
    return inspection;
  }
  return $claimTextInsertion(inspection.value, text, options);
}

/** Replace a supported selection; an empty new side expresses deletion. */
export function $replaceReviewText(
  text: string,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  if (text.length !== 0) return $insertReviewText(text, options);
  const selection = $getSelection();
  if ($isRangeSelection(selection) && selection.isCollapsed())
    return unchanged();
  return $deleteReviewText(false, options);
}

export function $splitReviewParagraph(
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  const fragment = $claimFragmentSplit();
  if (fragment) return fragment;
  return $claimParagraphSplit(options);
}

/** Move the caret across fragment edges and structural markers. */
export function $moveReviewCaret(backward: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  if ($moveReviewFragmentCaret(backward)) return true;
  return $moveReviewBoundaryCaret(backward);
}
