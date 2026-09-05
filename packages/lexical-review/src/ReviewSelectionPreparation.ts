import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type ParagraphNode,
  type PointType,
  type RangeSelection,
  type TextNode,
} from "lexical";
import {
  $canReviewElementNodesBeMerged,
  $isReviewDeletionNode,
  $isReviewInsertionNode,
  type ReviewElementNode,
} from "./ReviewNodes";
import {
  refusal,
  type Preparation,
  type ReviewIntentRefusal,
} from "./ReviewIntent";

const SUPPORTED_TEXT_FORMAT_MASK = 0b1111;

export type AcceptedPoint = Readonly<{
  association: "accepted";
  childIndex: number;
  node: TextNode | null;
  offset: number;
  paragraph: ParagraphNode;
}>;

export type ProposalPoint = Readonly<{
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

type ProposalMapEntry = Readonly<{
  end: number;
  node: TextNode;
  start: number;
  wrapper: ReviewElementNode;
}>;

export type ProposalMap = Readonly<{
  entries: readonly ProposalMapEntry[];
  paragraph: ParagraphNode;
  total: number;
  wrappers: readonly ReviewElementNode[];
  proposalId: string;
}>;

export type ProposalSpan = Readonly<{
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

export type AcceptedMap = Readonly<{
  entries: readonly AcceptedMapEntry[];
  paragraph: ParagraphNode;
  total: number;
}>;

export type AcceptedSpan = Readonly<{
  end: number;
  map: AcceptedMap;
  start: number;
}>;

export function isRootParagraph(
  node: LexicalNode | null,
): node is ParagraphNode {
  return $isParagraphNode(node) && node.getParent() === $getRoot();
}

export function isReviewElementNode(
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

export function getChildIndex(
  parent: ElementNode,
  node: LexicalNode,
): number | null {
  const index = parent
    .getChildren()
    .findIndex((child) => child.getKey() === node.getKey());
  return index === -1 ? null : index;
}

export function getTextChildren(wrapper: ReviewElementNode): TextNode[] | null {
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

export function validateParagraphStructure(
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

export function isTextBoundary(text: string, offset: number): boolean {
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

export function previousCharacterOffset(text: string, offset: number): number {
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

export function nextCharacterOffset(text: string, offset: number): number {
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

export function inspectSelection(): Preparation<SelectionInspection> {
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

export function buildProposalMap(
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

export function buildProposalMapAroundPoint(
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

export function getProposalOffset(
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

export function buildProposalSpan(
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

export function buildAcceptedMap(paragraph: ParagraphNode): AcceptedMap {
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
  return { entries, paragraph, total: offset };
}

export function getAcceptedOffset(
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

export function buildAcceptedSpan(
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
  const start = getAcceptedOffset(startPoint, map);
  const end = getAcceptedOffset(endPoint, map);
  if (start === null || end === null || end < start) {
    return refusal(
      "invalid-structural-target",
      "The accepted selection points cannot be resolved in the live tree.",
    );
  }
  return { status: "ready", value: { end, map, start } };
}

export function getStartEntry(
  entries: readonly AcceptedMapEntry[] | readonly ProposalMapEntry[],
  offset: number,
): AcceptedMapEntry | ProposalMapEntry | null {
  return (
    entries.find((entry) => entry.start <= offset && offset < entry.end) ?? null
  );
}

export function getEndEntry(
  entries: readonly AcceptedMapEntry[] | readonly ProposalMapEntry[],
  offset: number,
): AcceptedMapEntry | ProposalMapEntry | null {
  return (
    entries.find((entry) => entry.start < offset && offset <= entry.end) ?? null
  );
}
