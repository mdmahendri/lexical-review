import {
  $getReviewInputFormat,
  $setReviewInputFormat,
} from "./ReviewInputFormatting";
import {
  $getEditor,
  $getSelection,
  $isRangeSelection,
  type PointType,
  type RangeSelection,
  type TextNode,
} from "lexical";
import {
  prepareProposalId,
  type ReviewAuthoringOptions,
} from "./ReviewAuthoring";
import {
  changed,
  refusal,
  unchanged,
  type Preparation,
  type ReviewIntentOutcome,
} from "./ReviewIntent";
import {
  $createReviewFormattingNode,
  $isReviewDeletionNode,
  $isReviewFormattingNode,
  ReviewFormattingNode,
} from "./ReviewNodes";
import {
  buildAcceptedSpan,
  buildProposalSpan,
  getTextChildren,
  inspectProposalGroup,
  inspectSelection,
} from "./ReviewSelectionPreparation";
import {
  canonicalFormatRuns,
  sameFormatRuns,
  type ReviewFormatRun,
} from "./ReviewFormattingState";

const FORMAT_BITS = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
} as const;
export type ReviewFormattingProperty = keyof typeof FORMAT_BITS;
export type ReviewFormattingChange = Readonly<
  Partial<Record<ReviewFormattingProperty, boolean>>
>;
export type ReviewFormattingProposal = Readonly<{
  proposalId: string;
  accepted: readonly ReviewFormatRun[];
  current: readonly ReviewFormatRun[];
}>;

type Entry = Readonly<{ node: TextNode; start: number; end: number }>;

function runs(nodes: readonly TextNode[]): ReviewFormatRun[] {
  return canonicalFormatRuns(
    nodes.map((node) => ({
      text: node.getTextContent(),
      format: node.getFormat(),
    })),
  );
}

function entries(nodes: readonly TextNode[]): Entry[] {
  let start = 0;
  return nodes.map((node) => {
    const entry = { node, start, end: start + node.getTextContentSize() };
    start = entry.end;
    return entry;
  });
}

function isolate(
  source: readonly Entry[],
  start: number,
  end: number,
): TextNode[] {
  return source
    .filter((entry) => entry.start < end && entry.end > start)
    .map((entry) => {
      const localStart = Math.max(start - entry.start, 0);
      const localEnd = Math.min(end - entry.start, entry.end - entry.start);
      const parts = entry.node.splitText(localStart, localEnd);
      return parts[localStart === 0 ? 0 : 1]!;
    });
}

function selectRange(
  selection: RangeSelection,
  nodes: readonly TextNode[],
  backward: boolean,
): void {
  const first = nodes[0]!;
  const last = nodes.at(-1)!;
  selection.anchor.set(
    (backward ? last : first).getKey(),
    backward ? last.getTextContentSize() : 0,
    "text",
  );
  selection.focus.set(
    (backward ? first : last).getKey(),
    backward ? 0 : last.getTextContentSize(),
    "text",
  );
}

function findFormatting(proposalId: string): Preparation<ReviewFormattingNode> {
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  const node = group.value.wrappers[0];
  return $isReviewFormattingNode(node)
    ? { status: "ready", value: node }
    : refusal(
        "unsupported-target",
        "The identity does not identify a formatting proposal.",
      );
}

/** Read the current proposal-bearing node, without a detached proposal registry. */
export function $inspectReviewFormatting(
  proposalId: string,
): ReviewIntentOutcome<ReviewFormattingProposal> {
  const found = findFormatting(proposalId);
  if (found.status !== "ready") return found;
  return {
    status: "unchanged",
    value: {
      proposalId,
      accepted: found.value.getAcceptedFormats().map((run) => ({ ...run })),
      current: runs(getTextChildren(found.value)!),
    },
  };
}

/** Explicit property values allow combinations and no-op detection without toggling. */
export function $setReviewFormatting(
  change: ReviewFormattingChange,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  if (
    typeof change !== "object" ||
    change === null ||
    Array.isArray(change) ||
    Object.entries(change).some(
      ([property, value]) =>
        !Object.hasOwn(FORMAT_BITS, property) || typeof value !== "boolean",
    )
  )
    return refusal(
      "unsupported-formatting",
      "Only boolean bold, italic, underline, and strikethrough changes are supported.",
    );
  const inspection = inspectSelection();
  if (inspection.status !== "ready") return inspection;
  const { selection, collapsed, backward, anchor, focus } = inspection.value;
  const apply = (format: number): number => {
    for (const [property, enabled] of Object.entries(change)) {
      const bit = FORMAT_BITS[property as ReviewFormattingProperty];
      format = enabled ? format | bit : format & ~bit;
    }
    return format;
  };
  if (collapsed) {
    const current = $getReviewInputFormat(selection);
    const next = apply(current);
    if (next === current) return unchanged();
    $setReviewInputFormat(selection, next);
    return changed();
  }
  const proposalSide =
    anchor.association === "proposal" || focus.association === "proposal";
  const span = proposalSide
    ? buildProposalSpan(inspection.value)
    : buildAcceptedSpan(inspection.value);
  if (span.status !== "ready") return span;
  const { start, end, map } = span.value;
  const wrapper = anchor.association === "proposal" ? anchor.wrapper : null;
  if ($isReviewDeletionNode(wrapper))
    return refusal(
      "unsupported-proposal-edit",
      "Formatting cannot edit a pending deletion or the old side of a replacement.",
    );
  const target = map.entries.filter(
    (entry) => entry.start < end && entry.end > start,
  );
  if (
    !target.length ||
    target.every(
      (entry) => apply(entry.node.getFormat()) === entry.node.getFormat(),
    )
  )
    return unchanged();
  let identity: string | null = null;
  if (!proposalSide) {
    if (!$getEditor().hasNode(ReviewFormattingNode))
      return refusal(
        "invalid-structural-target",
        "Register ReviewFormattingNode before authoring formatting proposals.",
      );
    const prepared = prepareProposalId(options);
    if (prepared.status !== "ready") return prepared;
    identity = prepared.value;
  }
  const selected = isolate(map.entries, start, end);
  if (identity !== null) {
    const proposal = $createReviewFormattingNode(identity, runs(selected));
    selected[0]!.insertBefore(proposal);
    proposal.append(...selected);
  }
  for (const node of selected) node.setFormat(apply(node.getFormat()));
  selectRange(selection, selected, backward);
  selection.setFormat(
    selected.reduce((format, node) => format & node.getFormat(), 15),
  );
  if (
    $isReviewFormattingNode(wrapper) &&
    sameFormatRuns(
      wrapper.getAcceptedFormats(),
      runs(getTextChildren(wrapper)!),
    )
  ) {
    unwrapFormatting(wrapper, false);
  }
  return changed();
}

/** Toggle from the effective selected formatting, or the local future-input format. */
export function $toggleReviewFormatting(
  property: ReviewFormattingProperty,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  if (!Object.hasOwn(FORMAT_BITS, property))
    return refusal(
      "unsupported-formatting",
      "Unsupported formatting property.",
    );
  const inspection = inspectSelection();
  if (inspection.status !== "ready") return inspection;
  let format = inspection.value.collapsed
    ? $getReviewInputFormat(inspection.value.selection)
    : inspection.value.selection.format;
  if (!inspection.value.collapsed) {
    const { anchor, focus } = inspection.value;
    const span =
      anchor.association === "proposal" || focus.association === "proposal"
        ? buildProposalSpan(inspection.value)
        : buildAcceptedSpan(inspection.value);
    if (span.status !== "ready") return span;
    format = span.value.map.entries
      .filter(
        (entry) => entry.start < span.value.end && entry.end > span.value.start,
      )
      .reduce((value, entry) => value & entry.node.getFormat(), 15);
  }
  return $setReviewFormatting(
    { [property]: !(format & FORMAT_BITS[property]) },
    options,
  );
}

function unwrapFormatting(
  wrapper: ReviewFormattingNode,
  restoreAccepted: boolean,
): void {
  const parentKey = wrapper.getParentOrThrow().getKey();
  const wrapperIndex = wrapper.getIndexWithinParent();
  const source = entries(getTextChildren(wrapper)!);
  const selection = $getSelection();
  const snapshot = (point: PointType) => {
    const entry = source.find((entry) => entry.node.getKey() === point.key);
    const offset = entry
      ? entry.start + point.offset
      : point.key === wrapper.getKey()
        ? source
            .slice(0, point.offset)
            .reduce((sum, entry) => sum + entry.end - entry.start, 0)
        : null;
    return {
      key: point.key,
      offset: point.offset,
      type: point.type,
      local: offset,
    };
  };
  const anchor = $isRangeSelection(selection)
    ? snapshot(selection.anchor)
    : null;
  const focus = $isRangeSelection(selection) ? snapshot(selection.focus) : null;
  if (restoreAccepted) {
    let offset = 0;
    for (const run of wrapper.getAcceptedFormats()) {
      for (const node of isolate(
        entries(getTextChildren(wrapper)!),
        offset,
        offset + run.text.length,
      ))
        node.setFormat(run.format);
      offset += run.text.length;
    }
  }
  const children = getTextChildren(wrapper)!;
  for (const child of children) wrapper.insertBefore(child);
  wrapper.remove();
  const restore = (point: PointType, saved: NonNullable<typeof anchor>) => {
    if (saved.local === null) {
      const offset =
        saved.type === "element" &&
        saved.key === parentKey &&
        saved.offset > wrapperIndex
          ? saved.offset + children.length - 1
          : saved.offset;
      point.set(saved.key, offset, saved.type);
      return;
    }
    let offset = saved.local;
    for (const node of children) {
      if (offset <= node.getTextContentSize()) {
        point.set(node.getKey(), offset, "text");
        return;
      }
      offset -= node.getTextContentSize();
    }
  };
  if ($isRangeSelection(selection) && anchor && focus) {
    restore(selection.anchor, anchor);
    restore(selection.focus, focus);
  }
}

function resolve(proposalId: string, accept: boolean): ReviewIntentOutcome {
  const found = findFormatting(proposalId);
  if (found.status !== "ready") return found;
  unwrapFormatting(found.value, !accept);
  return changed();
}
export function $acceptReviewFormatting(
  proposalId: string,
): ReviewIntentOutcome {
  return resolve(proposalId, true);
}
export function $rejectReviewFormatting(
  proposalId: string,
): ReviewIntentOutcome {
  return resolve(proposalId, false);
}
export function $removeReviewFormatting(
  proposalId: string,
): ReviewIntentOutcome {
  return resolve(proposalId, false);
}
