/**
 * Internal Lexical tree seam for review projection inspection and reconciliation.
 * Callers must create the cursor from an active Lexical read or update.
 */
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $getState,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setState,
  createState,
  type LexicalNode,
  type PointType,
  type RangeSelection,
  type TextNode,
} from "lexical";
import { $createReviewTextNode, ReviewTextNode } from "./ReviewTextNode";

export type AcceptedTextRun = Readonly<{
  format: number;
  text: string;
}>;

export type AcceptedParagraph = Readonly<{
  runs: readonly AcceptedTextRun[];
}>;

export type AcceptedDocumentView = Readonly<{
  paragraphs: readonly AcceptedParagraph[];
}>;

export type AcceptedPoint = Readonly<{
  offset: number;
  paragraph: number;
}>;

export type AcceptedRange = Readonly<{
  end: AcceptedPoint;
  start: AcceptedPoint;
}>;

export type ProjectionMode = "review" | "accepted-state" | "all-accepted";

export type ReviewProjection = Readonly<{
  accepted: AcceptedDocumentView;
  mode: ProjectionMode;
  paragraphs: readonly Readonly<{
    runs: readonly Readonly<{
      format: number;
      proposalId?: string;
      text: string;
      type:
        | "accepted"
        | "draft-deletion"
        | "draft-insertion"
        | "proposal-deletion"
        | "proposal-insertion";
    }>[];
  }>[];
}>;

export type ReviewSegment =
  | Readonly<{ type: "draft-deletion" }>
  | Readonly<{ type: "draft-insertion" }>
  | Readonly<{ proposalId: string; type: "proposal-deletion" }>
  | Readonly<{ proposalId: string; type: "proposal-insertion" }>;

function parseSegment(value: unknown): ReviewSegment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const segment = value as Partial<ReviewSegment>;
  if (segment.type === "draft-deletion" || segment.type === "draft-insertion") {
    return { type: segment.type };
  }
  if (
    (segment.type === "proposal-deletion" ||
      segment.type === "proposal-insertion") &&
    "proposalId" in segment &&
    typeof segment.proposalId === "string"
  ) {
    return {
      proposalId: segment.proposalId,
      type: segment.type,
    };
  }
  return null;
}

export const REVIEW_SEGMENT = createState("lexical-review-segment", {
  parse: parseSegment,
});

type IndexedTextNode = Readonly<{
  acceptedEnd: number;
  acceptedStart: number;
  node: TextNode;
  paragraph: number;
  segment: ReviewSegment | null;
}>;

type IndexedParagraph = Readonly<{
  acceptedLength: number;
  node: LexicalNode;
  textNodes: readonly IndexedTextNode[];
}>;

type ProjectionIndex = Readonly<{
  draftNodes: readonly TextNode[];
  paragraphs: readonly IndexedParagraph[];
  proposalNodes: ReadonlyMap<string, readonly TextNode[]>;
}>;

function buildProjectionIndex(): ProjectionIndex {
  const draftNodes: TextNode[] = [];
  const paragraphs: IndexedParagraph[] = [];
  const proposalNodes = new Map<string, TextNode[]>();
  for (const [paragraphIndex, paragraph] of $getRoot()
    .getChildren()
    .entries()) {
    const textNodes: IndexedTextNode[] = [];
    let acceptedOffset = 0;
    if ($isElementNode(paragraph)) {
      for (const child of paragraph.getChildren()) {
        if (!$isTextNode(child)) {
          continue;
        }
        const segment = $getState(child, REVIEW_SEGMENT);
        const acceptedStart = acceptedOffset;
        if (!isInsertionSegment(segment)) {
          acceptedOffset += child.getTextContentSize();
        }
        textNodes.push({
          acceptedEnd: acceptedOffset,
          acceptedStart,
          node: child,
          paragraph: paragraphIndex,
          segment,
        });
        if (
          segment?.type === "draft-insertion" ||
          segment?.type === "draft-deletion"
        ) {
          draftNodes.push(child);
        } else if (
          segment?.type === "proposal-insertion" ||
          segment?.type === "proposal-deletion"
        ) {
          const nodes = proposalNodes.get(segment.proposalId) ?? [];
          nodes.push(child);
          proposalNodes.set(segment.proposalId, nodes);
        }
      }
    }
    paragraphs.push({
      acceptedLength: acceptedOffset,
      node: paragraph,
      textNodes,
    });
  }
  return { draftNodes, paragraphs, proposalNodes };
}

function isInsertionSegment(segment: ReviewSegment | null): boolean {
  return (
    segment?.type === "draft-insertion" ||
    segment?.type === "proposal-insertion"
  );
}

function getAcceptedTextLength(node: LexicalNode): number {
  return $isTextNode(node) &&
    !isInsertionSegment($getState(node, REVIEW_SEGMENT))
    ? node.getTextContentSize()
    : 0;
}

function mergeTextRuns(runs: readonly AcceptedTextRun[]): AcceptedTextRun[] {
  return runs.reduce<AcceptedTextRun[]>((merged, run) => {
    const previous = merged.at(-1);
    if (previous !== undefined && previous.format === run.format) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
    } else {
      merged.push({ ...run });
    }
    return merged;
  }, []);
}

function getAcceptedDocumentView(index: ProjectionIndex): AcceptedDocumentView {
  return {
    paragraphs: index.paragraphs.map((paragraph) => ({
      runs: mergeTextRuns(
        paragraph.textNodes
          .filter(
            ({ segment }) =>
              segment === null ||
              segment.type === "draft-deletion" ||
              segment.type === "proposal-deletion",
          )
          .map(({ node }) => ({
            format: node.getFormat(),
            text: node.getTextContent(),
          })),
      ),
    })),
  };
}

function getProjectedParagraphs(
  index: ProjectionIndex,
  mode: ProjectionMode,
): ReviewProjection["paragraphs"] {
  return index.paragraphs.map((paragraph) => {
    const runs = paragraph.textNodes.flatMap(({ node, segment }) => {
      if (
        mode === "accepted-state" &&
        (segment?.type === "draft-insertion" ||
          segment?.type === "proposal-insertion")
      ) {
        return [];
      }
      if (
        mode === "all-accepted" &&
        (segment?.type === "draft-deletion" ||
          segment?.type === "proposal-deletion")
      ) {
        return [];
      }
      return [
        {
          format: node.getFormat(),
          ...(segment?.type === "proposal-insertion" ||
          segment?.type === "proposal-deletion"
            ? { proposalId: segment.proposalId }
            : {}),
          text: node.getTextContent(),
          sourceType: segment?.type ?? "accepted",
          type:
            mode === "review" && segment !== null
              ? segment.type
              : ("accepted" as const),
        },
      ];
    });
    const mergedRuns = runs.reduce<typeof runs>((merged, run) => {
      const previous = merged.at(-1);
      const mergeableSegment =
        previous !== undefined &&
        previous.type === run.type &&
        (run.type === "draft-deletion" ||
          run.type === "draft-insertion" ||
          ((run.type === "proposal-deletion" ||
            run.type === "proposal-insertion") &&
            previous.proposalId === run.proposalId));
      const mergeableAccepted =
        (mode === "review" || mode === "all-accepted") &&
        previous !== undefined &&
        previous.type === "accepted" &&
        run.type === "accepted" &&
        previous.sourceType !== "draft-insertion" &&
        previous.sourceType !== "proposal-insertion" &&
        run.sourceType !== "draft-insertion" &&
        run.sourceType !== "proposal-insertion";
      if (
        previous !== undefined &&
        (mergeableSegment || mergeableAccepted) &&
        previous.format === run.format
      ) {
        previous.text += run.text;
      } else {
        merged.push(run);
      }
      return merged;
    }, []);
    return {
      runs: mergedRuns.map(({ format, proposalId, text, type }) => ({
        format,
        ...(proposalId === undefined ? {} : { proposalId }),
        text,
        type,
      })),
    };
  });
}

function findDraftNodes(
  index: ProjectionIndex,
  kind?: "deletion" | "insertion",
): TextNode[] {
  return index.draftNodes.filter((node) => {
    const segment = $getState(node, REVIEW_SEGMENT);
    return (
      segment !== null &&
      (kind === undefined
        ? segment.type === "draft-insertion" ||
          segment.type === "draft-deletion"
        : (kind === "insertion" && segment.type === "draft-insertion") ||
          (kind === "deletion" && segment.type === "draft-deletion"))
    );
  });
}

function findDraftNode(index: ProjectionIndex): TextNode | null {
  return findDraftNodes(index, "insertion")[0] ?? null;
}

function getDraftProjection(index: ProjectionIndex): Readonly<{
  nodes: readonly TextNode[];
  runs: readonly AcceptedTextRun[];
}> | null {
  const nodes = findDraftNodes(index);
  return nodes.length === 0
    ? null
    : {
        nodes,
        runs: nodes.map((node) => ({
          format: node.getFormat(),
          text: node.getTextContent(),
        })),
      };
}

type AcceptedRangePart = Readonly<{
  end: number;
  node: TextNode;
  segment: ReviewSegment | null;
  start: number;
}>;

function copyTextNodeProperties(source: TextNode, target: TextNode): void {
  target.setFormat(source.getFormat());
  target.setDetail(source.getDetail());
  target.setMode(source.getMode());
  target.setStyle(source.getStyle());
}

function getAcceptedRangeParts(
  index: ProjectionIndex,
  target: AcceptedRange,
): AcceptedRangePart[] | null {
  if (
    target.start.paragraph !== target.end.paragraph ||
    target.start.offset < 0 ||
    target.end.offset < target.start.offset
  ) {
    return null;
  }
  const paragraph = index.paragraphs[target.start.paragraph];
  if (paragraph === undefined || !$isElementNode(paragraph.node)) {
    return null;
  }

  const parts: AcceptedRangePart[] = [];
  for (const {
    acceptedEnd: childEnd,
    acceptedStart: childStart,
    node,
    segment,
  } of paragraph.textNodes) {
    if (isInsertionSegment(segment)) {
      continue;
    }
    const start = Math.max(target.start.offset, childStart);
    const end = Math.min(target.end.offset, childEnd);
    if (start < end) {
      parts.push({
        end: end - childStart,
        node,
        segment,
        start: start - childStart,
      });
    }
  }

  return target.end.offset <= paragraph.acceptedLength ? parts : null;
}

function getAcceptedTextRuns(
  parts: readonly AcceptedRangePart[] | null,
): AcceptedTextRun[] | null {
  if (parts === null || parts.some((part) => part.segment !== null)) {
    return null;
  }
  return mergeTextRuns(
    parts.map((part) => ({
      format: part.node.getFormat(),
      text: part.node.getTextContent().slice(part.start, part.end),
    })),
  );
}

function inspectAcceptedRange(
  index: ProjectionIndex,
  target: AcceptedRange,
): Readonly<{
  requestedRuns: AcceptedTextRun[] | null;
  withinBounds: boolean;
}> {
  const parts = getAcceptedRangeParts(index, target);
  return {
    requestedRuns: getAcceptedTextRuns(parts),
    withinBounds: parts !== null,
  };
}

function markDeletionRange(
  index: ProjectionIndex,
  target: AcceptedRange,
  segment: Extract<
    ReviewSegment,
    { type: "draft-deletion" | "proposal-deletion" }
  >,
): ReviewTextNode[] | null {
  const parts = getAcceptedRangeParts(index, target);
  if (
    parts === null ||
    parts.length === 0 ||
    parts.some((part) => part.segment !== null)
  ) {
    return null;
  }

  const deletedNodes: ReviewTextNode[] = [];
  for (const part of [...parts].reverse()) {
    const text = part.node.getTextContent();
    const replacement: ReviewTextNode[] = [];
    if (part.start > 0) {
      const before = $createReviewTextNode(
        text.slice(0, part.start),
        "original",
      );
      copyTextNodeProperties(part.node, before);
      replacement.push(before);
    }
    const deleted = $createReviewTextNode(
      text.slice(part.start, part.end),
      "deletion",
    );
    copyTextNodeProperties(part.node, deleted);
    $setState(deleted, REVIEW_SEGMENT, segment);
    replacement.push(deleted);
    deletedNodes.unshift(deleted);
    if (part.end < text.length) {
      const after = $createReviewTextNode(text.slice(part.end), "original");
      copyTextNodeProperties(part.node, after);
      replacement.push(after);
    }

    const first = replacement[0]!;
    part.node.replace(first);
    let previous = first;
    for (const next of replacement.slice(1)) {
      previous.insertAfter(next);
      previous = next;
    }
  }
  return deletedNodes;
}

function restoreDraftDeletion(index: ProjectionIndex): ReviewTextNode[] {
  const restoredNodes: ReviewTextNode[] = [];
  for (const draftNode of findDraftNodes(index, "deletion")) {
    const restored = $createReviewTextNode(
      draftNode.getTextContent(),
      "original",
    );
    copyTextNodeProperties(draftNode, restored);
    draftNode.replace(restored);
    restoredNodes.push(restored);
  }
  return restoredNodes;
}

function getAcceptedPoint(
  index: ProjectionIndex,
  point: PointType,
): AcceptedPoint | null {
  const node = point.getNode();
  const paragraph = $isElementNode(node) ? node : node.getParent();
  if (!$isElementNode(paragraph) || paragraph.getParent() !== $getRoot()) {
    return null;
  }

  const paragraphIndex = paragraph.getIndexWithinParent();
  const indexedParagraph = index.paragraphs[paragraphIndex];
  if (indexedParagraph === undefined) {
    return null;
  }
  const children = paragraph.getChildren();
  if ($isElementNode(node)) {
    if (
      !Number.isInteger(point.offset) ||
      point.offset < 0 ||
      point.offset > children.length
    ) {
      return null;
    }
    let offset = 0;
    for (const child of children.slice(0, point.offset)) {
      offset += getAcceptedTextLength(child);
    }
    return { offset, paragraph: paragraphIndex };
  }
  if (!$isTextNode(node)) {
    return null;
  }
  if (point.offset < 0 || point.offset > node.getTextContentSize()) {
    return null;
  }
  for (const child of indexedParagraph.textNodes) {
    if (child.node.getKey() === node.getKey()) {
      return {
        offset:
          child.acceptedStart +
          (isInsertionSegment($getState(node, REVIEW_SEGMENT))
            ? 0
            : point.offset),
        paragraph: paragraphIndex,
      };
    }
  }
  return null;
}

function getInsertionDraftSelection(
  index: ProjectionIndex,
  target: AcceptedPoint,
): Readonly<{ end: number; start: number }> | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return null;
  }
  const draftNode = findDraftNode(index);
  if (
    draftNode === null ||
    !selection.getNodes().some((node) => node.getKey() === draftNode.getKey())
  ) {
    return null;
  }
  const anchor = getAcceptedPoint(index, selection.anchor);
  const focus = getAcceptedPoint(index, selection.focus);
  if (
    anchor === null ||
    focus === null ||
    anchor.paragraph !== focus.paragraph ||
    anchor.offset !== target.offset ||
    focus.offset !== target.offset
  ) {
    return null;
  }
  const paragraph = draftNode.getParent();
  if (!$isElementNode(paragraph) || paragraph.getParent() !== $getRoot()) {
    return null;
  }
  const draftIndex = draftNode.getIndexWithinParent();
  const draftLength = draftNode.getTextContentSize();
  const pointPosition = (
    point: PointType,
  ): "after" | "before" | "draft" | null => {
    const node = point.getNode();
    if (node.getKey() === draftNode.getKey()) {
      return "draft";
    }
    if (node.getKey() === paragraph.getKey()) {
      return point.offset <= draftIndex ? "before" : "after";
    }
    if (node.getParent()?.getKey() !== paragraph.getKey()) {
      return null;
    }
    return node.getIndexWithinParent() < draftIndex ? "before" : "after";
  };
  const startPoint = selection.isBackward()
    ? selection.focus
    : selection.anchor;
  const endPoint = selection.isBackward() ? selection.anchor : selection.focus;
  const startPosition = pointPosition(startPoint);
  const endPosition = pointPosition(endPoint);
  const start =
    startPosition === "draft"
      ? startPoint.offset
      : startPosition === "before"
        ? 0
        : null;
  const end =
    endPosition === "draft"
      ? endPoint.offset
      : endPosition === "after"
        ? draftLength
        : null;
  return start === null || end === null || start > end ? null : { end, start };
}

function findProposalNodes(index: ProjectionIndex, id: string): TextNode[] {
  return [...(index.proposalNodes.get(id) ?? [])];
}

function mapOffsetAfterInsertion(
  offset: number,
  target: AcceptedPoint,
  length: number,
): number {
  return offset >= target.offset ? offset + length : offset;
}

function mapOffsetAfterDeletion(offset: number, target: AcceptedRange): number {
  const length = target.end.offset - target.start.offset;
  if (offset >= target.end.offset) {
    return offset - length;
  }
  if (offset <= target.start.offset) {
    return offset;
  }
  return target.start.offset;
}

function remapTargetAfterResolution(
  candidate: ProjectionProposal,
  resolved: ProjectionProposal,
): AcceptedPoint | AcceptedRange {
  if (candidate.kind === "insertion") {
    if (resolved.kind === "insertion") {
      const length = resolved.payload.runs.reduce(
        (total, run) => total + run.text.length,
        0,
      );
      return candidate.target.paragraph === resolved.target.paragraph
        ? {
            ...candidate.target,
            offset: mapOffsetAfterInsertion(
              candidate.target.offset,
              resolved.target,
              length,
            ),
          }
        : candidate.target;
    }
    return candidate.target.paragraph === resolved.target.start.paragraph
      ? {
          ...candidate.target,
          offset: mapOffsetAfterDeletion(
            candidate.target.offset,
            resolved.target,
          ),
        }
      : candidate.target;
  }
  if (resolved.kind === "insertion") {
    const length = resolved.payload.runs.reduce(
      (total, run) => total + run.text.length,
      0,
    );
    return candidate.target.start.paragraph === resolved.target.paragraph
      ? {
          start: {
            ...candidate.target.start,
            offset: mapOffsetAfterInsertion(
              candidate.target.start.offset,
              resolved.target,
              length,
            ),
          },
          end: {
            ...candidate.target.end,
            offset: mapOffsetAfterInsertion(
              candidate.target.end.offset,
              resolved.target,
              length,
            ),
          },
        }
      : candidate.target;
  }
  return candidate.target.start.paragraph === resolved.target.start.paragraph
    ? {
        start: {
          ...candidate.target.start,
          offset: mapOffsetAfterDeletion(
            candidate.target.start.offset,
            resolved.target,
          ),
        },
        end: {
          ...candidate.target.end,
          offset: mapOffsetAfterDeletion(
            candidate.target.end.offset,
            resolved.target,
          ),
        },
      }
    : candidate.target;
}

function selectAcceptedCaret(
  index: ProjectionIndex,
  target: AcceptedPoint,
): void {
  const paragraph = index.paragraphs[target.paragraph];
  if (paragraph === undefined || !$isElementNode(paragraph.node)) {
    return;
  }
  for (const child of paragraph.textNodes) {
    if (isInsertionSegment(child.segment)) {
      continue;
    }
    if (target.offset <= child.acceptedEnd) {
      const localOffset = target.offset - child.acceptedStart;
      child.node.select(localOffset, localOffset);
      return;
    }
  }
  paragraph.node.selectEnd();
}

function insertInsertionNodes(
  index: ProjectionIndex,
  target: AcceptedPoint,
  runs: readonly AcceptedTextRun[],
  segment: Extract<
    ReviewSegment,
    { type: "draft-insertion" | "proposal-insertion" }
  >,
): boolean {
  const paragraph = index.paragraphs[target.paragraph];
  if (paragraph === undefined || !$isElementNode(paragraph.node)) {
    return false;
  }
  const insertionNodes = runs.map((run) => {
    const node = $createReviewTextNode(run.text, "insertion");
    node.setFormat(run.format);
    $setState(node, REVIEW_SEGMENT, segment);
    return node;
  });
  const firstInsertion = insertionNodes[0];
  if (firstInsertion === undefined) {
    return false;
  }

  const insertAtPoint = (insert: () => void) => {
    insert();
    let previous = firstInsertion;
    for (const node of insertionNodes.slice(1)) {
      previous.insertAfter(node);
      previous = node;
    }
  };

  for (const child of paragraph.textNodes) {
    if (isInsertionSegment(child.segment)) {
      continue;
    }
    if (target.offset <= child.acceptedEnd) {
      const localOffset = target.offset - child.acceptedStart;
      if (localOffset === 0) {
        insertAtPoint(() => child.node.insertBefore(firstInsertion));
      } else if (localOffset === child.node.getTextContentSize()) {
        insertAtPoint(() => child.node.insertAfter(firstInsertion));
      } else {
        const right = child.node.splitText(localOffset)[1]!;
        insertAtPoint(() => right.insertBefore(firstInsertion));
      }
      return true;
    }
  }
  if (target.offset === paragraph.acceptedLength) {
    paragraph.node.append(...insertionNodes);
    return true;
  }
  return false;
}

function hasAcceptedInsertionPoint(
  index: ProjectionIndex,
  target: AcceptedPoint,
): boolean {
  const paragraph = index.paragraphs[target.paragraph];
  if (
    paragraph === undefined ||
    !$isElementNode(paragraph.node) ||
    !Number.isInteger(target.offset) ||
    target.offset < 0
  ) {
    return false;
  }
  return target.offset <= paragraph.acceptedLength;
}

function getDraftTargets(index: ProjectionIndex): Readonly<{
  deletion: AcceptedRange | null;
  insertion: AcceptedPoint | null;
}> {
  const insertion = index.paragraphs
    .flatMap((paragraph) => paragraph.textNodes)
    .find(({ segment }) => segment?.type === "draft-insertion");
  const deletion = index.paragraphs
    .flatMap((paragraph) => paragraph.textNodes)
    .filter(({ segment }) => segment?.type === "draft-deletion");
  const insertionTarget =
    insertion === undefined
      ? null
      : { offset: insertion.acceptedStart, paragraph: insertion.paragraph };
  if (deletion.length === 0) {
    return { deletion: null, insertion: insertionTarget };
  }
  const firstDeletion = deletion[0]!;
  const lastDeletion = deletion.at(-1)!;
  return {
    deletion:
      firstDeletion.paragraph !== lastDeletion.paragraph
        ? null
        : {
            end: {
              offset: lastDeletion.acceptedEnd,
              paragraph: lastDeletion.paragraph,
            },
            start: {
              offset: firstDeletion.acceptedStart,
              paragraph: firstDeletion.paragraph,
            },
          },
    insertion: insertionTarget,
  };
}

function isDraftDeletionNode(
  node: LexicalNode | null | undefined,
): node is TextNode {
  return (
    $isTextNode(node) &&
    $getState(node, REVIEW_SEGMENT)?.type === "draft-deletion"
  );
}

function isCaretInsideDeletionDraft(selection: RangeSelection): boolean {
  const node = selection.anchor.getNode();
  return (
    isDraftDeletionNode(node) &&
    selection.anchor.offset > 0 &&
    selection.anchor.offset < node.getTextContentSize()
  );
}

function isCaretAdjacentToDeletionDraft(
  selection: RangeSelection,
  isBackward: boolean,
): boolean {
  const node = selection.anchor.getNode();
  if (isDraftDeletionNode(node)) {
    const offset = selection.anchor.offset;
    return isBackward ? offset === node.getTextContentSize() : offset === 0;
  }
  if ($isTextNode(node)) {
    const offset = selection.anchor.offset;
    const sibling = isBackward
      ? node.getPreviousSibling()
      : node.getNextSibling();
    return (
      offset === (isBackward ? 0 : node.getTextContentSize()) &&
      isDraftDeletionNode(sibling)
    );
  }
  if (!$isElementNode(node)) {
    return false;
  }
  return isDraftDeletionNode(
    node.getChildAtIndex(
      isBackward ? selection.anchor.offset - 1 : selection.anchor.offset,
    ),
  );
}

function inspectSelection(
  index: ProjectionIndex,
): ProjectionSelectionInspection {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return { status: "unsupported" };
  }
  const draftTargets = getDraftTargets(index);
  const point = (which: "anchor" | "focus") => {
    const selectionPoint = selection[which];
    const node = selectionPoint.getNode();
    const segment = $isTextNode(node) ? $getState(node, REVIEW_SEGMENT) : null;
    return {
      accepted: getAcceptedPoint(index, selectionPoint),
      association: (segment?.type ??
        "accepted") as ProjectionSelectionAssociation,
      format: $isTextNode(node) ? node.getFormat() : 0,
    };
  };
  const selectedSegments = selection.getNodes().flatMap((node) => {
    if (!$isTextNode(node)) {
      return [];
    }
    const segment = $getState(node, REVIEW_SEGMENT);
    return segment === null ? [] : [segment];
  });
  let acceptedBoundary:
    "ambiguous" | "not-applicable" | "unsupported" | "unambiguous" =
    "not-applicable";
  if (selection.isCollapsed()) {
    const anchorNode = selection.anchor.getNode();
    if (!$isElementNode(anchorNode)) {
      acceptedBoundary = "unambiguous";
    } else if (anchorNode.getParent() !== $getRoot()) {
      acceptedBoundary = "unsupported";
    } else {
      const children = anchorNode.getChildren();
      const left = children[selection.anchor.offset - 1];
      const right = children[selection.anchor.offset];
      acceptedBoundary =
        (left !== undefined &&
          $isTextNode(left) &&
          $getState(left, REVIEW_SEGMENT) !== null) ||
        (right !== undefined &&
          $isTextNode(right) &&
          $getState(right, REVIEW_SEGMENT) !== null)
          ? "ambiguous"
          : "unambiguous";
    }
  }
  return {
    acceptedBoundary,
    anchor: point("anchor"),
    backward: selection.isBackward(),
    collapsed: selection.isCollapsed(),
    deletionDraft: {
      adjacentBackward: isCaretAdjacentToDeletionDraft(selection, true),
      adjacentForward: isCaretAdjacentToDeletionDraft(selection, false),
      inside: isCaretInsideDeletionDraft(selection),
      target: draftTargets.deletion,
    },
    focus: point("focus"),
    insertionDraft: {
      selection:
        draftTargets.insertion === null
          ? null
          : getInsertionDraftSelection(index, draftTargets.insertion),
      target: draftTargets.insertion,
    },
    selected: {
      draftDeletion: selectedSegments.some(
        (segment) => segment.type === "draft-deletion",
      ),
      draftInsertion: selectedSegments.some(
        (segment) => segment.type === "draft-insertion",
      ),
      finalizedProposal: selectedSegments.some(
        (segment) =>
          segment.type === "proposal-deletion" ||
          segment.type === "proposal-insertion",
      ),
    },
    status: "available",
  };
}

function moveCaretToDeletionContinuation(
  index: ProjectionIndex,
  isBackward: boolean,
): boolean {
  const selection = $getSelection();
  const target = getDraftTargets(index).deletion;
  if (!$isRangeSelection(selection) || target === null) {
    return false;
  }
  const point = getAcceptedPoint(index, selection.anchor);
  const boundary = isBackward ? target.start : target.end;
  if (
    point === null ||
    point.paragraph !== boundary.paragraph ||
    point.offset !== boundary.offset
  ) {
    return false;
  }
  const node = selection.anchor.getNode();
  let continuation: TextNode | null = null;
  if ($isTextNode(node)) {
    const segment = $getState(node, REVIEW_SEGMENT);
    if (segment === null) {
      const atBoundary = isBackward
        ? selection.anchor.offset === node.getTextContentSize()
        : selection.anchor.offset === 0;
      if (atBoundary) {
        continuation = node;
      }
    } else if (segment.type === "draft-deletion") {
      const sibling = isBackward
        ? node.getPreviousSibling()
        : node.getNextSibling();
      if ($isTextNode(sibling) && $getState(sibling, REVIEW_SEGMENT) === null) {
        continuation = sibling;
      }
    }
  } else if ($isElementNode(node)) {
    const sibling = node.getChildAtIndex(
      isBackward ? selection.anchor.offset - 1 : selection.anchor.offset,
    );
    if ($isTextNode(sibling) && $getState(sibling, REVIEW_SEGMENT) === null) {
      continuation = sibling;
    }
  }
  if (continuation === null) {
    return false;
  }
  const offset = isBackward ? continuation.getTextContentSize() : 0;
  selection.anchor.set(continuation.getKey(), offset, "text");
  selection.focus.set(continuation.getKey(), offset, "text");
  selection.dirty = true;
  return true;
}

export function $canReviewSegmentsMerge(
  left: ReviewTextNode,
  right: ReviewTextNode,
): boolean {
  const leftSegment = $getState(left, REVIEW_SEGMENT);
  const rightSegment = $getState(right, REVIEW_SEGMENT);
  if (leftSegment === null || rightSegment === null) {
    return leftSegment === rightSegment;
  }
  if (leftSegment.type !== rightSegment.type) {
    return false;
  }
  return (
    leftSegment.type === "draft-insertion" ||
    leftSegment.type === "draft-deletion" ||
    leftSegment.proposalId ===
      (
        rightSegment as Extract<
          ReviewSegment,
          { type: "proposal-deletion" | "proposal-insertion" }
        >
      ).proposalId
  );
}

export type ReviewProjectionStateInspection = Readonly<{
  accepted: AcceptedDocumentView;
  draftRuns: readonly AcceptedTextRun[] | null;
}>;

export type ProjectionRangeInspection = Readonly<{
  requestedRuns: readonly AcceptedTextRun[] | null;
  withinBounds: boolean;
}>;

export type ProjectionDraftInspection = Readonly<{
  count: number;
  format: number | null;
  runs: readonly AcceptedTextRun[];
  text: string;
}>;

export type ProjectionSelectionAssociation =
  | "accepted"
  | "draft-deletion"
  | "draft-insertion"
  | "proposal-deletion"
  | "proposal-insertion";

export type ProjectionSelectionInspection =
  | Readonly<{ status: "unsupported" }>
  | Readonly<{
      acceptedBoundary:
        "ambiguous" | "not-applicable" | "unsupported" | "unambiguous";
      anchor: Readonly<{
        accepted: AcceptedPoint | null;
        association: ProjectionSelectionAssociation;
        format: number;
      }>;
      backward: boolean;
      collapsed: boolean;
      deletionDraft: Readonly<{
        adjacentBackward: boolean;
        adjacentForward: boolean;
        inside: boolean;
        target: AcceptedRange | null;
      }>;
      focus: Readonly<{
        accepted: AcceptedPoint | null;
        association: ProjectionSelectionAssociation;
        format: number;
      }>;
      insertionDraft: Readonly<{
        selection: Readonly<{ end: number; start: number }> | null;
        target: AcceptedPoint | null;
      }>;
      selected: Readonly<{
        draftDeletion: boolean;
        draftInsertion: boolean;
        finalizedProposal: boolean;
      }>;
      status: "available";
    }>;

export type ProjectionProposal =
  | Readonly<{
      id: string;
      kind: "insertion";
      payload: Readonly<{ runs: readonly AcceptedTextRun[] }>;
      target: AcceptedPoint;
    }>
  | Readonly<{
      id: string;
      kind: "deletion";
      payload: Readonly<{ runs: readonly AcceptedTextRun[] }>;
      target: AcceptedRange;
    }>;

export type ProjectionSelectionTarget =
  | Readonly<{ kind: "accepted-caret"; target: AcceptedPoint }>
  | Readonly<{
      kind: "deletion-draft-continuation";
      direction: "backward" | "forward" | "range";
    }>
  | Readonly<{
      isBackward: boolean;
      kind: "deletion-native-continuation";
    }>
  | Readonly<{ kind: "insertion-draft-end" }>
  | Readonly<{ kind: "insertion-draft-offset"; offset: number }>;

export type ProjectionReconciliation =
  | Readonly<{ kind: "discard-draft" }>
  | Readonly<{ kind: "restore-deletion-draft" }>
  | Readonly<{ end: number; kind: "trim-insertion-draft"; start: number }>
  | Readonly<{ kind: "append-insertion-draft"; run: AcceptedTextRun }>
  | Readonly<{
      kind: "insert";
      runs: readonly AcceptedTextRun[];
      segment: Extract<
        ReviewSegment,
        { type: "draft-insertion" | "proposal-insertion" }
      >;
      target: AcceptedPoint;
    }>
  | Readonly<{
      kind: "mark-deletion";
      segment: Extract<
        ReviewSegment,
        { type: "draft-deletion" | "proposal-deletion" }
      >;
      target: AcceptedRange;
    }>
  | Readonly<{ kind: "settle-draft"; proposal: ProjectionProposal }>
  | Readonly<{
      candidates: readonly ProjectionProposal[];
      kind: "resolve-proposal";
      proposal: ProjectionProposal;
      resolution: "accepted" | "rejected";
    }>
  | Readonly<{
      kind: "install-proposals";
      proposals: readonly ProjectionProposal[];
    }>
  | Readonly<{ kind: "place-selection"; target: ProjectionSelectionTarget }>;

export type ProjectionReconciliationResult =
  | Readonly<{
      status: "changed";
      value?: Readonly<{
        format?: number;
        remappedTargets?: readonly Readonly<{
          id: string;
          target: AcceptedPoint | AcceptedRange;
        }>[];
        text?: string;
      }>;
    }>
  | Readonly<{ status: "unchanged" }>
  | Readonly<{
      reason: Readonly<{
        code:
          | "accepted-point-unavailable"
          | "accepted-range-unavailable"
          | "draft-segment-unavailable";
        message: string;
      }>;
      status: "unavailable";
    }>;

export interface ReviewProjectionCursor {
  inspect(
    request: Readonly<{ kind: "state" }>,
  ): ReviewProjectionStateInspection;
  inspect(
    request: Readonly<{ kind: "view"; mode: ProjectionMode }>,
  ): ReviewProjection;
  inspect(
    request: Readonly<{ kind: "accepted-range"; target: AcceptedRange }>,
  ): ProjectionRangeInspection;
  inspect(
    request: Readonly<{ kind: "insertion-point"; target: AcceptedPoint }>,
  ): Readonly<{ available: boolean }>;
  inspect(
    request: Readonly<{
      draftKind?: "deletion" | "insertion";
      kind: "draft";
    }>,
  ): ProjectionDraftInspection;
  inspect(
    request: Readonly<{ kind: "proposal"; proposalId: string }>,
  ): Readonly<{ count: number }>;
  inspect(
    request: Readonly<{ kind: "selection-point"; point: "anchor" | "focus" }>,
  ): AcceptedPoint | null;
  inspect(
    request: Readonly<{
      kind: "insertion-draft-selection";
      target: AcceptedPoint;
    }>,
  ): Readonly<{ end: number; start: number }> | null;
  inspect(
    request: Readonly<{ kind: "selection" }>,
  ): ProjectionSelectionInspection;
  reconcile(command: ProjectionReconciliation): ProjectionReconciliationResult;
}

/**
 * Creates one transaction-scoped semantic cursor over the current Lexical tree.
 * The cursor never exposes Lexical nodes across its interface.
 */
export function $createReviewProjection(): ReviewProjectionCursor {
  const index = buildProjectionIndex();
  const accepted = getAcceptedDocumentView(index);
  const draftProjection = getDraftProjection(index);
  const cursor = {
    inspect(
      request:
        | Readonly<{ kind: "state" }>
        | Readonly<{ kind: "view"; mode: ProjectionMode }>
        | Readonly<{ kind: "accepted-range"; target: AcceptedRange }>
        | Readonly<{ kind: "insertion-point"; target: AcceptedPoint }>
        | Readonly<{
            draftKind?: "deletion" | "insertion";
            kind: "draft";
          }>
        | Readonly<{ kind: "proposal"; proposalId: string }>
        | Readonly<{
            kind: "selection-point";
            point: "anchor" | "focus";
          }>
        | Readonly<{
            kind: "insertion-draft-selection";
            target: AcceptedPoint;
          }>
        | Readonly<{ kind: "selection" }>,
    ):
      | AcceptedPoint
      | ProjectionDraftInspection
      | ProjectionRangeInspection
      | ProjectionSelectionInspection
      | Readonly<{ available: boolean }>
      | Readonly<{ count: number }>
      | Readonly<{ end: number; start: number }>
      | ReviewProjectionStateInspection
      | ReviewProjection
      | null {
      if (request.kind === "state") {
        return {
          accepted,
          draftRuns:
            draftProjection === null
              ? null
              : mergeTextRuns(draftProjection.runs),
        };
      }
      if (request.kind === "view") {
        return {
          accepted,
          mode: request.mode,
          paragraphs: getProjectedParagraphs(index, request.mode),
        };
      }
      if (request.kind === "accepted-range") {
        return inspectAcceptedRange(index, request.target);
      }
      if (request.kind === "insertion-point") {
        return { available: hasAcceptedInsertionPoint(index, request.target) };
      }
      if (request.kind === "draft") {
        const nodes = findDraftNodes(index, request.draftKind);
        return {
          count: nodes.length,
          format: nodes[0]?.getFormat() ?? null,
          runs: mergeTextRuns(
            nodes.map((node) => ({
              format: node.getFormat(),
              text: node.getTextContent(),
            })),
          ),
          text: nodes.map((node) => node.getTextContent()).join(""),
        };
      }
      if (request.kind === "proposal") {
        return { count: findProposalNodes(index, request.proposalId).length };
      }
      if (request.kind === "insertion-draft-selection") {
        return getInsertionDraftSelection(index, request.target);
      }
      if (request.kind === "selection") {
        return inspectSelection(index);
      }
      const selection = $getSelection();
      return $isRangeSelection(selection)
        ? getAcceptedPoint(index, selection[request.point])
        : null;
    },
    reconcile(command): ProjectionReconciliationResult {
      if (command.kind === "discard-draft") {
        const nodes = findDraftNodes(index);
        for (const node of nodes) {
          node.remove();
        }
        return nodes.length === 0
          ? { status: "unchanged" }
          : { status: "changed" };
      }
      if (command.kind === "restore-deletion-draft") {
        return restoreDraftDeletion(index).length === 0
          ? { status: "unchanged" }
          : { status: "changed" };
      }
      if (command.kind === "trim-insertion-draft") {
        const node = findDraftNode(index);
        if (node === null) {
          return {
            reason: {
              code: "draft-segment-unavailable",
              message: "The insertion draft segment is unavailable.",
            },
            status: "unavailable",
          };
        }
        const text = node.getTextContent();
        const boundedStart = Math.max(0, Math.min(command.start, text.length));
        const boundedEnd = Math.max(
          boundedStart,
          Math.min(command.end, text.length),
        );
        if (boundedStart >= boundedEnd) {
          return { status: "unchanged" };
        }
        const nextText = text.slice(0, boundedStart) + text.slice(boundedEnd);
        node.setTextContent(nextText);
        return {
          status: "changed",
          value: { format: node.getFormat(), text: nextText },
        };
      }
      if (command.kind === "append-insertion-draft") {
        const node = findDraftNode(index);
        if (node === null || node.getFormat() !== command.run.format) {
          return {
            reason: {
              code: "draft-segment-unavailable",
              message: "The compatible insertion draft segment is unavailable.",
            },
            status: "unavailable",
          };
        }
        const text = `${node.getTextContent()}${command.run.text}`;
        node.setTextContent(text);
        return {
          status: "changed",
          value: { format: node.getFormat(), text },
        };
      }
      if (command.kind === "insert") {
        return insertInsertionNodes(
          index,
          command.target,
          command.runs,
          command.segment,
        )
          ? { status: "changed" }
          : {
              reason: {
                code: "accepted-point-unavailable",
                message: "The accepted-state insertion point is unavailable.",
              },
              status: "unavailable",
            };
      }
      if (command.kind === "mark-deletion") {
        return markDeletionRange(index, command.target, command.segment) ===
          null
          ? {
              reason: {
                code: "accepted-range-unavailable",
                message: "The accepted-state deletion range is unavailable.",
              },
              status: "unavailable",
            }
          : { status: "changed" };
      }
      if (command.kind === "settle-draft") {
        const nodes = findDraftNodes(index, command.proposal.kind);
        if (nodes.length === 0) {
          return {
            reason: {
              code: "draft-segment-unavailable",
              message: "The proposal draft segment is unavailable.",
            },
            status: "unavailable",
          };
        }
        for (const node of nodes) {
          $setState(node, REVIEW_SEGMENT, {
            proposalId: command.proposal.id,
            type:
              command.proposal.kind === "insertion"
                ? "proposal-insertion"
                : "proposal-deletion",
          });
        }
        return { status: "changed" };
      }
      if (command.kind === "resolve-proposal") {
        const proposalNodes = findProposalNodes(index, command.proposal.id);
        if (proposalNodes.length === 0) {
          return {
            reason: {
              code: "draft-segment-unavailable",
              message: "The pending proposal segments are unavailable.",
            },
            status: "unavailable",
          };
        }
        const selection = $getSelection();
        const selectionWasProposalLocal =
          $isRangeSelection(selection) &&
          proposalNodes.some(
            (node) =>
              selection.anchor.key === node.getKey() ||
              selection.focus.key === node.getKey(),
          );
        if (command.proposal.kind === "insertion") {
          if (command.resolution === "accepted") {
            const acceptedNodes = proposalNodes.map((proposalNode) => {
              const acceptedNode = $createTextNode(
                proposalNode.getTextContent(),
              );
              copyTextNodeProperties(proposalNode, acceptedNode);
              proposalNode.replace(acceptedNode);
              return acceptedNode;
            });
            if (selectionWasProposalLocal) {
              const finalAcceptedNode = acceptedNodes.at(-1)!;
              const end = finalAcceptedNode.getTextContentSize();
              finalAcceptedNode.select(end, end);
            }
          } else {
            for (const proposalNode of proposalNodes) {
              proposalNode.remove();
            }
            if (selectionWasProposalLocal) {
              selectAcceptedCaret(index, command.proposal.target);
            }
          }
        } else if (command.resolution === "accepted") {
          for (const proposalNode of proposalNodes) {
            proposalNode.remove();
          }
          if (selectionWasProposalLocal) {
            selectAcceptedCaret(index, command.proposal.target.start);
          }
        } else {
          for (const proposalNode of proposalNodes) {
            const acceptedNode = $createTextNode(proposalNode.getTextContent());
            copyTextNodeProperties(proposalNode, acceptedNode);
            proposalNode.replace(acceptedNode);
          }
          if (selectionWasProposalLocal) {
            selectAcceptedCaret(index, command.proposal.target.start);
          }
        }
        return {
          status: "changed",
          value: {
            remappedTargets:
              command.resolution === "accepted"
                ? command.candidates.map((candidate) => ({
                    id: candidate.id,
                    target: remapTargetAfterResolution(
                      candidate,
                      command.proposal,
                    ),
                  }))
                : [],
          },
        };
      }
      if (command.kind === "install-proposals") {
        for (const proposal of command.proposals) {
          const available =
            proposal.kind === "insertion"
              ? hasAcceptedInsertionPoint(index, proposal.target)
              : inspectAcceptedRange(index, proposal.target).requestedRuns !==
                null;
          if (!available) {
            return {
              reason: {
                code:
                  proposal.kind === "insertion"
                    ? "accepted-point-unavailable"
                    : "accepted-range-unavailable",
                message: `The pending ${proposal.kind} target is unavailable.`,
              },
              status: "unavailable",
            };
          }
        }
        for (const proposal of command.proposals) {
          if (proposal.kind === "insertion") {
            if (
              !insertInsertionNodes(
                index,
                proposal.target,
                proposal.payload.runs,
                {
                  proposalId: proposal.id,
                  type: "proposal-insertion",
                },
              )
            ) {
              throw new Error(
                "A validated insertion target became unavailable.",
              );
            }
          } else if (
            markDeletionRange(index, proposal.target, {
              proposalId: proposal.id,
              type: "proposal-deletion",
            }) === null
          ) {
            throw new Error("A validated deletion target became unavailable.");
          }
        }
        return command.proposals.length === 0
          ? { status: "unchanged" }
          : { status: "changed" };
      }
      const target = command.target;
      if (target.kind === "deletion-native-continuation") {
        return moveCaretToDeletionContinuation(index, target.isBackward)
          ? { status: "changed" }
          : { status: "unchanged" };
      }
      if (target.kind === "accepted-caret") {
        selectAcceptedCaret(index, target.target);
        return { status: "changed" };
      }
      if (target.kind === "insertion-draft-end") {
        const node = findDraftNode(index);
        if (node === null) {
          return { status: "unchanged" };
        }
        node.selectEnd();
        return { status: "changed" };
      }
      if (target.kind === "insertion-draft-offset") {
        const node = findDraftNode(index);
        if (node === null) {
          return { status: "unchanged" };
        }
        const offset = Math.max(
          0,
          Math.min(target.offset, node.getTextContentSize()),
        );
        node.select(offset, offset);
        return { status: "changed" };
      }
      const nodes = findDraftNodes(index, "deletion");
      if (nodes.length === 0) {
        return { status: "unchanged" };
      }
      const node = target.direction === "backward" ? nodes[0]! : nodes.at(-1)!;
      const offset =
        target.direction === "backward" ? 0 : node.getTextContentSize();
      node.select(offset, offset);
      return { status: "changed" };
    },
  } as ReviewProjectionCursor;
  return cursor;
}
