/**
 * Target-owned offset maps: the entry stamping, offset math, and span
 * isolation mechanics shared by classification (ReviewTargeting) and commit
 * mechanics (ReviewTargetEdit).
 *
 * This module is a leaf: it imports only lexical, ReviewNodes, and
 * ReviewIntent, so both owners can import it without a cycle. Proposal-kind
 * validation stays with the owners and arrives as a preflight callback: the
 * classifier passes its group projection, commit passes its kind projection,
 * and both run the same underlying validation, so refusal ordering is
 * unchanged. Kind owners (ReviewText, ReviewPaste, ReviewFormatting) never
 * import this module; they cross the target-level seam only.
 */
import {
  $isTextNode,
  type LexicalNode,
  type ParagraphNode,
  type TextNode,
} from "lexical";
import {
  $canReviewElementNodesBeMerged,
  getChildIndex,
  getTextChildren,
  isReviewElementNode,
  type ReviewElementNode,
} from "./ReviewNodes";
import {
  refusal,
  type Preparation,
  type ReviewIntentRefusal,
} from "./ReviewIntent";

export type SpanEntry = Readonly<{
  node: TextNode;
  start: number;
  end: number;
}>;

export type ProposalMapEntry = SpanEntry &
  Readonly<{
    wrapper: ReviewElementNode;
  }>;

export type AcceptedMapEntry = SpanEntry &
  Readonly<{
    childIndex: number;
  }>;

export type ProposalMap = Readonly<{
  entries: readonly ProposalMapEntry[];
  paragraph: ParagraphNode;
  total: number;
  wrappers: readonly ReviewElementNode[];
  proposalId: string;
}>;

export type AcceptedMap = Readonly<{
  entries: readonly AcceptedMapEntry[];
  paragraph: ParagraphNode;
  total: number;
}>;

export function isSameProposalNode(
  node: LexicalNode | null | undefined,
  reference: ReviewElementNode,
): node is ReviewElementNode {
  return (
    isReviewElementNode(node) &&
    (node.getKey() === reference.getKey() ||
      $canReviewElementNodesBeMerged(reference, node))
  );
}

type OffsetUnit<Taken> = Readonly<{
  taken: Taken;
  start: number;
  end: number;
}>;

/**
 * One offset walk behind both associations. take admits each child (null
 * skips it); the loop stamps text offsets once for every admitted unit.
 */
function collectOffsetUnits<Taken extends { node: TextNode }>(
  children: readonly LexicalNode[],
  startIndex: number,
  endIndex: number,
  take: (
    child: LexicalNode | undefined,
    childIndex: number,
  ) => readonly Taken[] | null | ReviewIntentRefusal,
): Preparation<{ units: Array<OffsetUnit<Taken>>; total: number }> {
  const units: Array<OffsetUnit<Taken>> = [];
  let offset = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const taken = take(children[index], index);
    if (taken === null) {
      continue;
    }
    if ("status" in taken) {
      return taken;
    }
    for (const unit of taken) {
      const end = offset + unit.node.getTextContentSize();
      units.push({ taken: unit, start: offset, end });
      offset = end;
    }
  }
  return { status: "ready", value: { units, total: offset } };
}

/**
 * Proposal map over one wrapper run. The preflight carries the owner's
 * proposal validation so this leaf stays cycle-free. Its contract:
 * - invoked first, before ordering, containment, and text checks, so the
 *   owner's refusal ordering is unchanged;
 * - invoked with the start wrapper's proposal identity; the leaf chooses
 *   which identity is validated, the owner supplies only the check;
 * - invoked at most once per build, and never when there is nothing to
 *   validate (proposalMapOf refuses empty wrapper runs first);
 * - only the status matters: a ready value is discarded, a refusal is
 *   returned verbatim.
 * The preflight must be read-only: owners never carry maps, so every span
 * operation rebuilds and re-runs it.
 */
export function buildProposalMap(
  paragraph: ParagraphNode,
  startWrapper: ReviewElementNode,
  endWrapper: ReviewElementNode,
  preflight: (proposalId: string) => Preparation<unknown>,
): Preparation<ProposalMap> {
  const checked = preflight(startWrapper.getProposalId());
  if (checked.status !== "ready") return checked;
  const startIndex = getChildIndex(paragraph, startWrapper);
  const endIndex = getChildIndex(paragraph, endWrapper);
  if (startIndex === null || endIndex === null || startIndex > endIndex) {
    return refusal(
      "invalid-structural-target",
      "The proposal selection wrappers are not ordered in one paragraph.",
    );
  }
  const proposalId = startWrapper.getProposalId();
  const collected = collectOffsetUnits(
    paragraph.getChildren(),
    startIndex,
    endIndex,
    (child) => {
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
      return textChildren.map((node) => ({ node, wrapper: child }));
    },
  );
  if (collected.status !== "ready") {
    return collected;
  }
  const { units, total } = collected.value;
  if (units.length === 0) {
    return refusal(
      "invalid-structural-target",
      "A pending proposal must contain live text before it can be edited.",
    );
  }
  return {
    status: "ready",
    value: {
      entries: units.map(({ taken, start, end }) => ({
        end,
        node: taken.node,
        start,
        wrapper: taken.wrapper,
      })),
      paragraph,
      proposalId,
      total,
      wrappers: [...new Set(units.map((unit) => unit.taken.wrapper))],
    },
  };
}

export function buildAcceptedMap(paragraph: ParagraphNode): AcceptedMap {
  const children = paragraph.getChildren();
  const collected = collectOffsetUnits(
    children,
    0,
    children.length - 1,
    (child, childIndex) =>
      !$isTextNode(child) || child.getTextContentSize() === 0
        ? null
        : [{ node: child, childIndex }],
  );
  if (collected.status !== "ready") {
    throw new Error("Accepted admission cannot refuse.");
  }
  const { units, total } = collected.value;
  return {
    entries: units.map(({ taken, start, end }) => ({
      childIndex: taken.childIndex,
      end,
      node: taken.node,
      start,
    })),
    paragraph,
    total,
  };
}

export function getProposalOffset(
  point: Readonly<{
    wrapper: ReviewElementNode;
    node: TextNode | null;
    offset: number;
  }>,
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

export function getAcceptedOffset(
  point: Readonly<{
    childIndex: number;
    node: TextNode | null;
    offset: number;
  }>,
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

/**
 * Fresh proposal map for one target at use time. Owners never carry maps;
 * every span operation rebuilds from the target's paragraph and wrappers.
 * Empty wrapper runs refuse before the preflight runs.
 */
export function proposalMapOf(
  target: Readonly<{
    paragraph: ParagraphNode;
    wrappers: readonly ReviewElementNode[];
  }>,
  preflight: (proposalId: string) => Preparation<unknown>,
): Preparation<ProposalMap> {
  const first = target.wrappers[0];
  const last = target.wrappers.at(-1);
  if (first === undefined || last === undefined)
    return refusal(
      "invalid-structural-target",
      "The pending proposal has no live content.",
    );
  return buildProposalMap(target.paragraph, first, last, preflight);
}

/**
 * Half-open entry resolution, always used as a pair: start entries satisfy
 * start <= offset < end, end entries satisfy start < offset <= end.
 * Keep the asymmetry in sync.
 */
export function resolveStartEntry<Entry extends SpanEntry>(
  entries: readonly Entry[],
  offset: number,
): Entry | null {
  return (
    entries.find((entry) => entry.start <= offset && offset < entry.end) ?? null
  );
}

export function resolveEndEntry<Entry extends SpanEntry>(
  entries: readonly Entry[],
  offset: number,
): Entry | null {
  return (
    entries.find((entry) => entry.start < offset && offset <= entry.end) ?? null
  );
}

/** Stamp consecutive offsets over live text nodes. */
export function spanEntries(nodes: readonly TextNode[]): SpanEntry[] {
  let start = 0;
  return nodes.map((node) => {
    const entry = { node, start, end: start + node.getTextContentSize() };
    start = entry.end;
    return entry;
  });
}

export type SpanSlice = Readonly<{
  node: TextNode;
  localStart: number;
  localEnd: number;
}>;

/** Read-only overlap of a span over stamped entries; no splits, no mutation. */
export function overlappingSlices(
  entries: readonly SpanEntry[],
  start: number,
  end: number,
): SpanSlice[] {
  const slices: SpanSlice[] = [];
  for (const entry of entries) {
    if (entry.end <= start || entry.start >= end) {
      continue;
    }
    slices.push({
      node: entry.node,
      localStart: Math.max(start - entry.start, 0),
      localEnd: Math.min(end - entry.start, entry.end - entry.start),
    });
  }
  return slices;
}

/** Split span edges and return the span's live text nodes. */
export function isolateSpanNodes(
  entries: readonly SpanEntry[],
  start: number,
  end: number,
): TextNode[] {
  return entries
    .filter((entry) => entry.start < end && entry.end > start)
    .map((entry) => {
      const localStart = Math.max(start - entry.start, 0);
      const localEnd = Math.min(end - entry.start, entry.end - entry.start);
      const parts = entry.node.splitText(localStart, localEnd);
      return parts[localStart === 0 ? 0 : 1]!;
    });
}
