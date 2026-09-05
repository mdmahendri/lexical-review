import {
  $editReviewFragmentText,
  $deleteReviewFragment,
  inspectFragment,
  $acceptReviewFragment,
  $rejectReviewFragment,
} from "./ReviewFragment";
import {
  $deleteReviewBoundary,
  inspectBoundary,
  validateStructuralState,
  $acceptReviewStructure,
  $rejectReviewStructure,
} from "./ReviewStructure";
import { $getReviewInputFormat } from "./ReviewInputFormatting";
import {
  $createTextNode,
  $getEditor,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  type TextNode,
} from "lexical";
import {
  prepareProposalId,
  type ReviewAuthoringOptions,
} from "./ReviewAuthoring";
export type {
  ReviewAuthoringOptions,
  ReviewProposalIdFactory,
} from "./ReviewAuthoring";
import {
  $acceptReviewFormatting,
  $rejectReviewFormatting,
} from "./ReviewFormatting";
import {
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $isReviewDeletionNode,
  $isReviewFormattingNode,
  $isReviewInsertionNode,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./ReviewNodes";
import {
  changed,
  unchanged,
  refusal,
  type Preparation,
  type ReviewIntentOutcome,
} from "./ReviewIntent";
export type {
  ReviewIntentRefusalCode,
  ReviewIntentRefusal,
  ReviewIntentError,
  ReviewIntentOutcome,
} from "./ReviewIntent";
import {
  inspectProposalGroup,
  isRootParagraph,
  getChildIndex,
  getTextChildren,
  isTextBoundary,
  previousCharacterOffset,
  nextCharacterOffset,
  inspectSelection,
  buildProposalMap,
  buildProposalMapAroundPoint,
  getProposalOffset,
  buildProposalSpan,
  buildAcceptedMap,
  getAcceptedOffset,
  buildAcceptedSpan,
  getStartEntry,
  getEndEntry,
  type AcceptedPoint,
  type ProposalPoint,
  type ProposalMap,
  type ProposalSpan,
  type AcceptedSpan,
} from "./ReviewSelectionPreparation";

function isolateAcceptedTextRange(span: AcceptedSpan): TextNode[] | null {
  if (span.start >= span.end) {
    return null;
  }
  const startEntry = getStartEntry(span.map.entries, span.start);
  const endEntry = getEndEntry(span.map.entries, span.end);
  if (startEntry === null || endEntry === null) {
    return null;
  }
  const startOffset = span.start - startEntry.start;
  const endOffset = span.end - endEntry.start;
  if (startEntry.node.getKey() === endEntry.node.getKey()) {
    const parts = startEntry.node.splitText(startOffset, endOffset);
    const selected = startOffset === 0 ? parts[0] : parts[1];
    return selected === undefined ? null : [selected];
  }

  let first = startEntry.node;
  if (startOffset > 0) {
    const parts = first.splitText(startOffset);
    first = parts[1] ?? first;
  }
  let last = endEntry.node;
  if (endOffset < last.getTextContentSize()) {
    const parts = last.splitText(endOffset);
    last = parts[0] ?? last;
  }
  const firstIndex = getChildIndex(span.map.paragraph, first);
  const lastIndex = getChildIndex(span.map.paragraph, last);
  if (firstIndex === null || lastIndex === null || firstIndex > lastIndex) {
    return null;
  }
  const selected = span.map.paragraph
    .getChildren()
    .slice(firstIndex, lastIndex + 1);
  return selected.every($isTextNode) ? selected : null;
}

function placeProposalCaret(
  map: ProposalMap,
  offset: number,
  fallbackIndex: number,
): void {
  let cursor = 0;
  let lastText: TextNode | null = null;
  for (const child of map.wrappers) {
    // Removing wrappers can clone the paragraph; its key remains stable.
    if (child.getParent()?.getKey() !== map.paragraph.getKey()) {
      continue;
    }
    const textChildren = getTextChildren(child);
    if (textChildren === null) {
      continue;
    }
    for (const textNode of textChildren) {
      const length = textNode.getTextContentSize();
      if (offset <= cursor + length) {
        textNode.select(offset - cursor, offset - cursor);
        return;
      }
      cursor += length;
      lastText = textNode;
    }
  }
  if (lastText !== null) {
    lastText.selectEnd();
    return;
  }
  const paragraphOffset = Math.min(
    Math.max(fallbackIndex, 0),
    map.paragraph.getChildrenSize(),
  );
  map.paragraph.select(paragraphOffset, paragraphOffset);
}

function spliceProposalRange(
  span: ProposalSpan,
  replacement: Readonly<{ node: TextNode; text: string }> | null = null,
): void {
  for (let index = span.map.entries.length - 1; index >= 0; index -= 1) {
    const entry = span.map.entries[index];
    if (entry === undefined) {
      continue;
    }
    const localStart = Math.max(span.start, entry.start) - entry.start;
    const localEnd = Math.min(span.end, entry.end) - entry.start;
    if (localStart >= localEnd) {
      continue;
    }
    if (
      replacement !== null &&
      entry.node.getKey() === replacement.node.getKey()
    ) {
      entry.node.spliceText(
        localStart,
        localEnd - localStart,
        replacement.text,
        true,
      );
    } else {
      entry.node.spliceText(localStart, localEnd - localStart, "", false);
      if (entry.node.getTextContentSize() === 0) {
        entry.node.remove();
      }
    }
  }
  for (const wrapper of span.map.wrappers) {
    if (wrapper.getChildrenSize() === 0) {
      wrapper.remove();
    }
  }
}

function replaceProposalRange(
  span: ProposalSpan,
  text: string,
): ReviewIntentOutcome {
  if (span.start === span.end) {
    return unchanged();
  }
  const startEntry = getStartEntry(span.map.entries, span.start);
  const endEntry = getEndEntry(span.map.entries, span.end);
  if (startEntry === null || endEntry === null) {
    return refusal(
      "invalid-structural-target",
      "The proposal replacement range cannot be resolved in the live tree.",
    );
  }
  const fallbackIndex = getChildIndex(
    span.map.paragraph,
    span.map.wrappers[0]!,
  );
  spliceProposalRange(span, { node: startEntry.node, text });
  placeProposalCaret(span.map, span.start + text.length, fallbackIndex ?? 0);
  return changed();
}

function insertIntoProposal(point: ProposalPoint, text: string): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection))
    throw new Error("Expected a range selection.");
  const children = getTextChildren(point.wrapper)!;
  let offset = point.offset;
  let target = point.node;
  if (target === null) {
    for (const child of children) {
      if (offset <= child.getTextContentSize()) {
        target = child;
        break;
      }
      offset -= child.getTextContentSize();
    }
  }
  if (target === null)
    throw new Error("The proposal caret cannot be resolved.");
  const format = $getReviewInputFormat(selection);
  if (target.getFormat() === format) {
    target.spliceText(offset, 0, text, true);
    return;
  }
  const inserted = $createTextNode(text).setFormat(format);
  if (offset === 0) target.insertBefore(inserted);
  else if (offset === target.getTextContentSize()) target.insertAfter(inserted);
  else target.splitText(offset)[1]!.insertBefore(inserted);
  inserted.selectEnd();
}

function missingProposalNode(
  editor: LexicalEditor,
  kind: "deletion" | "insertion",
): ReviewIntentOutcome | null {
  const nodeClass =
    kind === "insertion" ? ReviewInsertionNode : ReviewDeletionNode;
  return editor.hasNode(nodeClass)
    ? null
    : refusal(
        "invalid-structural-target",
        `The editor must register the review-${kind} node before authoring ${kind} proposals.`,
      );
}

function insertInsertionProposalAtAcceptedPoint(
  point: AcceptedPoint,
  selection: RangeSelection,
  proposalId: string,
  text: string,
): void {
  const wrapper = $createReviewInsertionNode(proposalId);
  const textNode = $createTextNode(text);
  textNode.setFormat($getReviewInputFormat(selection));
  wrapper.append(textNode);
  if (point.node !== null) {
    if (point.offset === 0) {
      point.node.insertBefore(wrapper);
    } else if (point.offset === point.node.getTextContentSize()) {
      point.node.insertAfter(wrapper);
    } else {
      const parts = point.node.splitText(point.offset);
      const right = parts[1];
      if (right === undefined) {
        throw new Error("The accepted text point could not be split.");
      }
      right.insertBefore(wrapper);
    }
  } else {
    point.paragraph.splice(point.childIndex, 0, [wrapper]);
  }
  textNode.selectEnd();
}

function acceptedDeletionTarget(
  point: AcceptedPoint,
  backward: boolean,
  granularity: "character" | "word",
): AcceptedSpan | null {
  const map = buildAcceptedMap(point.paragraph);
  const offset = getAcceptedOffset(point, map);
  if (offset === null) {
    return null;
  }
  if (granularity === "word") {
    const children = point.paragraph.getChildren();
    let index = point.childIndex;
    if (point.node === null && backward) index -= 1;
    if (!$isTextNode(children[index])) return null;
    let left = index;
    let right = index;
    while ($isTextNode(children[left - 1])) left -= 1;
    while ($isTextNode(children[right + 1])) right += 1;
    const entries = map.entries.filter(
      (entry) => entry.childIndex >= left && entry.childIndex <= right,
    );
    const base = entries[0]?.start;
    if (base === undefined) return null;
    const text = entries.map((entry) => entry.node.getTextContent()).join("");
    const local = offset - base;
    const boundary = deletionOffset(text, local, backward, granularity);
    return {
      start: base + Math.min(local, boundary),
      end: base + Math.max(local, boundary),
      map: map,
    };
  }
  if (point.node !== null) {
    const text = point.node.getTextContent();
    if (backward && point.offset > 0) {
      return {
        end: offset,
        map: map,
        start:
          offset - (point.offset - previousCharacterOffset(text, point.offset)),
      };
    }
    if (!backward && point.offset < text.length) {
      return {
        end: offset + (nextCharacterOffset(text, point.offset) - point.offset),
        map: map,
        start: offset,
      };
    }
  }
  const adjacentIndex = backward
    ? point.childIndex - 1
    : point.node === null
      ? point.childIndex
      : point.childIndex + 1;
  const adjacent = point.paragraph.getChildAtIndex(adjacentIndex);
  if (!$isTextNode(adjacent) || adjacent.getTextContentSize() === 0) {
    return null;
  }
  const adjacentEntry = map.entries.find(
    (entry) => entry.node.getKey() === adjacent.getKey(),
  );
  if (adjacentEntry === undefined) {
    return null;
  }
  if (backward) {
    const start = previousCharacterOffset(
      adjacent.getTextContent(),
      adjacent.getTextContentSize(),
    );
    return {
      end: adjacentEntry.end,
      map: map,
      start: adjacentEntry.start + start,
    };
  }
  const end = nextCharacterOffset(adjacent.getTextContent(), 0);
  return {
    end: adjacentEntry.start + end,
    map: map,
    start: adjacentEntry.start,
  };
}

function deleteProposalAtCaret(
  point: ProposalPoint,
  backward: boolean,
  granularity: "character" | "word",
): ReviewIntentOutcome {
  if ($isReviewFormattingNode(point.wrapper))
    return refusal(
      "unsupported-proposal-edit",
      "Text deletion cannot alter a pending formatting target.",
    );
  const map = buildProposalMapAroundPoint(point);
  if (map.status !== "ready") {
    return map;
  }
  const offset = getProposalOffset(point, map.value);
  if (offset === null) {
    return refusal(
      "invalid-structural-target",
      "The proposal caret cannot be resolved in the live tree.",
    );
  }
  const text = map.value.entries
    .map((entry) => entry.node.getTextContent())
    .join("");
  if (!isTextBoundary(text, offset)) {
    return refusal(
      "invalid-structural-target",
      "The proposal caret is not on a supported Unicode text boundary.",
    );
  }
  if (backward && offset === 0) {
    return refusal(
      "deletion-target-unavailable",
      "Backward deletion may not cross from proposal content into accepted content.",
    );
  }
  if (!backward && offset === map.value.total) {
    return refusal(
      "deletion-target-unavailable",
      "Forward deletion may not cross from proposal content into accepted content.",
    );
  }
  if ($isReviewDeletionNode(point.wrapper))
    return $removeReviewDeletion(point.wrapper.getProposalId());
  const boundary = deletionOffset(text, offset, backward, granularity);
  const start = Math.min(offset, boundary);
  const end = Math.max(offset, boundary);
  const span: ProposalSpan = { end, map: map.value, start };
  if (end - start === map.value.total && isReplacement(map.value.proposalId))
    return $removeReviewReplacement(map.value.proposalId);
  const fallbackIndex = point.childIndex;
  spliceProposalRange(span);
  placeProposalCaret(map.value, start, fallbackIndex);
  return changed();
}

function deleteProposalSelection(span: ProposalSpan): ReviewIntentOutcome {
  if ($isReviewFormattingNode(span.map.wrappers[0]))
    return refusal(
      "unsupported-proposal-edit",
      "Text deletion cannot alter a pending formatting target.",
    );
  if (span.start === span.end) {
    return unchanged();
  }
  if ($isReviewDeletionNode(span.map.wrappers[0]))
    return $removeReviewDeletion(span.map.proposalId);
  const group = inspectProposalGroup(span.map.proposalId);
  if (group.status !== "ready") return group;
  const insertionTotal = group.value.wrappers
    .filter($isReviewInsertionNode)
    .reduce((sum, node) => sum + node.getTextContentSize(), 0);
  if (
    group.value.kind === "replacement" &&
    span.end - span.start === insertionTotal
  )
    return $removeReviewReplacement(span.map.proposalId);
  const fallbackIndex = getChildIndex(
    span.map.paragraph,
    span.map.wrappers[0]!,
  );
  spliceProposalRange(span);
  placeProposalCaret(span.map, span.start, fallbackIndex ?? 0);
  return changed();
}

function performInsertion(
  editor: LexicalEditor,
  text: string,
  options: ReviewAuthoringOptions,
): ReviewIntentOutcome {
  if (text.length === 0) {
    return unchanged();
  }
  if (/\r|\n/u.test(text)) {
    return refusal(
      "unsupported-input",
      "Text insertion supports inline text only; paragraph breaks are unsupported.",
    );
  }
  const inspection = inspectSelection();
  if (inspection.status !== "ready") {
    return inspection;
  }
  if (!inspection.value.collapsed) {
    if (
      inspection.value.anchor.association === "proposal" ||
      inspection.value.focus.association === "proposal"
    ) {
      const proposalSpan = buildProposalSpan(inspection.value);
      if (proposalSpan.status !== "ready") {
        return proposalSpan;
      }
      if (!$isReviewInsertionNode(proposalSpan.value.map.wrappers[0])) {
        return refusal(
          "unsupported-proposal-edit",
          "Insertion replacement may edit pending insertion content, not deletion content.",
        );
      }
      return replaceProposalRange(proposalSpan.value, text);
    }
    const span = buildAcceptedSpan(inspection.value);
    if (span.status !== "ready") return span;
    if (span.value.start === span.value.end) return unchanged();
    const missing =
      missingProposalNode(editor, "insertion") ??
      missingProposalNode(editor, "deletion");
    if (missing) return missing;
    const identity = prepareProposalId(options);
    if (identity.status !== "ready") return identity;
    const selected = isolateAcceptedTextRange(span.value);
    if (!selected?.length)
      throw new Error("Validated replacement target could not be isolated.");
    const oldSide = $createReviewDeletionNode(identity.value);
    const newSide = $createReviewInsertionNode(identity.value);
    const content = $createTextNode(text).setFormat(
      inspection.value.selection.format,
    );
    selected[0]!.insertBefore(oldSide);
    oldSide.append(...selected);
    oldSide.insertAfter(newSide);
    newSide.append(content);
    content.selectEnd();
    return changed();
  }
  const point = inspection.value.anchor;
  if (point.association === "proposal") {
    if (!$isReviewInsertionNode(point.wrapper)) {
      return refusal(
        "unsupported-proposal-edit",
        "Insertion typing may edit pending insertion content, not deletion content.",
      );
    }
    const map = buildProposalMapAroundPoint(point);
    if (map.status !== "ready") {
      return map;
    }
    const offset = getProposalOffset(point, map.value);
    if (offset === null) {
      return refusal(
        "invalid-structural-target",
        "The proposal caret cannot be resolved in the live tree.",
      );
    }
    insertIntoProposal(point, text);
    placeProposalCaret(map.value, offset + text.length, point.childIndex);
    return changed();
  }
  // A text point in accepted content identifies its side unambiguously.
  // Continue an adjacent insertion only when the boundary formatting agrees.
  if (point.node !== null) {
    const atStart = point.offset === 0;
    const atEnd = point.offset === point.node.getTextContentSize();
    const adjacent = atStart
      ? point.node.getPreviousSibling()
      : atEnd
        ? point.node.getNextSibling()
        : null;
    if ($isReviewInsertionNode(adjacent)) {
      const group = inspectProposalGroup(adjacent.getProposalId());
      if (group.status !== "ready") return group;
      const boundary = atStart
        ? adjacent.getLastChild()
        : adjacent.getFirstChild();
      if (
        $isTextNode(boundary) &&
        boundary.getFormat() ===
          $getReviewInputFormat(inspection.value.selection)
      ) {
        const offset = atStart ? boundary.getTextContentSize() : 0;
        boundary.spliceText(offset, 0, text, true);
        boundary.select(offset + text.length, offset + text.length);
        return changed();
      }
    }
  }
  const missingNode = missingProposalNode(editor, "insertion");
  if (missingNode !== null) {
    return missingNode;
  }
  const proposalId = prepareProposalId(options);
  if (proposalId.status !== "ready") {
    return proposalId;
  }
  insertInsertionProposalAtAcceptedPoint(
    point,
    inspection.value.selection,
    proposalId.value,
    text,
  );
  return changed();
}

export function $deleteReviewText(
  backward: boolean,
  options: ReviewDeletionOptions = {},
): ReviewIntentOutcome {
  const fragment = $deleteReviewFragment(
    backward,
    options.granularity ?? "character",
  );
  if (fragment) return fragment;
  if ((options.granularity ?? "character") === "character") {
    const structural = $deleteReviewBoundary(backward, options);
    if (structural) return structural;
  }
  const inspection = inspectSelection();
  if (inspection.status !== "ready") {
    return inspection;
  }
  if (!inspection.value.collapsed) {
    if (
      inspection.value.anchor.association === "proposal" &&
      inspection.value.focus.association === "proposal"
    ) {
      const proposalSpan = buildProposalSpan(inspection.value);
      if (proposalSpan.status !== "ready") {
        return proposalSpan;
      }
      return deleteProposalSelection(proposalSpan.value);
    }
    const acceptedSpan = buildAcceptedSpan(inspection.value);
    if (acceptedSpan.status !== "ready") {
      return acceptedSpan;
    }
    if (acceptedSpan.value.start === acceptedSpan.value.end) {
      return unchanged();
    }
    return deleteAcceptedSpan(acceptedSpan.value, backward, options);
  }

  const point = inspection.value.anchor;
  if (point.association === "proposal") {
    return deleteProposalAtCaret(
      point,
      backward,
      options.granularity ?? "character",
    );
  }
  if (
    point.node !== null &&
    (backward
      ? point.offset === 0
      : point.offset === point.node.getTextContentSize())
  ) {
    const adjacent = backward
      ? point.node.getPreviousSibling()
      : point.node.getNextSibling();
    if ($isReviewDeletionNode(adjacent)) {
      const group = inspectProposalGroup(adjacent.getProposalId());
      if (group.status !== "ready") return group;
      if (group.value.kind === "replacement")
        return $removeReviewReplacement(adjacent.getProposalId());
    }
  }
  const target = acceptedDeletionTarget(
    point,
    backward,
    options.granularity ?? "character",
  );
  if (target === null || target.start === target.end) {
    return refusal(
      "deletion-target-unavailable",
      "Deletion may not cross proposal content or an empty accepted boundary.",
    );
  }
  return deleteAcceptedSpan(target, backward, options);
}

/** Insert or correct pending insertion content in the current Lexical update. */
export function $insertReviewText(
  text: string,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  const fragment = $editReviewFragmentText(text);
  return fragment ?? performInsertion($getEditor(), text, options);
}

export type ReviewInsertionProposal = Readonly<{
  proposalId: string;
  text: string;
}>;

function findProposal(
  proposalId: string,
  kind: "insertion" | "deletion",
): Preparation<ProposalMap> {
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind !== kind)
    return refusal(
      "unsupported-target",
      `The identity does not identify an independent ${kind} proposal.`,
    );
  const first = group.value.wrappers[0]!;
  const paragraph = first.getParent();
  if (!isRootParagraph(paragraph))
    return refusal("invalid-structural-target", "Expected a paragraph.");
  return buildProposalMap(paragraph, first, group.value.wrappers.at(-1)!);
}

/** Inspect current node content; this snapshot is not a separate proposal record. */
export function $inspectReviewInsertion(
  proposalId: string,
): ReviewIntentOutcome<ReviewInsertionProposal> {
  const prepared = findProposal(proposalId, "insertion");
  if (prepared.status !== "ready") return prepared;
  return {
    status: "unchanged",
    value: {
      proposalId,
      text: prepared.value.entries
        .map((entry) => entry.node.getTextContent())
        .join(""),
    },
  };
}

function resolveProposal(
  proposalId: string,
  retainText: boolean,
  kind: "insertion" | "deletion",
): ReviewIntentOutcome {
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind === "replacement")
    return resolveReplacement(
      proposalId,
      kind === "insertion" ? retainText : !retainText,
    );
  const prepared = findProposal(proposalId, kind);
  if (prepared.status !== "ready") return prepared;
  const map = prepared.value;
  const first = map.wrappers[0]!;
  const index = first.getIndexWithinParent();
  const selection = $getSelection();
  const touchesProposal =
    $isRangeSelection(selection) &&
    [selection.anchor.key, selection.focus.key].some(
      (key) =>
        map.wrappers.some((node) => node.getKey() === key) ||
        map.entries.some((entry) => entry.node.getKey() === key),
    );
  if (retainText) {
    for (const wrapper of map.wrappers) {
      for (const child of wrapper.getChildren()) wrapper.insertBefore(child);
      wrapper.remove();
    }
    if (touchesProposal) map.entries.at(-1)!.node.selectEnd();
  } else {
    for (const wrapper of map.wrappers) wrapper.remove();
    if (touchesProposal) map.paragraph.select(index, index);
  }
  return changed();
}

/** Remove pending work explicitly, without accepting content or recording a decision. */
export function $removeReviewInsertion(
  proposalId: string,
): ReviewIntentOutcome {
  return resolveProposal(proposalId, false, "insertion");
}

/** Accept current insertion content into the accepted document state. */
export function $acceptReviewInsertion(
  proposalId: string,
): ReviewIntentOutcome {
  return resolveProposal(proposalId, true, "insertion");
}

/** Reject the insertion; native documents retain pending work only. */
export function $rejectReviewInsertion(
  proposalId: string,
): ReviewIntentOutcome {
  return resolveProposal(proposalId, false, "insertion");
}

export type ReviewDeletionOptions = ReviewAuthoringOptions &
  Readonly<{
    granularity?: "character" | "word";
  }>;
export type ReviewDeletionProposal = ReviewInsertionProposal;

/** Inspect the current pending deletion nodes. */
export function $inspectReviewDeletion(
  proposalId: string,
): ReviewIntentOutcome<ReviewDeletionProposal> {
  const prepared = findProposal(proposalId, "deletion");
  if (prepared.status !== "ready") return prepared;
  return {
    status: "unchanged",
    value: {
      proposalId,
      text: prepared.value.entries
        .map((entry) => entry.node.getTextContent())
        .join(""),
    },
  };
}

/** Remove pending deletion work, restoring its accepted text. */
export function $removeReviewDeletion(proposalId: string): ReviewIntentOutcome {
  return resolveProposal(proposalId, true, "deletion");
}

/** Accept the deletion by removing its text from accepted document state. */
export function $acceptReviewDeletion(proposalId: string): ReviewIntentOutcome {
  return resolveProposal(proposalId, false, "deletion");
}

/** Reject the deletion, restoring its accepted text without a terminal record. */
export function $rejectReviewDeletion(proposalId: string): ReviewIntentOutcome {
  return resolveProposal(proposalId, true, "deletion");
}

function deletionOffset(
  text: string,
  offset: number,
  backward: boolean,
  granularity: "character" | "word",
): number {
  if (granularity === "character")
    return backward
      ? previousCharacterOffset(text, offset)
      : nextCharacterOffset(text, offset);
  // A word intention consumes adjacent whitespace followed by one word or
  // punctuation run. Boundaries are computed without changing live selection.
  const pattern = backward
    ? /(?:[\p{L}\p{N}\p{M}_]+|[^\p{L}\p{N}\p{M}_\s]+)\s*$|\s+$/u
    : /^\s*(?:[\p{L}\p{N}\p{M}_]+|[^\p{L}\p{N}\p{M}_\s]+)|^\s+/u;
  const match = (backward ? text.slice(0, offset) : text.slice(offset)).match(
    pattern,
  );
  const length = match?.[0].length ?? 0;
  return backward ? offset - length : offset + length;
}

function deleteAcceptedSpan(
  span: AcceptedSpan,
  backward: boolean,
  options: ReviewDeletionOptions,
): ReviewIntentOutcome {
  const missing = missingProposalNode($getEditor(), "deletion");
  if (missing !== null) return missing;
  const first = getStartEntry(span.map.entries, span.start);
  const last = getEndEntry(span.map.entries, span.end);
  if (first === null || last === null)
    return refusal(
      "invalid-structural-target",
      "The deletion range has no live accepted target.",
    );
  const adjacent = backward
    ? span.end === last.end
      ? last.node.getNextSibling()
      : null
    : span.start === first.start
      ? first.node.getPreviousSibling()
      : null;
  let continuation = $isReviewDeletionNode(adjacent) ? adjacent : null;
  if (continuation) {
    const group = inspectProposalGroup(continuation.getProposalId());
    if (group.status !== "ready") return group;
    if (group.value.kind === "replacement") continuation = null;
  }
  const identity =
    continuation === null
      ? prepareProposalId(options)
      : { status: "ready" as const, value: continuation.getProposalId() };
  if (identity.status !== "ready") return identity;
  const selected = isolateAcceptedTextRange(span);
  if (selected === null || selected.length === 0)
    throw new Error("Validated deletion target could not be isolated.");
  const wrapper = continuation ?? $createReviewDeletionNode(identity.value);
  if (continuation === null) selected[0]!.insertBefore(wrapper);
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
    span.map.paragraph.select(index, index);
  }
  return changed();
}

function isReplacement(proposalId: string): boolean {
  const group = inspectProposalGroup(proposalId);
  return group.status === "ready" && group.value.kind === "replacement";
}

export type ReviewReplacementProposal = Readonly<{
  proposalId: string;
  oldText: string;
  newText: string;
}>;

export function $inspectReviewReplacement(
  proposalId: string,
): ReviewIntentOutcome<ReviewReplacementProposal> {
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind !== "replacement")
    return refusal(
      "unsupported-target",
      "The identity does not identify a replacement.",
    );
  return {
    status: "unchanged",
    value: {
      proposalId,
      oldText: group.value.wrappers
        .filter($isReviewDeletionNode)
        .map((node) => node.getTextContent())
        .join(""),
      newText: group.value.wrappers
        .filter($isReviewInsertionNode)
        .map((node) => node.getTextContent())
        .join(""),
    },
  };
}

function resolveReplacement(
  proposalId: string,
  accept: boolean,
): ReviewIntentOutcome {
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind !== "replacement")
    return refusal(
      "unsupported-target",
      "The identity does not identify a replacement.",
    );
  const selection = $getSelection();
  const keys = new Set(
    group.value.wrappers.flatMap((node) => [
      node.getKey(),
      ...node.getChildrenKeys(),
    ]),
  );
  const touches =
    $isRangeSelection(selection) &&
    (keys.has(selection.anchor.key) || keys.has(selection.focus.key));
  let last: LexicalNode | undefined;
  for (const wrapper of group.value.wrappers) {
    if ($isReviewInsertionNode(wrapper) === accept) {
      for (const child of wrapper.getChildren()) {
        wrapper.insertBefore(child);
        last = child;
      }
    }
    wrapper.remove();
  }
  if (touches && $isTextNode(last)) last.selectEnd();
  return changed();
}

export function $acceptReviewReplacement(
  proposalId: string,
): ReviewIntentOutcome {
  return resolveReplacement(proposalId, true);
}
export function $rejectReviewReplacement(
  proposalId: string,
): ReviewIntentOutcome {
  return resolveReplacement(proposalId, false);
}
export function $removeReviewReplacement(
  proposalId: string,
): ReviewIntentOutcome {
  return resolveReplacement(proposalId, false);
}

/** Resolve each identity once, validating the entire batch before mutation. */
export function $resolveReviewProposals(
  proposalIds: readonly string[],
  action: "accept" | "reject" | "remove",
): ReviewIntentOutcome {
  if ($getEditor().isComposing())
    return refusal(
      "unsupported-input",
      "Resolution is refused during composition.",
    );
  const groups = [];
  for (const id of new Set(proposalIds)) {
    const fragment = inspectFragment(id);
    if (fragment.status === "ready") {
      groups.push({ id, kind: "fragment" as const });
      continue;
    }
    const boundary = inspectBoundary(id);
    if (boundary.status === "ready") {
      groups.push({ id, kind: "boundary" as const });
      continue;
    }
    const group = inspectProposalGroup(id);
    if (group.status !== "ready") return group;
    groups.push({ id, kind: group.value.kind });
  }
  if (
    groups.some(
      (group) => group.kind === "boundary" || group.kind === "fragment",
    )
  ) {
    const invalid = validateStructuralState();
    if (invalid) return invalid;
  }
  for (const { id, kind } of groups) {
    if (kind === "fragment") {
      if (action === "accept") $acceptReviewFragment(id);
      else $rejectReviewFragment(id);
    } else if (kind === "boundary") {
      if (action === "accept") $acceptReviewStructure(id);
      else $rejectReviewStructure(id);
    } else if (kind === "formatting") {
      if (action === "accept") $acceptReviewFormatting(id);
      else $rejectReviewFormatting(id);
    } else if (kind === "replacement")
      resolveReplacement(id, action === "accept");
    else
      resolveProposal(
        id,
        kind === "insertion" ? action === "accept" : action !== "accept",
        kind,
      );
  }
  return groups.length ? changed() : unchanged();
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
