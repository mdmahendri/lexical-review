import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  BEFORE_INPUT_COMMAND,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  CUT_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  DROP_COMMAND,
  FORMAT_TEXT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  REMOVE_TEXT_COMMAND,
  SET_TEXT_FORMAT_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  type RangeSelection,
  type TextNode,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { isValidProposalId } from "./ProposalIdentity";
import {
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $isReviewDeletionNode,
  $isReviewInsertionNode,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./ReviewNodes";
import type { ReviewSession } from "./ReviewSession";

type ProposalKind = "deletion" | "insertion";
type ReviewWrapper = ReviewDeletionNode | ReviewInsertionNode;

const SUPPORTED_TEXT_FORMAT_MASK = 0b1111;

export type ReviewNodeRefusalCode =
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

export type ReviewNodeRefusal = Readonly<{
  code: ReviewNodeRefusalCode;
  message: string;
}>;

export type ReviewNodeOperationalError = Readonly<{
  cause: unknown;
  code: string;
  message: string;
}>;

export type ReviewNodeOutcome<T = void> =
  | Readonly<{ status: "changed"; value: T }>
  | Readonly<{ status: "unchanged"; value: T }>
  | Readonly<{ reason: ReviewNodeRefusal; status: "refused" }>
  | Readonly<{ error: ReviewNodeOperationalError; status: "failed" }>;

export type ReviewProposalIdFactory = () => string;

export type NodeBackedReviewSessionRegistrationOptions = Readonly<{
  onDeletionOutcome?: (outcome: ReviewNodeOutcome) => void;
  onInsertionOutcome?: (outcome: ReviewNodeOutcome) => void;
  onOutcome?: (outcome: ReviewNodeOutcome) => void;
  proposalIdFactory?: ReviewProposalIdFactory;
}>;

type AcceptedPoint = Readonly<{
  association: "accepted";
  childIndex: number;
  node: TextNode | null;
  offset: number;
  paragraph: ElementNode;
}>;

type ProposalPoint = Readonly<{
  association: "proposal";
  childIndex: number;
  kind: ProposalKind;
  node: TextNode | null;
  offset: number;
  paragraph: ElementNode;
  wrapper: ReviewWrapper;
}>;

type SelectionPoint = AcceptedPoint | ProposalPoint;

type SelectionFailure = Readonly<{
  reason: ReviewNodeRefusal;
  status: "refused";
}>;

type SelectionInspection = Readonly<{
  anchor: SelectionPoint;
  backward: boolean;
  collapsed: boolean;
  focus: SelectionPoint;
  selection: RangeSelection;
}>;

type Preparation<T> =
  Readonly<{ status: "ready"; value: T }> | SelectionFailure;

type ProposalMapEntry = Readonly<{
  end: number;
  node: TextNode;
  start: number;
  wrapper: ReviewWrapper;
}>;

type ProposalMap = Readonly<{
  entries: readonly ProposalMapEntry[];
  kind: ProposalKind;
  paragraph: ElementNode;
  total: number;
  wrappers: readonly ReviewWrapper[];
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
  paragraph: ElementNode;
  total: number;
}>;

type AcceptedSpan = Readonly<{
  end: number;
  map: AcceptedMap;
  start: number;
}>;

let generatedProposalCounter = 0;

function refusal(
  code: ReviewNodeRefusalCode,
  message: string,
): SelectionFailure {
  return { reason: { code, message }, status: "refused" };
}

function changed(): ReviewNodeOutcome {
  return { status: "changed", value: undefined };
}

function unchanged(): ReviewNodeOutcome {
  return { status: "unchanged", value: undefined };
}

function refused(reason: ReviewNodeRefusal): ReviewNodeOutcome {
  return { reason, status: "refused" };
}

function failed(cause: unknown, message: string): ReviewNodeOutcome {
  return {
    error: {
      cause,
      code: "node-backed-edit-failed",
      message,
    },
    status: "failed",
  };
}

function isParagraph(node: LexicalNode | null): node is ElementNode {
  return (
    node !== null &&
    $isElementNode(node) &&
    node.getType() === "paragraph" &&
    node.getParent() === $getRoot()
  );
}

function isReviewWrapper(
  node: LexicalNode | null | undefined,
): node is ReviewWrapper {
  return $isReviewDeletionNode(node) || $isReviewInsertionNode(node);
}

function getProposalKind(wrapper: ReviewWrapper): ProposalKind {
  return $isReviewDeletionNode(wrapper) ? "deletion" : "insertion";
}

function getChildIndex(parent: ElementNode, node: LexicalNode): number | null {
  const index = parent
    .getChildren()
    .findIndex((child) => child.getKey() === node.getKey());
  return index === -1 ? null : index;
}

function getTextChildren(wrapper: ReviewWrapper): TextNode[] | null {
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
  paragraph: ElementNode,
): ReviewNodeRefusal | null {
  for (const child of paragraph.getChildren()) {
    if ($isTextNode(child)) {
      if (hasUnsupportedTextFormatting(child)) {
        return {
          code: "unsupported-formatting",
          message:
            "Review editing supports bold, italic, strikethrough, and underline text without inline styles or token modes.",
        };
      }
      continue;
    }
    if (isReviewWrapper(child)) {
      const textChildren = getTextChildren(child);
      if (textChildren === null) {
        return {
          code: "invalid-structural-target",
          message:
            "Review editing supports only direct paragraph text and text-only proposal wrappers.",
        };
      }
      if (textChildren.some(hasUnsupportedTextFormatting)) {
        return {
          code: "unsupported-formatting",
          message:
            "Review editing supports bold, italic, strikethrough, and underline text without inline styles or token modes.",
        };
      }
      continue;
    }
    return {
      code: "invalid-structural-target",
      message:
        "Review editing supports only direct paragraph text and text-only proposal wrappers.",
    };
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
): ReviewNodeRefusal | null {
  return (selection.format & ~SUPPORTED_TEXT_FORMAT_MASK) !== 0 ||
    selection.style !== ""
    ? {
        code: "unsupported-formatting",
        message:
          "Review editing supports bold, italic, strikethrough, and underline text without inline styles.",
      }
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
    if (isParagraph(parentNode)) {
      const structure = validateParagraphStructure(parentNode);
      if (structure !== null) {
        return { reason: structure, status: "refused" };
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
    if (isReviewWrapper(parentNode) && isParagraph(parentNode.getParent())) {
      const parent = parentNode;
      const paragraph = parent.getParent();
      if (paragraph === null) {
        return refusal(
          "invalid-structural-target",
          "The selected proposal wrapper has no paragraph parent.",
        );
      }
      const structure = validateParagraphStructure(paragraph);
      if (structure !== null) {
        return { reason: structure, status: "refused" };
      }
      const childIndex = getChildIndex(paragraph, parent);
      if (childIndex === null || getTextChildren(parent) === null) {
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
          kind: getProposalKind(parent),
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
  if (isReviewWrapper(node) && isParagraph(node.getParent())) {
    const children = getTextChildren(node);
    if (children === null || point.offset > children.length) {
      return refusal(
        "invalid-structural-target",
        "The proposal element point does not identify a supported child boundary.",
      );
    }
    const paragraph = node.getParent();
    if (paragraph === null) {
      return refusal(
        "invalid-structural-target",
        "The selected proposal wrapper has no paragraph parent.",
      );
    }
    const structure = validateParagraphStructure(paragraph);
    if (structure !== null) {
      return { reason: structure, status: "refused" };
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
        kind: getProposalKind(node),
        node: null,
        offset: children
          .slice(0, point.offset)
          .reduce((total, child) => total + child.getTextContentSize(), 0),
        paragraph,
        wrapper: node,
      },
    };
  }
  if (isParagraph(node)) {
    const structure = validateParagraphStructure(node);
    if (structure !== null) {
      return { reason: structure, status: "refused" };
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
    if (isReviewWrapper(left ?? null) || isReviewWrapper(right ?? null)) {
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
    return { reason: formatting, status: "refused" };
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
    left.kind === right.kind &&
    left.wrapper.getProposalId() === right.wrapper.getProposalId()
  );
}

function buildProposalMap(
  paragraph: ElementNode,
  startWrapper: ReviewWrapper,
  endWrapper: ReviewWrapper,
): Preparation<ProposalMap> {
  const startIndex = getChildIndex(paragraph, startWrapper);
  const endIndex = getChildIndex(paragraph, endWrapper);
  if (startIndex === null || endIndex === null || startIndex > endIndex) {
    return refusal(
      "invalid-structural-target",
      "The proposal selection wrappers are not ordered in one paragraph.",
    );
  }
  const kind = getProposalKind(startWrapper);
  const proposalId = startWrapper.getProposalId();
  const wrappers: ReviewWrapper[] = [];
  const entries: ProposalMapEntry[] = [];
  let offset = 0;
  const children = paragraph.getChildren();
  for (let index = startIndex; index <= endIndex; index += 1) {
    const child = children[index];
    if (
      !isReviewWrapper(child) ||
      getProposalKind(child) !== kind ||
      child.getProposalId() !== proposalId
    ) {
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
      kind,
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
  const kind = point.kind;
  const proposalId = point.wrapper.getProposalId();
  const isSameWrapper = (
    child: LexicalNode | undefined,
  ): child is ReviewWrapper =>
    isReviewWrapper(child) &&
    getProposalKind(child) === kind &&
    child.getProposalId() === proposalId;

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
        return (
          offset +
          children
            .slice(0, point.offset)
            .reduce((total, child) => total + child.getTextContentSize(), 0)
        );
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

function buildAcceptedMap(paragraph: ElementNode): Preparation<AcceptedMap> {
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
  for (const child of map.paragraph.getChildren()) {
    const childIndex = getChildIndex(map.paragraph, child);
    if (childIndex === null || childIndex > point.childIndex) {
      break;
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

function placeCaretAfterWrapper(
  paragraph: ElementNode,
  wrapper: ReviewWrapper,
): void {
  const wrapperIndex = getChildIndex(paragraph, wrapper);
  if (wrapperIndex === null) {
    paragraph.select();
    return;
  }
  const next = paragraph.getChildAtIndex(wrapperIndex + 1);
  if ($isTextNode(next)) {
    next.selectStart();
    return;
  }
  const previous = paragraph.getChildAtIndex(wrapperIndex - 1);
  if ($isTextNode(previous)) {
    previous.selectEnd();
    return;
  }
  paragraph.select(wrapperIndex + 1, wrapperIndex + 1);
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
): ReviewNodeOutcome {
  if (span.start === span.end) {
    return unchanged();
  }
  const startEntry = getStartEntry(span.map.entries, span.start);
  const endEntry = getEndEntry(span.map.entries, span.end);
  if (startEntry === null || endEntry === null) {
    return refused({
      code: "invalid-structural-target",
      message:
        "The proposal replacement range cannot be resolved in the live tree.",
    });
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
      if (isReviewWrapper(child)) {
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

function defaultProposalIdFactory(): string {
  generatedProposalCounter += 1;
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === "function") {
    return `review-${cryptoObject.randomUUID()}`;
  }
  return `review-${Date.now().toString(36)}-${generatedProposalCounter.toString(36)}`;
}

function missingProposalNode(
  editor: LexicalEditor,
  kind: ProposalKind,
): ReviewNodeOutcome | null {
  const nodeClass =
    kind === "insertion" ? ReviewInsertionNode : ReviewDeletionNode;
  return editor.hasNode(nodeClass)
    ? null
    : refused({
        code: "invalid-structural-target",
        message: `The editor must register the review-${kind} node before authoring ${kind} proposals.`,
      });
}

function insertAcceptedProposal(
  point: AcceptedPoint,
  selection: RangeSelection,
  kind: ProposalKind,
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
): Readonly<{ end: number; map: AcceptedMap; start: number }> | null {
  const map = buildAcceptedMap(point.paragraph);
  if (map.status !== "ready") {
    return null;
  }
  const offset = getAcceptedOffset(point, map.value);
  if (offset === null) {
    return null;
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

function deleteProposalCharacter(
  point: ProposalPoint,
  backward: boolean,
): ReviewNodeOutcome {
  const map = buildProposalMapAroundPoint(point);
  if (map.status !== "ready") {
    return refused(map.reason);
  }
  const offset = getProposalOffset(point, map.value);
  if (offset === null) {
    return refused(
      refusal(
        "invalid-structural-target",
        "The proposal caret cannot be resolved in the live tree.",
      ).reason,
    );
  }
  const text = map.value.entries
    .map((entry) => entry.node.getTextContent())
    .join("");
  if (!isTextBoundary(text, offset)) {
    return refused(
      refusal(
        "invalid-structural-target",
        "The proposal caret is not on a supported Unicode text boundary.",
      ).reason,
    );
  }
  if (backward && offset === 0) {
    return refused(
      refusal(
        "deletion-target-unavailable",
        "Backward deletion may not cross from proposal content into accepted content.",
      ).reason,
    );
  }
  if (!backward && offset === map.value.total) {
    return refused(
      refusal(
        "deletion-target-unavailable",
        "Forward deletion may not cross from proposal content into accepted content.",
      ).reason,
    );
  }
  const start = backward ? previousCharacterOffset(text, offset) : offset;
  const end = backward ? offset : nextCharacterOffset(text, offset);
  const span: ProposalSpan = { end, map: map.value, start };
  const fallbackIndex = point.childIndex;
  removeProposalRange(span, start, end);
  placeProposalCaret(map.value, start, fallbackIndex);
  return changed();
}

function deleteProposalSelection(span: ProposalSpan): ReviewNodeOutcome {
  if (span.start === span.end) {
    return unchanged();
  }
  const fallbackIndex = getChildIndex(
    span.map.paragraph,
    span.map.wrappers[0]!,
  );
  removeProposalRange(span, span.start, span.end);
  placeProposalCaret(span.map, span.start, fallbackIndex ?? 0);
  return changed();
}

function prepareProposalId(
  options: NodeBackedReviewSessionRegistrationOptions,
): Preparation<string> {
  return getUniqueProposalId(
    options.proposalIdFactory ?? defaultProposalIdFactory,
  );
}

function performInsertion(
  editor: LexicalEditor,
  text: string,
  options: NodeBackedReviewSessionRegistrationOptions,
): ReviewNodeOutcome {
  if (text.length === 0) {
    return unchanged();
  }
  if (/\r|\n/u.test(text)) {
    return refused({
      code: "unsupported-input",
      message:
        "Text insertion supports inline text only; paragraph breaks are unsupported.",
    });
  }
  const inspection = inspectSelection();
  if (inspection.status !== "ready") {
    return refused(inspection.reason);
  }
  if (!inspection.value.collapsed) {
    if (
      inspection.value.anchor.association === "proposal" ||
      inspection.value.focus.association === "proposal"
    ) {
      const proposalSpan = buildProposalSpan(inspection.value);
      if (proposalSpan.status !== "ready") {
        return refused(proposalSpan.reason);
      }
      if (proposalSpan.value.map.kind !== "insertion") {
        return refused({
          code: "unsupported-proposal-edit",
          message:
            "Insertion replacement may edit pending insertion content, not deletion content.",
        });
      }
      return replaceProposalRange(proposalSpan.value, text);
    }
    return refused({
      code: "unsupported-target",
      message:
        "Text replacement ranges are not part of the node-backed insertion contract.",
    });
  }
  const point = inspection.value.anchor;
  if (point.association === "proposal") {
    if (point.kind !== "insertion") {
      return refused({
        code: "unsupported-proposal-edit",
        message:
          "Insertion typing may edit pending insertion content, not deletion content.",
      });
    }
    const map = buildProposalMapAroundPoint(point);
    if (map.status !== "ready") {
      return refused(map.reason);
    }
    const offset = getProposalOffset(point, map.value);
    if (offset === null) {
      return refused({
        code: "invalid-structural-target",
        message: "The proposal caret cannot be resolved in the live tree.",
      });
    }
    insertIntoProposal(point, text);
    placeProposalCaret(map.value, offset + text.length, point.childIndex);
    return changed();
  }
  const missingNode = missingProposalNode(editor, "insertion");
  if (missingNode !== null) {
    return missingNode;
  }
  const proposalId = prepareProposalId(options);
  if (proposalId.status !== "ready") {
    return refused(proposalId.reason);
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

function performDeletion(
  editor: LexicalEditor,
  backward: boolean,
  granularity: "character" | "word",
  options: NodeBackedReviewSessionRegistrationOptions,
): ReviewNodeOutcome {
  if (granularity !== "character") {
    return refused({
      code: "unsupported-target",
      message:
        "Node-backed review deletion currently supports character intentions only.",
    });
  }
  const inspection = inspectSelection();
  if (inspection.status !== "ready") {
    return refused(inspection.reason);
  }
  if (!inspection.value.collapsed) {
    if (
      inspection.value.anchor.association === "proposal" &&
      inspection.value.focus.association === "proposal"
    ) {
      const proposalSpan = buildProposalSpan(inspection.value);
      if (proposalSpan.status !== "ready") {
        return refused(proposalSpan.reason);
      }
      return deleteProposalSelection(proposalSpan.value);
    }
    const acceptedSpan = buildAcceptedSpan(inspection.value);
    if (acceptedSpan.status !== "ready") {
      return refused(acceptedSpan.reason);
    }
    if (acceptedSpan.value.start === acceptedSpan.value.end) {
      return unchanged();
    }
    const missingNode = missingProposalNode(editor, "deletion");
    if (missingNode !== null) {
      return missingNode;
    }
    const proposalId = prepareProposalId(options);
    if (proposalId.status !== "ready") {
      return refused(proposalId.reason);
    }
    const selected = getAcceptedSelectedNodes(acceptedSpan.value);
    if (selected === null || selected.length === 0) {
      return refused({
        code: "invalid-structural-target",
        message:
          "The accepted range could not be isolated without changing its content.",
      });
    }
    const wrapper = $createReviewDeletionNode(proposalId.value);
    selected[0]!.insertBefore(wrapper);
    for (const node of selected) {
      wrapper.append(node);
    }
    placeCaretAfterWrapper(acceptedSpan.value.map.paragraph, wrapper);
    return changed();
  }

  const point = inspection.value.anchor;
  if (point.association === "proposal") {
    return deleteProposalCharacter(point, backward);
  }
  const target = acceptedDeletionTarget(point, backward);
  if (target === null || target.start === target.end) {
    return refused({
      code: "deletion-target-unavailable",
      message:
        "Deletion may not cross proposal content or an empty accepted boundary.",
    });
  }
  const missingNode = missingProposalNode(editor, "deletion");
  if (missingNode !== null) {
    return missingNode;
  }
  const proposalId = prepareProposalId(options);
  if (proposalId.status !== "ready") {
    return refused(proposalId.reason);
  }
  const selected = getAcceptedSelectedNodes({
    end: target.end,
    map: target.map,
    start: target.start,
  });
  if (selected === null || selected.length === 0) {
    return refused({
      code: "invalid-structural-target",
      message: "The accepted deletion target could not be isolated safely.",
    });
  }
  const wrapper = $createReviewDeletionNode(proposalId.value);
  selected[0]!.insertBefore(wrapper);
  for (const node of selected) {
    wrapper.append(node);
  }
  placeCaretAfterWrapper(target.map.paragraph, wrapper);
  return changed();
}

function unsupportedOutcome(
  code: ReviewNodeRefusalCode,
  message: string,
): ReviewNodeOutcome {
  return refused({ code, message });
}

function reportOutcome(
  options: NodeBackedReviewSessionRegistrationOptions,
  outcome: ReviewNodeOutcome,
  kind: "deletion" | "insertion" | null,
): void {
  options.onOutcome?.(outcome);
  if (kind === "deletion") {
    options.onDeletionOutcome?.(outcome);
  } else if (kind === "insertion") {
    options.onInsertionOutcome?.(outcome);
  }
}

function safePerform(operation: () => ReviewNodeOutcome): ReviewNodeOutcome {
  try {
    return operation();
  } catch (cause) {
    return failed(
      cause,
      "The node-backed review operation could not be applied.",
    );
  }
}

export function registerNodeBackedReviewSession(
  editor: LexicalEditor,
  session: ReviewSession,
  options: NodeBackedReviewSessionRegistrationOptions = {},
): () => void {
  void session;
  const handleDeletion = (
    backward: boolean,
    granularity: "character" | "word",
    event?: Event | null,
  ): boolean => {
    event?.preventDefault();
    const outcome = safePerform(() =>
      performDeletion(editor, backward, granularity, options),
    );
    reportOutcome(options, outcome, "deletion");
    return true;
  };
  const handleBeforeInput = (event: InputEvent): boolean => {
    if (event.inputType === "deleteContentBackward") {
      return handleDeletion(true, "character", event);
    }
    if (event.inputType === "deleteContentForward") {
      return handleDeletion(false, "character", event);
    }
    return false;
  };
  const refuseFormatting = (): boolean => {
    reportOutcome(
      options,
      unsupportedOutcome(
        "unsupported-formatting",
        "Formatting authoring is not supported by the node-backed review session yet.",
      ),
      null,
    );
    return true;
  };
  const refuseStructure = (): boolean => {
    reportOutcome(
      options,
      unsupportedOutcome(
        "unsupported-structure",
        "Paragraph structure authoring is not supported by the node-backed review session yet.",
      ),
      null,
    );
    return true;
  };
  const refuseTransfer = (event?: Event | null): boolean => {
    event?.preventDefault();
    reportOutcome(
      options,
      unsupportedOutcome(
        "unsupported-transfer",
        "Content transfer is not supported by the node-backed review session yet.",
      ),
      null,
    );
    return true;
  };

  return mergeRegister(
    editor.registerCommand(
      BEFORE_INPUT_COMMAND,
      handleBeforeInput,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      CONTROLLED_TEXT_INSERTION_COMMAND,
      (eventOrText) => {
        const text =
          typeof eventOrText === "string" ? eventOrText : eventOrText.data;
        if (text == null) {
          return false;
        }
        const outcome = safePerform(() =>
          performInsertion(editor, text, options),
        );
        reportOutcome(options, outcome, "insertion");
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (backward) => handleDeletion(backward, "character"),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_WORD_COMMAND,
      (backward) => handleDeletion(backward, "word"),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      REMOVE_TEXT_COMMAND,
      (event) => handleDeletion(false, "character", event),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => handleDeletion(true, "character", event),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => handleDeletion(false, "character", event),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_LINE_COMMAND,
      () => handleDeletion(true, "word"),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      refuseFormatting,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      SET_TEXT_FORMAT_COMMAND,
      refuseFormatting,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      refuseStructure,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      INSERT_LINE_BREAK_COMMAND,
      refuseStructure,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        event?.preventDefault();
        return refuseStructure();
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      PASTE_COMMAND,
      refuseTransfer,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(DROP_COMMAND, refuseTransfer, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(CUT_COMMAND, refuseTransfer, COMMAND_PRIORITY_HIGH),
  );
}
