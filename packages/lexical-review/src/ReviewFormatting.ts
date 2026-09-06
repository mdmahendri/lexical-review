import {
  $claimFragmentFormatting,
  $getFragmentSelectionFormat,
} from "./ReviewFragment";
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
  getTextChildren,
  ReviewFormattingNode,
} from "./ReviewNodes";
import {
  getTargetSpanNodes,
  inspectProposalGroup,
  inspectReviewTarget,
  isolateTargetSpanNodes,
} from "./ReviewTargeting";
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

export function inspectFormattingProposal(
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
  const apply = (format: number): number => {
    let next = format;
    for (const [property, enabled] of Object.entries(change)) {
      const bit = FORMAT_BITS[property as ReviewFormattingProperty];
      next = enabled ? next | bit : next & ~bit;
    }
    return next;
  };
  const fragment = $claimFragmentFormatting(apply);
  if (fragment) return fragment;
  const inspection = inspectReviewTarget();
  if (inspection.status !== "ready") return inspection;
  const target = inspection.value;
  const selection = target.selection;
  if (target.kind === "accepted-caret" || target.kind === "proposal-caret") {
    const current = $getReviewInputFormat(selection);
    const next = apply(current);
    if (next === current) return unchanged();
    $setReviewInputFormat(selection, next);
    return changed();
  }
  const backward = target.backward;
  const anchorWrapper =
    target.kind === "proposal-range" ? target.anchorWrapper : null;
  if ($isReviewDeletionNode(anchorWrapper))
    return refusal(
      "unsupported-proposal-edit",
      "Formatting cannot edit a pending deletion or the old side of a replacement.",
    );
  const spanned = getTargetSpanNodes(target);
  if (
    !spanned.length ||
    spanned.every((node) => apply(node.getFormat()) === node.getFormat())
  )
    return unchanged();
  let identity: string | null = null;
  if (target.kind === "accepted-range") {
    if (!$getEditor().hasNode(ReviewFormattingNode))
      return refusal(
        "invalid-structural-target",
        "Register ReviewFormattingNode before authoring formatting proposals.",
      );
    const prepared = prepareProposalId(options);
    if (prepared.status !== "ready") return prepared;
    identity = prepared.value;
  }
  const selected = isolateTargetSpanNodes(target);
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
    $isReviewFormattingNode(anchorWrapper) &&
    sameFormatRuns(
      anchorWrapper.getAcceptedFormats(),
      runs(getTextChildren(anchorWrapper)!),
    )
  ) {
    unwrapFormatting(anchorWrapper, false);
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
  const rawSelection = $getSelection();
  const fragmentFormat = $getFragmentSelectionFormat();
  if (fragmentFormat !== null && $isRangeSelection(rawSelection)) {
    const base = rawSelection.isCollapsed()
      ? $getReviewInputFormat(rawSelection)
      : fragmentFormat;
    return $setReviewFormatting(
      { [property]: !(base & FORMAT_BITS[property]) },
      options,
    );
  }
  const inspection = inspectReviewTarget();
  if (inspection.status !== "ready") return inspection;
  const target = inspection.value;
  let format =
    target.kind === "accepted-caret" || target.kind === "proposal-caret"
      ? $getReviewInputFormat(target.selection)
      : target.selection.format;
  if (target.kind === "accepted-range" || target.kind === "proposal-range") {
    format = getTargetSpanNodes(target).reduce(
      (value, node) => value & node.getFormat(),
      15,
    );
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
    let offset: number | null;
    if (entry) {
      offset = entry.start + point.offset;
    } else if (point.key === wrapper.getKey()) {
      offset = source
        .slice(0, point.offset)
        .reduce((sum, entry) => sum + entry.end - entry.start, 0);
    } else {
      offset = null;
    }
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

export function resolveFormatting(
  proposalId: string,
  accept: boolean,
): ReviewIntentOutcome {
  const found = findFormatting(proposalId);
  if (found.status !== "ready") return found;
  unwrapFormatting(found.value, !accept);
  return changed();
}
