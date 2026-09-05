import {
  $createTextNode,
  $getEditor,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
  type PointType,
  type RangeSelection,
  type TextNode,
} from "lexical";
import { createProposalId, isValidProposalId } from "./ProposalIdentity";
import {
  $canReviewElementNodesBeMerged,
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $isReviewDeletionNode,
  $isReviewInsertionNode,
  ReviewDeletionNode,
  ReviewElementNode,
  ReviewInsertionNode,
} from "./ReviewNodes";

const SUPPORTED_TEXT_FORMAT_MASK = 0b1111;

type PointSnapshot = Readonly<{
  key: string;
  offset: number;
  type: "element" | "text";
}>;

export type ReviewIntentRefusalCode =
  | "ambiguous-boundary"
  | "deletion-target-unavailable"
  | "invalid-proposal-id"
  | "invalid-structural-target"
  | "unsafe-proposal-intersection"
  | "unsupported-formatting"
  | "unsupported-input"
  | "unsupported-proposal-edit"
  | "unsupported-structure"
  | "unsupported-target"
  | "unsupported-transfer";

export type ReviewIntentRefusal = Readonly<{
  code: ReviewIntentRefusalCode;
  message: string;
  status: "refused";
}>;

export type ReviewIntentError = Readonly<{
  cause: unknown;
  code: string;
  message: string;
}>;

export type ReviewIntentOutcome<T = void> =
  | Readonly<{ status: "changed"; value: T }>
  | Readonly<{ status: "unchanged"; value: T }>
  | ReviewIntentRefusal
  | Readonly<{ error: ReviewIntentError; status: "failed" }>;

export type ReviewProposalIdFactory = () => string;

export type ReviewAuthoringOptions = Readonly<{
  proposalIdFactory?: ReviewProposalIdFactory;
}>;

type AcceptedPoint = Readonly<{
  association: "accepted";
  childIndex: number;
  node: TextNode | null;
  offset: number;
  paragraph: ParagraphNode;
}>;

type ProposalPoint = Readonly<{
  association: "proposal";
  childIndex: number;
  node: TextNode | null;
  offset: number;
  paragraph: ParagraphNode;
  wrapper: ReviewElementNode;
}>;

type SelectionPoint = AcceptedPoint | ProposalPoint;

type SelectionInspection = Readonly<{
  anchor: SelectionPoint;
  backward: boolean;
  collapsed: boolean;
  focus: SelectionPoint;
  selection: RangeSelection;
}>;

type Preparation<T> =
  Readonly<{ status: "ready"; value: T }> | ReviewIntentRefusal;

type ProposalMapEntry = Readonly<{
  end: number;
  node: TextNode;
  start: number;
  wrapper: ReviewElementNode;
}>;

type ProposalMap = Readonly<{
  entries: readonly ProposalMapEntry[];
  paragraph: ParagraphNode;
  total: number;
  wrappers: readonly ReviewElementNode[];
  proposalId: string;
}>;

type ProposalSpan = Readonly<{
  end: number;
  map: ProposalMap;
  start: number;
}>;

type AcceptedMapEntry = Readonly<{
  childIndex: number;
  end: number;
  node: TextNode;
  start: number;
}>;

type AcceptedMap = Readonly<{
  entries: readonly AcceptedMapEntry[];
  paragraph: ParagraphNode;
  total: number;
}>;

type AcceptedSpan = Readonly<{
  end: number;
  map: AcceptedMap;
  start: number;
}>;

function refusal(
  code: ReviewIntentRefusalCode,
  message: string,
): ReviewIntentRefusal {
  return { code, message, status: "refused" };
}

function changed(): ReviewIntentOutcome {
  return { status: "changed", value: undefined };
}

function unchanged(): ReviewIntentOutcome {
  return { status: "unchanged", value: undefined };
}

function isRootParagraph(node: LexicalNode | null): node is ParagraphNode {
  return $isParagraphNode(node) && node.getParent() === $getRoot();
}

function isReviewElementNode(
  node: LexicalNode | null | undefined,
): node is ReviewElementNode {
  return $isReviewDeletionNode(node) || $isReviewInsertionNode(node);
}

type RootProposalContext = Readonly<{
  paragraph: ParagraphNode;
  wrapper: ReviewElementNode;
}>;

function getRootProposalContext(
  node: LexicalNode | null | undefined,
): RootProposalContext | null {
  if (!isReviewElementNode(node)) {
    return null;
  }
  const paragraph = node.getParent();
  return isRootParagraph(paragraph) ? { paragraph, wrapper: node } : null;
}

function isSameProposalNode(
  node: LexicalNode | null | undefined,
  reference: ReviewElementNode,
): node is ReviewElementNode {
  return (
    isReviewElementNode(node) && $canReviewElementNodesBeMerged(reference, node)
  );
}

function snapshotPoint(point: PointType): PointSnapshot {
  return { key: point.key, offset: point.offset, type: point.type };
}

function restorePointAfterReviewElementMerge(
  point: PointType,
  snapshot: PointSnapshot,
  left: ReviewElementNode,
  right: ReviewElementNode,
  parent: ElementNode,
  leftChildCount: number,
  rightIndex: number,
): void {
  if (snapshot.type === "element" && snapshot.key === right.getKey()) {
    point.set(left.getKey(), leftChildCount + snapshot.offset, "element");
    return;
  }
  if (snapshot.type === "element" && snapshot.key === parent.getKey()) {
    if (snapshot.offset === rightIndex) {
      point.set(left.getKey(), leftChildCount, "element");
    } else if (snapshot.offset > rightIndex) {
      point.set(parent.getKey(), snapshot.offset - 1, "element");
    } else {
      point.set(parent.getKey(), snapshot.offset, "element");
    }
    return;
  }
  point.set(snapshot.key, snapshot.offset, snapshot.type);
}

function mergeReviewElementNodes(
  left: ReviewElementNode,
  right: ReviewElementNode,
): void {
  const parent = left.getParent();
  const rightIndex = right.getIndexWithinParent();
  if (!$isElementNode(parent) || rightIndex < 0) {
    return;
  }
  const leftChildCount = left.getChildrenSize();
  const selection = $getSelection();
  const anchor = $isRangeSelection(selection)
    ? snapshotPoint(selection.anchor)
    : null;
  const focus = $isRangeSelection(selection)
    ? snapshotPoint(selection.focus)
    : null;

  left.append(...right.getChildren());
  right.remove();

  if ($isRangeSelection(selection) && anchor !== null && focus !== null) {
    restorePointAfterReviewElementMerge(
      selection.anchor,
      anchor,
      left,
      right,
      parent,
      leftChildCount,
      rightIndex,
    );
    restorePointAfterReviewElementMerge(
      selection.focus,
      focus,
      left,
      right,
      parent,
      leftChildCount,
      rightIndex,
    );
    selection.dirty = true;
  }
}

export function normalizeReviewElementNode(node: ReviewElementNode): void {
  if (!node.isAttached()) {
    return;
  }
  const previous = node.getPreviousSibling();
  if (
    isReviewElementNode(previous) &&
    $canReviewElementNodesBeMerged(previous, node)
  ) {
    mergeReviewElementNodes(previous, node);
    return;
  }
  const next = node.getNextSibling();
  if (isReviewElementNode(next) && $canReviewElementNodesBeMerged(node, next)) {
    mergeReviewElementNodes(node, next);
  }
}

function getChildIndex(parent: ElementNode, node: LexicalNode): number | null {
  const index = parent
    .getChildren()
    .findIndex((child) => child.getKey() === node.getKey());
  return index === -1 ? null : index;
}

function getTextChildren(wrapper: ReviewElementNode): TextNode[] | null {
  const children = wrapper.getChildren();
  if (
    children.length === 0 ||
    children.some(
      (child) => !$isTextNode(child) || child.getTextContentSize() === 0,
    )
  ) {
    return null;
  }
  return children.filter($isTextNode);
}

function validateParagraphStructure(
  paragraph: ParagraphNode,
): ReviewIntentRefusal | null {
  for (const child of paragraph.getChildren()) {
    if ($isTextNode(child)) {
      if (hasUnsupportedTextFormatting(child)) {
        return refusal(
          "unsupported-formatting",
          "Review editing supports bold, italic, strikethrough, and underline text without inline styles or token modes.",
        );
      }
      continue;
    }
    if (isReviewElementNode(child)) {
      const textChildren = getTextChildren(child);
      if (textChildren === null) {
        return refusal(
          "invalid-structural-target",
          "Review editing supports only direct paragraph text and text-only proposal wrappers.",
        );
      }
      if (textChildren.some(hasUnsupportedTextFormatting)) {
        return refusal(
          "unsupported-formatting",
          "Review editing supports bold, italic, strikethrough, and underline text without inline styles or token modes.",
        );
      }
      continue;
    }
    return refusal(
      "invalid-structural-target",
      "Review editing supports only direct paragraph text and text-only proposal wrappers.",
    );
  }
  return null;
}

function hasUnsupportedTextFormatting(node: TextNode): boolean {
  return (
    (node.getFormat() & ~SUPPORTED_TEXT_FORMAT_MASK) !== 0 ||
    node.getDetail() !== 0 ||
    node.getMode() !== "normal" ||
    node.getStyle() !== ""
  );
}

function validateSelectionFormatting(
  selection: RangeSelection,
): ReviewIntentRefusal | null {
  return (selection.format & ~SUPPORTED_TEXT_FORMAT_MASK) !== 0 ||
    selection.style !== ""
    ? refusal(
        "unsupported-formatting",
        "Review editing supports bold, italic, strikethrough, and underline text without inline styles.",
      )
    : null;
}

function isTextBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) {
    return true;
  }
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

function previousCharacterOffset(text: string, offset: number): number {
  const previous = offset - 1;
  if (
    previous > 0 &&
    text.charCodeAt(previous) >= 0xdc00 &&
    text.charCodeAt(previous) <= 0xdfff &&
    text.charCodeAt(previous - 1) >= 0xd800 &&
    text.charCodeAt(previous - 1) <= 0xdbff
  ) {
    return previous - 1;
  }
  return previous;
}

function nextCharacterOffset(text: string, offset: number): number {
  const next = offset + 1;
  if (
    next < text.length &&
    text.charCodeAt(offset) >= 0xd800 &&
    text.charCodeAt(offset) <= 0xdbff &&
    text.charCodeAt(next) >= 0xdc00 &&
    text.charCodeAt(next) <= 0xdfff
  ) {
    return next + 1;
  }
  return next;
}

function classifyPoint(point: PointType): Preparation<SelectionPoint> {
  const node = point.getNode();
  if (point.type === "text") {
    if (!$isTextNode(node)) {
      return refusal(
        "invalid-structural-target",
        "A text selection point must identify a Lexical text node.",
      );
    }
    const text = node.getTextContent();
    if (
      !Number.isInteger(point.offset) ||
      point.offset < 0 ||
      point.offset > text.length ||
      !isTextBoundary(text, point.offset)
    ) {
      return refusal(
        "invalid-structural-target",
        "The text selection point is outside a supported Unicode text boundary.",
      );
    }
    const parentNode: LexicalNode | null = node.getParent();
    if (isRootParagraph(parentNode)) {
      const structure = validateParagraphStructure(parentNode);
      if (structure !== null) {
        return structure;
      }
      const childIndex = getChildIndex(parentNode, node);
      if (childIndex === null) {
        return refusal(
          "invalid-structural-target",
          "The selected text node is not attached to its paragraph.",
        );
      }
      return {
        status: "ready",
        value: {
          association: "accepted",
          childIndex,
          node,
          offset: point.offset,
          paragraph: parentNode,
        },
      };
    }
    const proposal = getRootProposalContext(parentNode);
    if (proposal !== null) {
      const { paragraph, wrapper: parent } = proposal;
      const structure = validateParagraphStructure(paragraph);
      if (structure !== null) {
        return structure;
      }
      const childIndex = getChildIndex(paragraph, parent);
      if (childIndex === null) {
        return refusal(
          "invalid-structural-target",
          "The selected proposal wrapper is not attached to its paragraph.",
        );
      }
      const textChildren = getTextChildren(parent);
      if (textChildren === null) {
        return refusal(
          "invalid-structural-target",
          "The selected proposal wrapper has unsupported live children.",
        );
      }
      return {
        status: "ready",
        value: {
          association: "proposal",
          childIndex,
          node,
          offset: point.offset,
          paragraph,
          wrapper: parent,
        },
      };
    }
    return refusal(
      "invalid-structural-target",
      "Review editing supports only direct paragraph text and proposal text.",
    );
  }

  if (!$isElementNode(node)) {
    return refusal(
      "invalid-structural-target",
      "An element selection point must identify a Lexical element node.",
    );
  }
  if (!Number.isInteger(point.offset) || point.offset < 0) {
    return refusal(
      "invalid-structural-target",
      "The element selection point has an invalid child offset.",
    );
  }
  const proposal = getRootProposalContext(node);
  if (proposal !== null) {
    const { paragraph, wrapper } = proposal;
    const textChildren = getTextChildren(wrapper);
    if (textChildren === null || point.offset > textChildren.length) {
      return refusal(
        "invalid-structural-target",
        "The proposal element point does not identify a supported child boundary.",
      );
    }
    const structure = validateParagraphStructure(paragraph);
    if (structure !== null) {
      return structure;
    }
    const childIndex = getChildIndex(paragraph, node);
    if (childIndex === null) {
      return refusal(
        "invalid-structural-target",
        "The selected proposal wrapper is not attached to its paragraph.",
      );
    }
    return {
      status: "ready",
      value: {
        association: "proposal",
        childIndex,
        node: null,
        offset: textChildren
          .slice(0, point.offset)
          .reduce((total, child) => total + child.getTextContentSize(), 0),
        paragraph,
        wrapper,
      },
    };
  }
  if (isRootParagraph(node)) {
    const structure = validateParagraphStructure(node);
    if (structure !== null) {
      return structure;
    }
    const children = node.getChildren();
    if (point.offset > children.length) {
      return refusal(
        "invalid-structural-target",
        "The paragraph element point is outside its child range.",
      );
    }
    const left = children[point.offset - 1];
    const right = children[point.offset];
    if (isReviewElementNode(left) || isReviewElementNode(right)) {
      return refusal(
        "ambiguous-boundary",
        "A paragraph boundary next to proposal content does not identify one editing side.",
      );
    }
    return {
      status: "ready",
      value: {
        association: "accepted",
        childIndex: point.offset,
        node: null,
        offset: children
          .slice(0, point.offset)
          .reduce((total, child) => total + child.getTextContentSize(), 0),
        paragraph: node,
      },
    };
  }
  return refusal(
    "invalid-structural-target",
    "Review editing supports only paragraph and proposal element points.",
  );
}

function inspectSelection(): Preparation<SelectionInspection> {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return refusal(
      "unsupported-target",
      "Review editing requires one Lexical range selection.",
    );
  }
  const formatting = validateSelectionFormatting(selection);
  if (formatting !== null) {
    return formatting;
  }
  const anchor = classifyPoint(selection.anchor);
  if (anchor.status !== "ready") {
    return anchor;
  }
  const focus = classifyPoint(selection.focus);
  if (focus.status !== "ready") {
    return focus;
  }
  return {
    status: "ready",
    value: {
      anchor: anchor.value,
      backward: selection.isBackward(),
      collapsed: selection.isCollapsed(),
      focus: focus.value,
      selection,
    },
  };
}

function sameProposal(left: ProposalPoint, right: ProposalPoint): boolean {
  return (
    left.paragraph === right.paragraph &&
    isSameProposalNode(left.wrapper, right.wrapper)
  );
}

function buildProposalMap(
  paragraph: ParagraphNode,
  startWrapper: ReviewElementNode,
  endWrapper: ReviewElementNode,
): Preparation<ProposalMap> {
  const startIndex = getChildIndex(paragraph, startWrapper);
  const endIndex = getChildIndex(paragraph, endWrapper);
  if (startIndex === null || endIndex === null || startIndex > endIndex) {
    return refusal(
      "invalid-structural-target",
      "The proposal selection wrappers are not ordered in one paragraph.",
    );
  }
  const proposalId = startWrapper.getProposalId();
  const wrappers: ReviewElementNode[] = [];
  const entries: ProposalMapEntry[] = [];
  let offset = 0;
  const children = paragraph.getChildren();
  for (let index = startIndex; index <= endIndex; index += 1) {
    const child = children[index];
    if (!isSameProposalNode(child, startWrapper)) {
      return refusal(
        "unsafe-proposal-intersection",
        "The selection intersects accepted content or another proposal identity.",
      );
    }
    const textChildren = getTextChildren(child);
    if (textChildren === null) {
      return refusal(
        "invalid-structural-target",
        "A pending proposal contains unsupported live children.",
      );
    }
    wrappers.push(child);
    for (const node of textChildren) {
      const end = offset + node.getTextContentSize();
      entries.push({ end, node, start: offset, wrapper: child });
      offset = end;
    }
  }
  if (entries.length === 0) {
    return refusal(
      "invalid-structural-target",
      "A pending proposal must contain live text before it can be edited.",
    );
  }
  return {
    status: "ready",
    value: {
      entries,
      paragraph,
      proposalId,
      total: offset,
      wrappers,
    },
  };
}

function buildProposalMapAroundPoint(
  point: ProposalPoint,
): Preparation<ProposalMap> {
  const children = point.paragraph.getChildren();
  let startIndex = point.childIndex;
  let endIndex = point.childIndex;
  const isSameWrapper = (
    child: LexicalNode | undefined,
  ): child is ReviewElementNode => isSameProposalNode(child, point.wrapper);

  while (startIndex > 0 && isSameWrapper(children[startIndex - 1])) {
    startIndex -= 1;
  }
  while (
    endIndex + 1 < children.length &&
    isSameWrapper(children[endIndex + 1])
  ) {
    endIndex += 1;
  }
  const startWrapper = children[startIndex];
  const endWrapper = children[endIndex];
  if (!isSameWrapper(startWrapper) || !isSameWrapper(endWrapper)) {
    return refusal(
      "invalid-structural-target",
      "The proposal caret is not attached to a supported proposal run.",
    );
  }
  return buildProposalMap(point.paragraph, startWrapper, endWrapper);
}

function getProposalOffset(
  point: ProposalPoint,
  map: ProposalMap,
): number | null {
  let offset = 0;
  for (const wrapper of map.wrappers) {
    const children = getTextChildren(wrapper);
    if (children === null) {
      return null;
    }
    if (wrapper.getKey() === point.wrapper.getKey()) {
      if (point.node === null) {
        return offset + point.offset;
      }
      for (const child of children) {
        if (child.getKey() === point.node.getKey()) {
          return offset + point.offset;
        }
        offset += child.getTextContentSize();
      }
      return null;
    }
    offset += children.reduce(
      (total, child) => total + child.getTextContentSize(),
      0,
    );
  }
  return null;
}

function buildProposalSpan(
  inspection: SelectionInspection,
): Preparation<ProposalSpan> {
  if (
    inspection.anchor.association !== "proposal" ||
    inspection.focus.association !== "proposal"
  ) {
    return refusal(
      "unsafe-proposal-intersection",
      "The selection does not stay on one proposal side.",
    );
  }
  if (!sameProposal(inspection.anchor, inspection.focus)) {
    return refusal(
      "unsafe-proposal-intersection",
      "A selection may edit only one proposal identity and kind at a time.",
    );
  }
  const startPoint = inspection.backward ? inspection.focus : inspection.anchor;
  const endPoint = inspection.backward ? inspection.anchor : inspection.focus;
  const map = buildProposalMap(
    startPoint.paragraph,
    startPoint.wrapper,
    endPoint.wrapper,
  );
  if (map.status !== "ready") {
    return map;
  }
  const start = getProposalOffset(startPoint, map.value);
  const end = getProposalOffset(endPoint, map.value);
  if (start === null || end === null || end < start) {
    return refusal(
      "invalid-structural-target",
      "The proposal selection points cannot be ordered in the live tree.",
    );
  }
  return { status: "ready", value: { end, map: map.value, start } };
}

function buildAcceptedMap(paragraph: ParagraphNode): Preparation<AcceptedMap> {
  const entries: AcceptedMapEntry[] = [];
  let offset = 0;
  for (const [childIndex, child] of paragraph.getChildren().entries()) {
    if (!$isTextNode(child)) {
      continue;
    }
    const end = offset + child.getTextContentSize();
    if (child.getTextContentSize() > 0) {
      entries.push({ childIndex, end, node: child, start: offset });
    }
    offset = end;
  }
  return {
    status: "ready",
    value: { entries, paragraph, total: offset },
  };
}

function getAcceptedOffset(
  point: AcceptedPoint,
  map: AcceptedMap,
): number | null {
  let offset = 0;
  const children = map.paragraph.getChildren();
  for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
    if (childIndex > point.childIndex) {
      break;
    }
    const child = children[childIndex];
    if (child === undefined) {
      return null;
    }
    if (childIndex === point.childIndex) {
      if (point.node === null) {
        return offset;
      }
      if (!$isTextNode(child) || child.getKey() !== point.node.getKey()) {
        return null;
      }
      return offset + point.offset;
    }
    if ($isTextNode(child)) {
      offset += child.getTextContentSize();
    }
  }
  return point.node === null &&
    point.childIndex === map.paragraph.getChildrenSize()
    ? offset
    : null;
}

function buildAcceptedSpan(
  inspection: SelectionInspection,
): Preparation<AcceptedSpan> {
  if (
    inspection.anchor.association !== "accepted" ||
    inspection.focus.association !== "accepted"
  ) {
    return refusal(
      "unsafe-proposal-intersection",
      "The selection intersects proposal-side content.",
    );
  }
  if (inspection.anchor.paragraph !== inspection.focus.paragraph) {
    return refusal(
      "unsupported-target",
      "Accepted editing supports one same-paragraph range.",
    );
  }
  const startPoint = inspection.backward ? inspection.focus : inspection.anchor;
  const endPoint = inspection.backward ? inspection.anchor : inspection.focus;
  const startIndex = startPoint.childIndex;
  const endIndex = endPoint.node
    ? endPoint.childIndex
    : endPoint.childIndex - 1;
  if (startIndex > endIndex + 1) {
    return refusal(
      "invalid-structural-target",
      "The accepted selection points are not ordered in the paragraph.",
    );
  }
  const children = startPoint.paragraph.getChildren();
  for (let index = startIndex; index <= endIndex; index += 1) {
    const child = children[index];
    if (child !== undefined && !$isTextNode(child)) {
      return refusal(
        "unsafe-proposal-intersection",
        "The accepted range crosses pending proposal content.",
      );
    }
  }
  const map = buildAcceptedMap(startPoint.paragraph);
  if (map.status !== "ready") {
    return map;
  }
  const start = getAcceptedOffset(startPoint, map.value);
  const end = getAcceptedOffset(endPoint, map.value);
  if (start === null || end === null || end < start) {
    return refusal(
      "invalid-structural-target",
      "The accepted selection points cannot be resolved in the live tree.",
    );
  }
  return { status: "ready", value: { end, map: map.value, start } };
}

function getStartEntry(
  entries: readonly AcceptedMapEntry[] | readonly ProposalMapEntry[],
  offset: number,
): AcceptedMapEntry | ProposalMapEntry | null {
  return (
    entries.find((entry) => entry.start <= offset && offset < entry.end) ?? null
  );
}

function getEndEntry(
  entries: readonly AcceptedMapEntry[] | readonly ProposalMapEntry[],
  offset: number,
): AcceptedMapEntry | ProposalMapEntry | null {
  return (
    entries.find((entry) => entry.start < offset && offset <= entry.end) ?? null
  );
}

function getAcceptedSelectedNodes(span: AcceptedSpan): TextNode[] | null {
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
    if (child.getParent() !== map.paragraph) {
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
  map.paragraph.select(
    Math.min(Math.max(fallbackIndex, 0), map.paragraph.getChildrenSize()),
  );
}

function removeProposalRange(
  span: ProposalSpan,
  start: number,
  end: number,
): void {
  for (let index = span.map.entries.length - 1; index >= 0; index -= 1) {
    const entry = span.map.entries[index];
    if (entry === undefined) {
      continue;
    }
    const localStart = Math.max(start, entry.start) - entry.start;
    const localEnd = Math.min(end, entry.end) - entry.start;
    if (localStart >= localEnd) {
      continue;
    }
    entry.node.spliceText(localStart, localEnd - localStart, "", false);
    if (entry.node.getTextContentSize() === 0) {
      entry.node.remove();
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
    if (entry.node.getKey() === startEntry.node.getKey()) {
      entry.node.spliceText(localStart, localEnd - localStart, text, true);
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
  placeProposalCaret(span.map, span.start + text.length, fallbackIndex ?? 0);
  return changed();
}

function insertIntoProposal(point: ProposalPoint, text: string): void {
  if (point.node !== null) {
    point.node.spliceText(point.offset, 0, text, true);
    return;
  }
  const children = getTextChildren(point.wrapper);
  if (children === null) {
    throw new Error("The proposal wrapper has no editable text children.");
  }
  if (point.offset === 0) {
    children[0]!.spliceText(0, 0, text, true);
    return;
  }
  let offset = 0;
  for (const child of children) {
    const end = offset + child.getTextContentSize();
    if (point.offset <= end) {
      child.spliceText(point.offset - offset, 0, text, true);
      return;
    }
    offset = end;
  }
  children
    .at(-1)!
    .spliceText(children.at(-1)!.getTextContentSize(), 0, text, true);
}

function getUniqueProposalId(
  factory: ReviewProposalIdFactory,
): Preparation<string> {
  const existing = new Set<string>();
  for (const paragraph of $getRoot().getChildren()) {
    if (!$isElementNode(paragraph)) {
      continue;
    }
    for (const child of paragraph.getChildren()) {
      if (isReviewElementNode(child)) {
        existing.add(child.getProposalId());
      }
    }
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let proposalId: string;
    try {
      proposalId = factory();
    } catch (cause) {
      return refusal(
        "invalid-proposal-id",
        cause instanceof Error
          ? cause.message
          : "The proposal identity factory failed.",
      );
    }
    if (isValidProposalId(proposalId) && !existing.has(proposalId)) {
      return { status: "ready", value: proposalId };
    }
  }
  return refusal(
    "invalid-proposal-id",
    "The proposal identity factory did not produce a unique valid identity.",
  );
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

function insertAcceptedProposal(
  point: AcceptedPoint,
  selection: RangeSelection,
  kind: "deletion" | "insertion",
  proposalId: string,
  text: string,
): void {
  const wrapper =
    kind === "insertion"
      ? $createReviewInsertionNode(proposalId)
      : $createReviewDeletionNode(proposalId);
  const textNode = $createTextNode(text);
  textNode.setFormat(point.node?.getFormat() ?? selection.format);
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
): Readonly<{ end: number; map: AcceptedMap; start: number }> | null {
  const map = buildAcceptedMap(point.paragraph);
  if (map.status !== "ready") {
    return null;
  }
  const offset = getAcceptedOffset(point, map.value);
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
    const entries = map.value.entries.filter(
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
      map: map.value,
    };
  }
  if (point.node !== null) {
    const text = point.node.getTextContent();
    if (backward && point.offset > 0) {
      return {
        end: offset,
        map: map.value,
        start:
          offset - (point.offset - previousCharacterOffset(text, point.offset)),
      };
    }
    if (!backward && point.offset < text.length) {
      return {
        end: offset + (nextCharacterOffset(text, point.offset) - point.offset),
        map: map.value,
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
  const adjacentEntry = map.value.entries.find(
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
      map: map.value,
      start: adjacentEntry.start + start,
    };
  }
  const end = nextCharacterOffset(adjacent.getTextContent(), 0);
  return {
    end: adjacentEntry.start + end,
    map: map.value,
    start: adjacentEntry.start,
  };
}

function deleteProposalAtCaret(
  point: ProposalPoint,
  backward: boolean,
  granularity: "character" | "word",
): ReviewIntentOutcome {
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
  const fallbackIndex = point.childIndex;
  removeProposalRange(span, start, end);
  placeProposalCaret(map.value, start, fallbackIndex);
  return changed();
}

function deleteProposalSelection(span: ProposalSpan): ReviewIntentOutcome {
  if (span.start === span.end) {
    return unchanged();
  }
  if ($isReviewDeletionNode(span.map.wrappers[0]))
    return $removeReviewDeletion(span.map.proposalId);
  const fallbackIndex = getChildIndex(
    span.map.paragraph,
    span.map.wrappers[0]!,
  );
  removeProposalRange(span, span.start, span.end);
  placeProposalCaret(span.map, span.start, fallbackIndex ?? 0);
  return changed();
}

function prepareProposalId(
  options: ReviewAuthoringOptions,
): Preparation<string> {
  return getUniqueProposalId(options.proposalIdFactory ?? createProposalId);
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
    return refusal(
      "unsupported-target",
      "Text replacement ranges are not part of the node-backed insertion contract.",
    );
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
      const boundary = atStart
        ? adjacent.getLastChild()
        : adjacent.getFirstChild();
      if (
        $isTextNode(boundary) &&
        boundary.getFormat() === point.node.getFormat()
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
  insertAcceptedProposal(
    point,
    inspection.value.selection,
    "insertion",
    proposalId.value,
    text,
  );
  return changed();
}

export function $deleteReviewText(
  backward: boolean,
  options: ReviewDeletionOptions = {},
): ReviewIntentOutcome {
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
  return performInsertion($getEditor(), text, options);
}

export type ReviewInsertionProposal = Readonly<{
  proposalId: string;
  text: string;
}>;

function findProposal(
  proposalId: string,
  kind: "insertion" | "deletion",
): Preparation<ProposalMap> {
  const matchesKind =
    kind === "insertion" ? $isReviewInsertionNode : $isReviewDeletionNode;
  if (!isValidProposalId(proposalId)) {
    return refusal(
      "invalid-proposal-id",
      "Expected a valid proposal identity.",
    );
  }
  const matches: ReviewElementNode[] = [];
  const visit = (node: LexicalNode): void => {
    if (isReviewElementNode(node) && node.getProposalId() === proposalId) {
      matches.push(node);
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  visit($getRoot());
  const first = matches[0];
  const last = matches.at(-1);
  if (!matchesKind(first) || !matchesKind(last)) {
    return refusal(
      "unsupported-target",
      `The pending ${kind} proposal was not found.`,
    );
  }
  const paragraph = first.getParent();
  if (
    !isRootParagraph(paragraph) ||
    matches.some((node) => node.getParent() !== paragraph || !matchesKind(node))
  ) {
    return refusal(
      "unsafe-proposal-intersection",
      `The identity does not identify one contiguous ${kind} proposal.`,
    );
  }
  const structure = validateParagraphStructure(paragraph);
  if (structure !== null) return structure;
  return buildProposalMap(paragraph, first, last);
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
  const continuation = $isReviewDeletionNode(adjacent) ? adjacent : null;
  const identity =
    continuation === null
      ? prepareProposalId(options)
      : { status: "ready" as const, value: continuation.getProposalId() };
  if (identity.status !== "ready") return identity;
  const selected = getAcceptedSelectedNodes(span);
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
