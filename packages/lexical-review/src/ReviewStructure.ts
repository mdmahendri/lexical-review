import {
  $isReviewFragmentNode,
  isReviewElementNode,
  isRootParagraph,
} from "./ReviewNodes";
import {
  $createParagraphNode,
  $getEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalNode,
  type ParagraphNode,
  type ElementNode,
} from "lexical";
import {
  $createReviewBoundaryNode,
  $isReviewBoundaryNode,
  ReviewBoundaryNode,
  type ReviewBoundaryKind,
} from "./ReviewBoundaryNode";
import {
  prepareProposalId,
  type ReviewAuthoringOptions,
} from "./ReviewAuthoring";
import {
  changed,
  refusal,
  type Preparation,
  type ReviewIntentOutcome,
} from "./ReviewIntent";
import {
  inspectProposalKind,
  inspectStructuralPosition,
  validateParagraphStructure,
} from "./ReviewTargeting";
import {
  $getReviewInputFormat,
  $setReviewInputFormat,
} from "./ReviewInputFormatting";

export type ReviewStructuralProposal = Readonly<{
  proposalId: string;
  kind: ReviewBoundaryKind;
}>;

export function validateStructuralState(): ReviewIntentOutcome | null {
  if ($getEditor().isComposing())
    return refusal(
      "unsupported-input",
      "Structural authoring and resolution are refused during composition.",
    );
  for (const paragraph of $getRoot().getChildren()) {
    if (!isRootParagraph(paragraph))
      return refusal(
        "invalid-structural-target",
        "Structural editing supports root paragraphs only.",
      );
    if (
      paragraph.getFormatType() !== "" ||
      paragraph.getIndent() !== 0 ||
      paragraph.getDirection() !== null ||
      paragraph.getStyle() !== "" ||
      paragraph.getTextStyle() !== "" ||
      (paragraph.getTextFormat() & ~15) !== 0
    )
      return refusal(
        "unsupported-structure",
        "Structural editing supports unstyled paragraphs and the four supported inline formats.",
      );
    const invalid = validateParagraphStructure(paragraph);
    if (invalid) return invalid;
    for (const node of paragraph.getChildren()) {
      if ($isReviewBoundaryNode(node)) {
        const boundary = inspectBoundary(node.getProposalId());
        if (boundary.status !== "ready") return boundary;
      } else if (isReviewElementNode(node)) {
        const kind = inspectProposalKind(node.getProposalId());
        if (kind.status !== "ready") return kind;
      }
    }
  }
  return null;
}

/** Validate before any mutation, including identity sharing with text proposals. */
export function inspectBoundary(
  proposalId: string,
): Preparation<ReviewBoundaryNode> {
  const occurrences: LexicalNode[] = [];
  for (const paragraph of $getRoot().getChildren()) {
    if (!isRootParagraph(paragraph)) continue;
    for (const child of paragraph.getChildren())
      if (
        (isReviewElementNode(child) || $isReviewBoundaryNode(child)) &&
        child.getProposalId() === proposalId
      )
        occurrences.push(child);
  }
  const node = occurrences[0];
  if (occurrences.length !== 1 || !$isReviewBoundaryNode(node))
    return refusal(
      "unsupported-target",
      "Expected one attached structural proposal with a unique identity.",
    );
  const paragraph = node.getParent();
  if (!isRootParagraph(paragraph))
    return refusal("invalid-structural-target", "Expected a root paragraph.");
  const invalid = validateParagraphStructure(paragraph);
  if (invalid) return invalid;
  const boundaries = paragraph.getChildren().filter($isReviewBoundaryNode);
  if (boundaries.length !== 1)
    return refusal(
      "unsafe-proposal-intersection",
      "A paragraph may contain only one pending boundary.",
    );
  if (node.getKind() === "split") {
    const left = paragraph.getPreviousSibling();
    if (
      node.getIndexWithinParent() !== 0 ||
      !isRootParagraph(left) ||
      hasMerge(left)
    )
      return refusal(
        "invalid-structural-target",
        "A split must start a right paragraph with an attached left paragraph.",
      );
    const leftInvalid = validateParagraphStructure(left);
    if (leftInvalid) return leftInvalid;
  } else if (hasSplit(paragraph.getNextSibling())) {
    return refusal(
      "unsafe-proposal-intersection",
      "Pending merges cannot share a split boundary.",
    );
  }
  return { status: "ready", value: node };
}

function hasMerge(node: LexicalNode | null): boolean {
  return (
    isRootParagraph(node) &&
    node
      .getChildren()
      .some(
        (child) => $isReviewBoundaryNode(child) && child.getKind() === "merge",
      )
  );
}
function hasSplit(node: LexicalNode | null): boolean {
  return (
    isRootParagraph(node) &&
    $isReviewBoundaryNode(node.getFirstChild()) &&
    node.getFirstChild<ReviewBoundaryNode>()!.getKind() === "split"
  );
}

function sideFormat(paragraph: ParagraphNode, side: "left" | "right"): number {
  const nodes = paragraph.getAllTextNodes();
  return (
    (side === "left" ? nodes.at(-1) : nodes[0])?.getFormat() ??
    paragraph.getTextFormat()
  );
}
function selectBoundary(
  paragraph: ParagraphNode,
  index: number,
  format: number,
): void {
  const selection = paragraph.select(index, index);
  $setReviewInputFormat(selection, format);
}

/** Claim a structural split for non-fragment selections; the dispatch runs the fragment claim first. */
export function $claimParagraphSplit(
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  const blocked = validateStructuralState();
  if (blocked) return blocked;
  const prepared = inspectStructuralPosition();
  if (prepared.status !== "ready") return prepared;
  const { paragraph, text, offset } = prepared.value;
  let { index } = prepared.value;
  const neighbors = [
    paragraph.getChildAtIndex(index - 1),
    paragraph.getChildAtIndex(index),
  ];
  const merge =
    !text &&
    neighbors.find(
      (node) => $isReviewBoundaryNode(node) && node.getKind() === "merge",
    );
  if (merge && $isReviewBoundaryNode(merge))
    return resolveStructure(merge.getProposalId(), false);
  if (hasMerge(paragraph))
    return refusal(
      "unsafe-proposal-intersection",
      "Splitting a paragraph with a pending merge is unsupported.",
    );
  if (!$getEditor().hasNode(ReviewBoundaryNode))
    return refusal(
      "invalid-structural-target",
      "Register ReviewBoundaryNode before authoring structure.",
    );
  // A caret before the split marker is the same right-paragraph start as after it.
  if (index === 0 && hasSplit(paragraph)) index = 1;
  const identity = prepareProposalId(options);
  if (identity.status !== "ready") return identity;
  const selection = $getSelection();
  const format = $isRangeSelection(selection)
    ? $getReviewInputFormat(selection)
    : paragraph.getTextFormat();
  if (text) {
    text.splitText(offset);
    index = text.getIndexWithinParent() + 1;
  }
  const right = $createParagraphNode().setTextFormat(format);
  const boundary = $createReviewBoundaryNode(
    identity.value,
    "split",
    format,
    format,
  );
  const moved = paragraph.getChildren().slice(index);
  paragraph.insertAfter(right);
  right.append(boundary, ...moved);
  selectBoundary(right, 1, format);
  return changed();
}

/** Merge at a paragraph start (backward) or end (forward); inverse split deletion cancels. */
export function $mergeReviewParagraph(
  backward: boolean,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  const blocked = validateStructuralState();
  if (blocked) return blocked;
  const prepared = inspectStructuralPosition();
  if (prepared.status !== "ready") return prepared;
  const { paragraph, index, text } = prepared.value;
  const start = index === 0 || (index === 1 && hasSplit(paragraph));
  if (text || (backward ? !start : index !== paragraph.getChildrenSize()))
    return refusal(
      "unsupported-target",
      "Merge requires a caret at a paragraph boundary.",
    );
  const left = backward ? paragraph.getPreviousSibling() : paragraph;
  const right = backward ? paragraph : paragraph.getNextSibling();
  if (!isRootParagraph(left) || !isRootParagraph(right))
    return refusal(
      "unsupported-target",
      "There is no adjacent paragraph to merge.",
    );
  if (hasSplit(right))
    return resolveStructure(
      right.getFirstChild<ReviewBoundaryNode>()!.getProposalId(),
      false,
    );
  if ([left, right].some((p) => p.getChildren().some($isReviewFragmentNode)))
    return refusal(
      "unsafe-proposal-intersection",
      "A merge cannot cross fragment ownership.",
    );
  const invalid =
    validateParagraphStructure(left) ?? validateParagraphStructure(right);
  if (invalid) return invalid;
  if (
    hasMerge(left) ||
    hasMerge(right) ||
    hasSplit(left) ||
    hasSplit(right.getNextSibling())
  )
    return refusal(
      "unsafe-proposal-intersection",
      "Chained merges and split/merge combinations are unsupported.",
    );
  if (!$getEditor().hasNode(ReviewBoundaryNode))
    return refusal(
      "invalid-structural-target",
      "Register ReviewBoundaryNode before authoring structure.",
    );
  const identity = prepareProposalId(options);
  if (identity.status !== "ready") return identity;
  const marker = $createReviewBoundaryNode(
    identity.value,
    "merge",
    sideFormat(left, "left"),
    sideFormat(right, "right"),
  );
  left.append(marker, ...right.getChildren());
  right.remove();
  selectBoundary(
    left,
    marker.getIndexWithinParent() + (backward ? 1 : 0),
    marker.getSideFormat(backward ? "right" : "left"),
  );
  return changed();
}

/** Claim boundary deletion for collapsed carets; null means text owns it. */
export function $claimBoundaryDeletion(
  backward: boolean,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const prepared = inspectStructuralPosition();
  if (prepared.status !== "ready") return null;
  const { paragraph, index, text } = prepared.value;
  if (text) return null;
  const neighbor = paragraph.getChildAtIndex(index + (backward ? -1 : 0));
  if ($isReviewBoundaryNode(neighbor) && neighbor.getKind() === "merge")
    return refusal(
      "unsupported-target",
      "Use Enter at the merge marker to cancel the pending merge.",
    );
  if (
    (backward && (index === 0 || (index === 1 && hasSplit(paragraph)))) ||
    (!backward && index === paragraph.getChildrenSize())
  )
    return $mergeReviewParagraph(backward, options);
  return null;
}

// Text points survive moving their nodes. Remap element points in affected parents explicitly.
function retainSelection(
  remap: (
    key: string,
    offset: number,
  ) => { paragraph: ElementNode; offset: number } | null,
): () => void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return () => {};
  const saved = [selection.anchor, selection.focus].map((point) => ({
    point,
    key: point.key,
    offset: point.offset,
    type: point.type,
  }));
  return () => {
    for (const savedPoint of saved) {
      const { point, key, offset, type } = savedPoint;
      const mapped = type === "element" ? remap(key, offset) : null;
      if (mapped)
        point.set(mapped.paragraph.getKey(), mapped.offset, "element");
      else point.set(key, offset, type);
    }
  };
}

export function resolveStructure(
  proposalId: string,
  accept: boolean,
): ReviewIntentOutcome {
  const blocked = validateStructuralState();
  if (blocked) return blocked;
  const found = inspectBoundary(proposalId);
  if (found.status !== "ready") return found;
  const marker = found.value;
  const parent = marker.getParentOrThrow<ParagraphNode>();
  const index = marker.getIndexWithinParent();
  if (accept) {
    const restore = retainSelection((key, offset) =>
      key === parent.getKey()
        ? { paragraph: parent, offset: offset > index ? offset - 1 : offset }
        : null,
    );
    marker.remove();
    restore();
  } else if (marker.getKind() === "split") {
    const left = parent.getPreviousSibling<ParagraphNode>()!;
    const count = left.getChildrenSize();
    const removedIndex = parent.getIndexWithinParent();
    const restore = retainSelection((key, offset) =>
      key === parent.getKey()
        ? { paragraph: left, offset: count + Math.max(0, offset - 1) }
        : key === $getRoot().getKey() && offset === removedIndex
          ? { paragraph: left, offset: count }
          : key === $getRoot().getKey() && offset > removedIndex
            ? { paragraph: $getRoot(), offset: offset - 1 }
            : null,
    );
    left.append(...parent.getChildren().slice(1));
    parent.remove();
    restore();
  } else {
    const right = $createParagraphNode().setTextFormat(
      marker.getSideFormat("right"),
    );
    const parentIndex = parent.getIndexWithinParent();
    const restore = retainSelection((key, offset) =>
      key === parent.getKey()
        ? offset > index
          ? { paragraph: right, offset: offset - index - 1 }
          : { paragraph: parent, offset }
        : key === $getRoot().getKey() && offset > parentIndex
          ? { paragraph: $getRoot(), offset: offset + 1 }
          : null,
    );
    parent.insertAfter(right);
    right.append(...parent.getChildren().slice(index + 1));
    marker.remove();
    if (parent.getChildrenSize() === 0)
      parent.setTextFormat(marker.getSideFormat("left"));
    restore();
  }
  return changed();
}
export function inspectStructureProposal(
  proposalId: string,
): ReviewIntentOutcome<ReviewStructuralProposal> {
  const found = inspectBoundary(proposalId);
  if (found.status !== "ready") return found;
  return {
    status: "unchanged",
    value: { proposalId, kind: found.value.getKind() },
  };
}
/** Client arrow routing crosses the seam explicitly, including when both sides are empty. */
export function $moveReviewBoundaryCaret(backward: boolean): boolean {
  const prepared = inspectStructuralPosition();
  if (prepared.status !== "ready" || prepared.value.text) return false;
  const { paragraph, index } = prepared.value;
  const marker = paragraph.getChildAtIndex(index + (backward ? -1 : 0));
  if (!$isReviewBoundaryNode(marker) || marker.getKind() !== "merge")
    return false;
  const selection = paragraph.select(
    index + (backward ? -1 : 1),
    index + (backward ? -1 : 1),
  );
  $setReviewInputFormat(selection, $getReviewInputFormat(selection));
  return true;
}
