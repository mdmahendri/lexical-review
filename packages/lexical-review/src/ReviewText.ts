/**
 * Plain text intent: insertion, deletion, and replacement against accepted
 * content and text proposals. One kind owner among four; the dispatch in
 * ReviewIntentDispatch decides when a classified target reaches this module.
 */
import { $getReviewInputFormat } from "./ReviewInputFormatting";
import { $createTextNode, $getEditor, $isTextNode } from "lexical";
import {
  prepareProposalId,
  type ReviewAuthoringOptions,
} from "./ReviewAuthoring";
export type {
  ReviewAuthoringOptions,
  ReviewProposalIdFactory,
} from "./ReviewAuthoring";
import {
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $isReviewDeletionNode,
  $isReviewInsertionNode,
  getChildIndex,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./ReviewNodes";
import {
  changed,
  unchanged,
  refusal,
  type ReviewIntentOutcome,
} from "./ReviewIntent";
export type {
  ReviewIntentRefusalCode,
  ReviewIntentRefusal,
  ReviewIntentError,
  ReviewIntentOutcome,
} from "./ReviewIntent";
import {
  acceptedDeletionTarget,
  findAcceptedDeletionContinuation,
  inspectProposalKind,
  insertProposalText,
  isolateAcceptedTextRange,
  placeProposalCaret,
  prepareProposalCaretDeletion,
  prepareProposalRangeDeletion,
  replaceProposalRange,
  spliceProposalRange,
  type AcceptedCaretTarget,
  type AcceptedRangeTarget,
  type ProposalCaretTarget,
  type ProposalRangeTarget,
  type ReviewTarget,
} from "./ReviewTargeting";

import { resolveProposal, resolveReplacement } from "./ReviewResolution";

function missingProposalNode(
  kind: "deletion" | "insertion",
): ReviewIntentOutcome | null {
  const nodeClass =
    kind === "insertion" ? ReviewInsertionNode : ReviewDeletionNode;
  return $getEditor().hasNode(nodeClass)
    ? null
    : refusal(
        "invalid-structural-target",
        `The editor must register the review-${kind} node before authoring ${kind} proposals.`,
      );
}

function insertInsertionProposalAtAcceptedPoint(
  target: AcceptedCaretTarget,
  proposalId: string,
  text: string,
): void {
  const wrapper = $createReviewInsertionNode(proposalId);
  const textNode = $createTextNode(text);
  textNode.setFormat($getReviewInputFormat(target.selection));
  wrapper.append(textNode);
  if (target.node === null) {
    target.paragraph.splice(target.childIndex, 0, [wrapper]);
  } else if (target.offset === 0) {
    target.node.insertBefore(wrapper);
  } else if (target.offset === target.node.getTextContentSize()) {
    target.node.insertAfter(wrapper);
  } else {
    const parts = target.node.splitText(target.offset);
    const right = parts[1];
    if (right === undefined) {
      throw new Error("The accepted text point could not be split.");
    }
    right.insertBefore(wrapper);
  }
  textNode.selectEnd();
}

function deleteProposalAtCaret(
  target: ProposalCaretTarget,
  backward: boolean,
  granularity: "character" | "word",
): ReviewIntentOutcome {
  const prepared = prepareProposalCaretDeletion(target, backward, granularity);
  if (prepared.status !== "ready") return prepared;
  if (prepared.value.action === "resolve-deletion")
    return resolveProposal(target.proposalId, true, "deletion");
  if (prepared.value.action === "resolve-replacement")
    return resolveReplacement(target.proposalId, false);
  const spliced = spliceProposalRange(
    target,
    prepared.value.start,
    prepared.value.end,
  );
  if (spliced.status !== "ready") return spliced;
  placeProposalCaret(
    target.paragraph,
    target.wrappers,
    prepared.value.start,
    target.childIndex,
  );
  return changed();
}

function deleteProposalSelection(
  target: ProposalRangeTarget,
): ReviewIntentOutcome {
  const prepared = prepareProposalRangeDeletion(target);
  if (prepared.status !== "ready") return prepared;
  if (prepared.value.action === "resolve-deletion")
    return resolveProposal(target.proposalId, true, "deletion");
  if (prepared.value.action === "resolve-replacement")
    return resolveReplacement(target.proposalId, false);
  if (prepared.value.action === "unchanged") {
    return unchanged();
  }
  const fallbackIndex = getChildIndex(target.paragraph, target.wrappers[0]!);
  const spliced = spliceProposalRange(target, target.start, target.end);
  if (spliced.status !== "ready") return spliced;
  placeProposalCaret(
    target.paragraph,
    target.wrappers,
    target.start,
    fallbackIndex ?? 0,
  );
  return changed();
}

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
  if (target.kind === "proposal-range") {
    if (!$isReviewInsertionNode(target.wrappers[0])) {
      return refusal(
        "unsupported-proposal-edit",
        "Insertion replacement may edit pending insertion content, not deletion content.",
      );
    }
    return replaceProposalRange(target, text);
  }
  if (target.kind === "accepted-range") {
    if (target.start === target.end) return unchanged();
    const missing =
      missingProposalNode("insertion") ?? missingProposalNode("deletion");
    if (missing) return missing;
    const identity = prepareProposalId(options);
    if (identity.status !== "ready") return identity;
    const selected = isolateAcceptedTextRange(target);
    if (!selected?.length)
      throw new Error("Validated replacement target could not be isolated.");
    if (
      selected.map((node) => node.getTextContent()).join("") === text &&
      selected.every((node) => node.getFormat() === target.selection.format)
    ) {
      return unchanged();
    }
    const oldSide = $createReviewDeletionNode(identity.value);
    const newSide = $createReviewInsertionNode(identity.value);
    const content = $createTextNode(text).setFormat(target.selection.format);
    selected[0]!.insertBefore(oldSide);
    oldSide.append(...selected);
    oldSide.insertAfter(newSide);
    newSide.append(content);
    content.selectEnd();
    return changed();
  }
  if (target.kind === "proposal-caret") {
    if (!$isReviewInsertionNode(target.wrapper)) {
      return refusal(
        "unsupported-proposal-edit",
        "Insertion typing may edit pending insertion content, not deletion content.",
      );
    }
    const inserted = insertProposalText(
      target,
      $getReviewInputFormat(target.selection),
      text,
    );
    if (inserted.status !== "ready") return inserted;
    return changed();
  }
  // A text point in accepted content identifies its side unambiguously.
  // Continue an adjacent insertion only when the boundary formatting agrees.
  if (target.node !== null) {
    const atStart = target.offset === 0;
    const atEnd = target.offset === target.node.getTextContentSize();
    const adjacent = atStart
      ? target.node.getPreviousSibling()
      : atEnd
        ? target.node.getNextSibling()
        : null;
    if ($isReviewInsertionNode(adjacent)) {
      const kind = inspectProposalKind(adjacent.getProposalId());
      if (kind.status !== "ready") return kind;
      const boundary = atStart
        ? adjacent.getLastChild()
        : adjacent.getFirstChild();
      if (
        $isTextNode(boundary) &&
        boundary.getFormat() === $getReviewInputFormat(target.selection)
      ) {
        const offset = atStart ? boundary.getTextContentSize() : 0;
        boundary.spliceText(offset, 0, text, true);
        boundary.select(offset + text.length, offset + text.length);
        return changed();
      }
    }
  }
  const missingNode = missingProposalNode("insertion");
  if (missingNode !== null) {
    return missingNode;
  }
  const proposalId = prepareProposalId(options);
  if (proposalId.status !== "ready") {
    return proposalId;
  }
  insertInsertionProposalAtAcceptedPoint(target, proposalId.value, text);
  return changed();
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
  if (target.kind === "proposal-range") {
    return deleteProposalSelection(target);
  }
  if (target.kind === "accepted-range") {
    if (target.start === target.end) {
      return unchanged();
    }
    return deleteAcceptedSpan(target, backward, options);
  }
  if (target.kind === "proposal-caret") {
    return deleteProposalAtCaret(
      target,
      backward,
      options.granularity ?? "character",
    );
  }
  if (
    target.node !== null &&
    (backward
      ? target.offset === 0
      : target.offset === target.node.getTextContentSize())
  ) {
    const adjacent = backward
      ? target.node.getPreviousSibling()
      : target.node.getNextSibling();
    if ($isReviewDeletionNode(adjacent)) {
      const kind = inspectProposalKind(adjacent.getProposalId());
      if (kind.status !== "ready") return kind;
      if (kind.value === "replacement")
        return resolveReplacement(adjacent.getProposalId(), false);
    }
  }
  const range = acceptedDeletionTarget(
    target,
    backward,
    options.granularity ?? "character",
  );
  if (range === null || range.start === range.end) {
    return refusal(
      "deletion-target-unavailable",
      "Deletion may not cross proposal content or an empty accepted boundary.",
    );
  }
  return deleteAcceptedSpan(range, backward, options);
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

function deleteAcceptedSpan(
  target: AcceptedRangeTarget,
  backward: boolean,
  options: ReviewDeletionOptions,
): ReviewIntentOutcome {
  const missing = missingProposalNode("deletion");
  if (missing !== null) return missing;
  const continuation = findAcceptedDeletionContinuation(target, backward);
  if (continuation.status !== "ready") return continuation;
  const continued = continuation.value.node;
  const continuedId = continuation.value.proposalId;
  const identity =
    continued === null || continuedId === null
      ? prepareProposalId(options)
      : { status: "ready" as const, value: continuedId };
  if (identity.status !== "ready") return identity;
  const selected = isolateAcceptedTextRange(target);
  if (selected === null || selected.length === 0)
    throw new Error("Validated deletion target could not be isolated.");
  const wrapper = continued ?? $createReviewDeletionNode(identity.value);
  if (continued === null) selected[0]!.insertBefore(wrapper);
  if (backward) wrapper.splice(0, 0, selected);
  else wrapper.append(...selected);
  const neighbor = backward
    ? wrapper.getPreviousSibling()
    : wrapper.getNextSibling();
  if ($isTextNode(neighbor)) {
    if (backward) neighbor.selectEnd();
    else neighbor.selectStart();
  } else {
    const index = wrapper.getIndexWithinParent() + (backward ? 0 : 1);
    target.paragraph.select(index, index);
  }
  return changed();
}

export type ReviewReplacementProposal = Readonly<{
  proposalId: string;
  oldText: string;
  newText: string;
}>;
