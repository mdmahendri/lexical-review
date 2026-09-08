/**
 * Target-owned edit mechanics: intent-level plans plus a single commit seam.
 *
 * Kind owners (ReviewText, ReviewPaste) classify once via
 * inspectReviewTarget(), build a declarative plan from scalar inputs, and
 * make exactly one $commitTargetEdit() call. Maps, spans, entries, offsets,
 * caret placement, and internal remapping never cross the seam.
 *
 * Ownership:
 * - Kind owners decide granularity, runs, identity policy (fresh / continue /
 *   reuse-continuation), the identity factory, and all purely-decidable
 *   supported-edit policy (expressed as builder refusals).
 * - Commit owns measurement-bound selection (full-erase and adjacency
 *   resolution) against the spec-pinned mapping, plus all offset math,
 *   mutation, and caret restore. Resolution execution stays kind-owned: the
 *   commit only ever *requests* resolution via the effect type.
 *
 * Targets are single-use within one editor update. Re-classification
 * continues the same intent; it never creates a new one.
 *
 * Refusal contract: every returned refusal exits before the first mutating
 * call (splitText, spliceText, append, insertBefore/After, remove, select).
 * Thrown errors are bugs (failed outcomes) and carry no guarantee.
 */
import {
  $createTextNode,
  $getEditor,
  $isTextNode,
  type TextNode,
} from "lexical";
import {
  prepareProposalId,
  type ReviewAuthoringOptions,
} from "./ReviewAuthoring";
import {
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $isReviewDeletionNode,
  $isReviewFormattingNode,
  $isReviewInsertionNode,
  getChildIndex,
  getTextChildren,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./ReviewNodes";
import {
  refusal,
  type Preparation,
  type ReviewIntentRefusal,
} from "./ReviewIntent";
import {
  acceptedDeletionTarget,
  findAcceptedDeletionContinuation,
  inspectProposalKind,
  isolateAcceptedTextRange,
  placeProposalCaret,
  prepareProposalCaretDeletion,
  prepareProposalRangeDeletion,
  replaceProposalRange,
  spliceProposalRange,
  type AcceptedCaretTarget,
  type AcceptedRangeTarget,
  type ProposalCaretTarget,
  type ReviewTarget,
} from "./ReviewTargeting";
import { readAcceptedRangeText } from "./ReviewTargeting";

export type ReviewEditRun = Readonly<{ text: string; format: number }>;

/**
 * Selected-side classification. Infallible node-type reads only — no
 * proposal-group walk, so builders never reorder group-dependent refusals.
 * Null for accepted targets, which have no wrapper side.
 */
export type SelectedWrapperSide =
  "insertion" | "deletion" | "formatting" | "other";

export function selectedWrapperSide(
  target: ReviewTarget,
): SelectedWrapperSide | null {
  const wrapper =
    target.kind === "proposal-caret"
      ? target.wrapper
      : target.kind === "proposal-range"
        ? (target.wrappers[0] ?? null)
        : null;
  if (wrapper === null) return null;
  if ($isReviewFormattingNode(wrapper)) return "formatting";
  if ($isReviewDeletionNode(wrapper)) return "deletion";
  if ($isReviewInsertionNode(wrapper)) return "insertion";
  return "other";
}

export type ReviewEditRegistration = Readonly<{
  kinds: readonly ("insertion" | "deletion")[];
  /** Verbatim message verb: "authoring" (text) or "pasting" (clipboard). */
  action: "authoring" | "pasting";
}>;

export type ReviewTargetEditPlan =
  | Readonly<{
      kind: "delete-proposal-caret";
      backward: boolean;
      granularity: "character" | "word";
    }>
  | Readonly<{ kind: "delete-proposal-range" }>
  | Readonly<{
      kind: "delete-accepted-caret";
      backward: boolean;
      granularity: "character" | "word";
      identityOptions: ReviewAuthoringOptions;
      registration: ReviewEditRegistration;
    }>
  | Readonly<{
      kind: "delete-accepted-range";
      backward: boolean;
      identityOptions: ReviewAuthoringOptions;
      registration: ReviewEditRegistration;
    }>
  | Readonly<{
      kind: "insert-runs-at-caret";
      runs: readonly ReviewEditRun[];
      identityOptions: ReviewAuthoringOptions;
      registration: ReviewEditRegistration;
      /** "continue-adjacent" (text typing) or "fresh" (paste). */
      continuation: "continue-adjacent" | "fresh";
    }>
  | Readonly<{
      kind: "replace-range-with-runs";
      runs: readonly ReviewEditRun[];
      identityOptions: ReviewAuthoringOptions;
      registration: ReviewEditRegistration;
      /** Paste additionally requires the single run to carry the selection format. */
      matchRunFormat: boolean;
      /**
       * Text replacement inherits the live selection format for new content
       * (prior behavior); paste keeps per-run formats. Varies by kind owner.
       */
      useSelectionFormat: boolean;
    }>
  | Readonly<{
      kind: "correct-proposal-caret-with-runs";
      runs: readonly ReviewEditRun[];
    }>
  | Readonly<{
      kind: "correct-proposal-range-with-runs";
      runs: readonly ReviewEditRun[];
    }>;

/** Plans whose commit can request (never perform) proposal resolution. */
export type ResolvingEditPlan = Extract<
  ReviewTargetEditPlan,
  { kind: `delete-${string}` }
>;

/** Plans whose commit only ever mutates, reports no-op, or refuses. */
export type NonResolvingEditPlan = Exclude<
  ReviewTargetEditPlan,
  ResolvingEditPlan
>;

export type TargetEditEffect =
  | Readonly<{ kind: "mutated" }>
  | Readonly<{
      kind: "resolution-required";
      action: "accept-deletion" | "reject-replacement";
      proposalId: string;
    }>
  | Readonly<{ kind: "no-op" }>;

export type NonResolvingEditEffect = Exclude<
  TargetEditEffect,
  { kind: "resolution-required" }
>;

function kindMismatch(): ReviewIntentRefusal {
  return refusal(
    "unsupported-target",
    "The planned edit does not apply to the classified target.",
  );
}

function checkRegistration(
  registration: ReviewEditRegistration,
): ReviewIntentRefusal | null {
  for (const kind of registration.kinds) {
    const nodeClass =
      kind === "insertion" ? ReviewInsertionNode : ReviewDeletionNode;
    if (!$getEditor().hasNode(nodeClass)) {
      return refusal(
        "invalid-structural-target",
        `The editor must register the review-${kind} node before ${registration.action} ${kind} proposals.`,
      );
    }
  }
  return null;
}

function mutated(): Preparation<TargetEditEffect> {
  return { status: "ready", value: { kind: "mutated" } };
}

function noOp(): Preparation<TargetEditEffect> {
  return { status: "ready", value: { kind: "no-op" } };
}

/** Text deletion plan. Pure: no editor reads, no editor writes. */
export function buildTextDeletionPlan(
  targetKind: ReviewTarget["kind"],
  side: SelectedWrapperSide | null,
  backward: boolean,
  granularity: "character" | "word",
  options: ReviewAuthoringOptions,
): Preparation<ResolvingEditPlan> {
  if (
    (targetKind === "proposal-caret" || targetKind === "proposal-range") &&
    side === "formatting"
  ) {
    // First check of prepareProposal{Caret,Range}Deletion, preserved verbatim.
    return refusal(
      "unsupported-proposal-edit",
      "Text deletion cannot alter a pending formatting target.",
    );
  }
  if (targetKind === "proposal-caret") {
    return {
      status: "ready",
      value: { kind: "delete-proposal-caret", backward, granularity },
    };
  }
  if (targetKind === "proposal-range") {
    return { status: "ready", value: { kind: "delete-proposal-range" } };
  }
  if (targetKind === "accepted-caret") {
    return {
      status: "ready",
      value: {
        kind: "delete-accepted-caret",
        backward,
        granularity,
        identityOptions: options,
        registration: { kinds: ["deletion"], action: "authoring" },
      },
    };
  }
  return {
    status: "ready",
    value: {
      kind: "delete-accepted-range",
      backward,
      identityOptions: options,
      registration: { kinds: ["deletion"], action: "authoring" },
    },
  };
}

/** Text insertion plan. Pure: no editor reads, no editor writes. */
export function buildTextInsertionPlan(
  targetKind: ReviewTarget["kind"],
  side: SelectedWrapperSide | null,
  text: string,
  format: number,
  options: ReviewAuthoringOptions,
): Preparation<NonResolvingEditPlan> {
  if (targetKind === "proposal-range") {
    if (side !== "insertion") {
      return refusal(
        "unsupported-proposal-edit",
        "Insertion replacement may edit pending insertion content, not deletion content.",
      );
    }
    return {
      status: "ready",
      value: {
        kind: "correct-proposal-range-with-runs",
        runs: [{ text, format }],
      },
    };
  }
  if (targetKind === "accepted-range") {
    return {
      status: "ready",
      value: {
        kind: "replace-range-with-runs",
        runs: [{ text, format }],
        identityOptions: options,
        registration: { kinds: ["insertion", "deletion"], action: "authoring" },
        matchRunFormat: false,
        useSelectionFormat: true,
      },
    };
  }
  if (targetKind === "proposal-caret") {
    if (side !== "insertion") {
      return refusal(
        "unsupported-proposal-edit",
        "Insertion typing may edit pending insertion content, not deletion content.",
      );
    }
    return {
      status: "ready",
      value: {
        kind: "correct-proposal-caret-with-runs",
        runs: [{ text, format }],
      },
    };
  }
  return {
    status: "ready",
    value: {
      kind: "insert-runs-at-caret",
      runs: [{ text, format }],
      identityOptions: options,
      registration: { kinds: ["insertion"], action: "authoring" },
      continuation: "continue-adjacent",
    },
  };
}

/** Paste plan. Pure: no editor reads, no editor writes. */
export function buildPastePlan(
  targetKind: ReviewTarget["kind"],
  side: SelectedWrapperSide | null,
  runs: readonly ReviewEditRun[],
  options: ReviewAuthoringOptions,
): Preparation<NonResolvingEditPlan> {
  if (targetKind === "proposal-caret") {
    if (side !== "insertion") {
      return refusal(
        "unsupported-proposal-edit",
        "Pasted content may correct pending insertion content, not deletion content. Resolve first.",
      );
    }
    return {
      status: "ready",
      value: { kind: "correct-proposal-caret-with-runs", runs },
    };
  }
  if (targetKind === "proposal-range") {
    if (side !== "insertion") {
      return refusal(
        "unsupported-proposal-edit",
        "Pasted content may correct pending insertion content, not deletion content. Resolve first.",
      );
    }
    if (runs.length > 1) {
      return refusal(
        "unsupported-proposal-edit",
        "Formatted paste over an insertion range is unsupported; resolve the proposal first, then paste at a caret.",
      );
    }
    return {
      status: "ready",
      value: { kind: "correct-proposal-range-with-runs", runs },
    };
  }
  if (targetKind === "accepted-caret") {
    return {
      status: "ready",
      value: {
        kind: "insert-runs-at-caret",
        runs,
        identityOptions: options,
        registration: { kinds: ["insertion"], action: "pasting" },
        continuation: "fresh",
      },
    };
  }
  return {
    status: "ready",
    value: {
      kind: "replace-range-with-runs",
      runs,
      identityOptions: options,
      registration: { kinds: ["insertion", "deletion"], action: "pasting" },
      matchRunFormat: true,
      useSelectionFormat: false,
    },
  };
}

/**
 * Non-mutating deletion classification behind the seam. Each arm delegates
 * to the same verify helper the matching commit branch re-runs, so the
 * read-only refusal rules live once: the classifier states them, the commit
 * revalidates them within its own update, and the cut preflight reaches them
 * through the classifier. Never mints proposal identity and never resolves:
 * resolution stays kind-owned behind TargetEditEffect.
 */
export function $classifyReviewDeletion(
  target: ReviewTarget,
  backward: boolean,
  granularity: "character" | "word",
  options: ReviewAuthoringOptions,
): Preparation<ResolvingEditPlan> {
  const plan = buildTextDeletionPlan(
    target.kind,
    selectedWrapperSide(target),
    backward,
    granularity,
    options,
  );
  if (plan.status !== "ready") return plan;
  switch (plan.value.kind) {
    case "delete-proposal-caret": {
      if (target.kind !== "proposal-caret") return kindMismatch();
      const prepared = prepareProposalCaretDeletion(
        target,
        backward,
        granularity,
      );
      if (prepared.status !== "ready") return prepared;
      return plan;
    }
    case "delete-proposal-range": {
      if (target.kind !== "proposal-range") return kindMismatch();
      const prepared = prepareProposalRangeDeletion(target);
      if (prepared.status !== "ready") return prepared;
      return plan;
    }
    case "delete-accepted-caret": {
      if (target.kind !== "accepted-caret") return kindMismatch();
      const verified = verifyAcceptedCaretDeletion(
        target,
        backward,
        granularity,
      );
      if (verified.status !== "ready") return verified;
      // The commit resolves through the kind owner here; classification
      // stays ready so the resolution path is preserved verbatim.
      if (verified.value.action === "reject-replacement") return plan;
      const span = verifyDeleteAcceptedSpan(
        verified.value.range,
        backward,
        plan.value.registration,
      );
      if (span.status !== "ready") return span;
      return plan;
    }
    case "delete-accepted-range": {
      if (target.kind !== "accepted-range") return kindMismatch();
      const span = verifyDeleteAcceptedSpan(
        target,
        backward,
        plan.value.registration,
      );
      if (span.status !== "ready") return span;
      return plan;
    }
  }
}

function commitDeleteProposalCaret(
  target: ReviewTarget,
  backward: boolean,
  granularity: "character" | "word",
): Preparation<TargetEditEffect> {
  if (target.kind !== "proposal-caret") return kindMismatch();
  const prepared = prepareProposalCaretDeletion(target, backward, granularity);
  if (prepared.status !== "ready") return prepared;
  if (prepared.value.action === "resolve-deletion") {
    return {
      status: "ready",
      value: {
        kind: "resolution-required",
        action: "accept-deletion",
        proposalId: target.proposalId,
      },
    };
  }
  if (prepared.value.action === "resolve-replacement") {
    return {
      status: "ready",
      value: {
        kind: "resolution-required",
        action: "reject-replacement",
        proposalId: target.proposalId,
      },
    };
  }
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
  return mutated();
}

function commitDeleteProposalRange(
  target: ReviewTarget,
): Preparation<TargetEditEffect> {
  if (target.kind !== "proposal-range") return kindMismatch();
  const prepared = prepareProposalRangeDeletion(target);
  if (prepared.status !== "ready") return prepared;
  if (prepared.value.action === "resolve-deletion") {
    return {
      status: "ready",
      value: {
        kind: "resolution-required",
        action: "accept-deletion",
        proposalId: target.proposalId,
      },
    };
  }
  if (prepared.value.action === "resolve-replacement") {
    return {
      status: "ready",
      value: {
        kind: "resolution-required",
        action: "reject-replacement",
        proposalId: target.proposalId,
      },
    };
  }
  if (prepared.value.action === "unchanged") {
    return noOp();
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
  return mutated();
}

/**
 * Read-only accepted-span verification shared by the classifier and the
 * commit: registration first, then deletion continuation. One encoding of
 * the span refusal prefix; the commit re-runs it as revalidation within its
 * own update, and the cut preflight reaches it through the classifier.
 */
function verifyDeleteAcceptedSpan(
  target: AcceptedRangeTarget,
  backward: boolean,
  registration: ReviewEditRegistration,
): Preparation<{
  node: ReviewDeletionNode | null;
  proposalId: string | null;
}> {
  const missing = checkRegistration(registration);
  if (missing !== null) return missing;
  const continuation = findAcceptedDeletionContinuation(target, backward);
  if (continuation.status !== "ready") return continuation;
  return continuation;
}

type AcceptedCaretDeletion =
  | Readonly<{ action: "delete-span"; range: AcceptedRangeTarget }>
  | Readonly<{ action: "reject-replacement"; proposalId: string }>;

/**
 * Read-only accepted-caret verification shared by the classifier and the
 * commit: adjacent-replacement resolution first, then deletion-target math.
 * Returns the span to delete or the kind-owned resolution the commit
 * performs; this verification never resolves itself.
 */
function verifyAcceptedCaretDeletion(
  target: AcceptedCaretTarget,
  backward: boolean,
  granularity: "character" | "word",
): Preparation<AcceptedCaretDeletion> {
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
        return {
          status: "ready",
          value: {
            action: "reject-replacement",
            proposalId: adjacent.getProposalId(),
          },
        };
    }
  }
  const range = acceptedDeletionTarget(target, backward, granularity);
  if (range === null || range.start === range.end) {
    return refusal(
      "deletion-target-unavailable",
      "Deletion may not cross proposal content or an empty accepted boundary.",
    );
  }
  return { status: "ready", value: { action: "delete-span", range } };
}

function commitDeleteAcceptedSpan(
  target: AcceptedRangeTarget,
  backward: boolean,
  identityOptions: ReviewAuthoringOptions,
  registration: ReviewEditRegistration,
): Preparation<TargetEditEffect> {
  const verified = verifyDeleteAcceptedSpan(target, backward, registration);
  if (verified.status !== "ready") return verified;
  const continued = verified.value.node;
  const continuedId = verified.value.proposalId;
  const minted =
    continued === null || continuedId === null
      ? prepareProposalId(identityOptions)
      : { status: "ready" as const, value: continuedId };
  if (minted.status !== "ready") return minted;
  const selected = isolateAcceptedTextRange(target);
  if (selected === null || selected.length === 0)
    throw new Error("Validated deletion target could not be isolated.");
  const wrapper = continued ?? $createReviewDeletionNode(minted.value);
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
  return mutated();
}

function commitDeleteAcceptedCaret(
  target: ReviewTarget,
  backward: boolean,
  granularity: "character" | "word",
  identityOptions: ReviewAuthoringOptions,
  registration: ReviewEditRegistration,
): Preparation<TargetEditEffect> {
  if (target.kind !== "accepted-caret") return kindMismatch();
  const verified = verifyAcceptedCaretDeletion(target, backward, granularity);
  if (verified.status !== "ready") return verified;
  if (verified.value.action === "reject-replacement") {
    return {
      status: "ready",
      value: {
        kind: "resolution-required",
        action: "reject-replacement",
        proposalId: verified.value.proposalId,
      },
    };
  }
  return commitDeleteAcceptedSpan(
    verified.value.range,
    backward,
    identityOptions,
    registration,
  );
}

/**
 * Adjacent-insertion continuation for text typing. Returns null when no
 * continuation applies and the caller falls through to fresh insertion.
 * The inspectProposalKind refusal propagates before any mutation.
 */
function tryContinueAdjacentInsertion(
  target: AcceptedCaretTarget,
  run: ReviewEditRun,
): Preparation<TargetEditEffect> | null {
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
      if ($isTextNode(boundary) && boundary.getFormat() === run.format) {
        const offset = atStart ? boundary.getTextContentSize() : 0;
        boundary.spliceText(offset, 0, run.text, true);
        boundary.select(offset + run.text.length, offset + run.text.length);
        return mutated();
      }
    }
  }
  return null;
}

function insertRunsAtAcceptedPoint(
  target: AcceptedCaretTarget,
  proposalId: string,
  runs: readonly ReviewEditRun[],
  pasting: boolean,
): void {
  const wrapper = $createReviewInsertionNode(proposalId);
  const nodes = runs.map((run) =>
    $createTextNode(run.text).setFormat(run.format),
  );
  wrapper.append(...nodes);
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
      throw new Error(
        pasting
          ? "The accepted paste point could not be split."
          : "The accepted text point could not be split.",
      );
    }
    right.insertBefore(wrapper);
  }
  nodes[nodes.length - 1]!.selectEnd();
}

function commitInsertRunsAtCaret(
  target: ReviewTarget,
  runs: readonly ReviewEditRun[],
  identityOptions: ReviewAuthoringOptions,
  registration: ReviewEditRegistration,
  continuation: "continue-adjacent" | "fresh",
): Preparation<TargetEditEffect> {
  if (target.kind !== "accepted-caret") return kindMismatch();
  if (runs.length === 0) return noOp();
  if (continuation === "continue-adjacent" && runs.length === 1) {
    const continued = tryContinueAdjacentInsertion(target, runs[0]!);
    if (continued !== null) return continued;
  }
  const missing = checkRegistration(registration);
  if (missing !== null) return missing;
  const minted = prepareProposalId(identityOptions);
  if (minted.status !== "ready") return minted;
  insertRunsAtAcceptedPoint(
    target,
    minted.value,
    runs,
    registration.action === "pasting",
  );
  return mutated();
}

function splitFailureMessage(pasting: boolean): string {
  return pasting
    ? "Validated paste target could not be isolated."
    : "Validated replacement target could not be isolated.";
}

function commitReplaceRangeWithRuns(
  target: ReviewTarget,
  runs: readonly ReviewEditRun[],
  identityOptions: ReviewAuthoringOptions,
  registration: ReviewEditRegistration,
  matchRunFormat: boolean,
  useSelectionFormat: boolean,
): Preparation<TargetEditEffect> {
  if (target.kind !== "accepted-range") return kindMismatch();
  if (runs.length === 0) return noOp();
  const missing = checkRegistration(registration);
  if (missing !== null) return missing;
  const minted = prepareProposalId(identityOptions);
  if (minted.status !== "ready") return minted;
  // Equivalence without splitting: unchanged paths leave zero mutation.
  if (runs.length === 1) {
    const read = readAcceptedRangeText(target);
    if (read === null)
      throw new Error(splitFailureMessage(registration.action === "pasting"));
    const run = runs[0]!;
    if (
      read.text === run.text &&
      read.uniformSelectionFormat &&
      (!matchRunFormat || run.format === target.selection.format)
    ) {
      return noOp();
    }
  }
  const selected = isolateAcceptedTextRange(target);
  if (!selected?.length)
    throw new Error(splitFailureMessage(registration.action === "pasting"));
  const oldSide = $createReviewDeletionNode(minted.value);
  const newSide = $createReviewInsertionNode(minted.value);
  const contents = runs.map((run) =>
    $createTextNode(run.text).setFormat(
      useSelectionFormat ? target.selection.format : run.format,
    ),
  );
  selected[0]!.insertBefore(oldSide);
  oldSide.append(...selected);
  oldSide.insertAfter(newSide);
  newSide.append(...contents);
  contents[contents.length - 1]!.selectEnd();
  return mutated();
}

/**
 * Batch proposal-caret insertion with a preflight guarantee. Cursor
 * resolution is read-only and precedes all mutation; the mutation loop
 * carries the cursor on live node refs and contains no refusal paths, so
 * no returned refusal can follow a partial batch. Same-proposal
 * containment holds structurally: every run inserts into the same
 * wrapper's text, and the proposal identity never changes mid-batch.
 */
function insertProposalRuns(
  target: ProposalCaretTarget,
  runs: readonly ReviewEditRun[],
): Preparation<{ node: TextNode; offset: number }> {
  const children = getTextChildren(target.wrapper);
  if (children === null) {
    return refusal(
      "invalid-structural-target",
      "The proposal caret cannot be resolved.",
    );
  }
  let node: TextNode | null = target.node;
  let offset = target.offset;
  if (node === null) {
    for (const child of children) {
      if (offset <= child.getTextContentSize()) {
        node = child;
        break;
      }
      offset -= child.getTextContentSize();
    }
  }
  if (node === null) {
    return refusal(
      "invalid-structural-target",
      "The proposal caret cannot be resolved.",
    );
  }
  let cursor = node;
  let cursorOffset = offset;
  for (const run of runs) {
    if (cursor.getFormat() === run.format) {
      cursor.spliceText(cursorOffset, 0, run.text, true);
      cursorOffset += run.text.length;
    } else {
      const inserted = $createTextNode(run.text).setFormat(run.format);
      if (cursorOffset === 0) cursor.insertBefore(inserted);
      else if (cursorOffset === cursor.getTextContentSize())
        cursor.insertAfter(inserted);
      else {
        const parts = cursor.splitText(cursorOffset);
        const right = parts[1];
        if (right === undefined)
          throw new Error("The proposal caret could not be split.");
        right.insertBefore(inserted);
      }
      cursor = inserted;
      cursorOffset = run.text.length;
    }
  }
  return { status: "ready", value: { node: cursor, offset: cursorOffset } };
}

function commitCorrectProposalCaretWithRuns(
  target: ReviewTarget,
  runs: readonly ReviewEditRun[],
): Preparation<TargetEditEffect> {
  if (target.kind !== "proposal-caret") return kindMismatch();
  if (runs.length === 0) return noOp();
  const batch = insertProposalRuns(target, runs);
  if (batch.status !== "ready") return batch;
  batch.value.node.select(batch.value.offset, batch.value.offset);
  return mutated();
}

function commitCorrectProposalRangeWithRuns(
  target: ReviewTarget,
  runs: readonly ReviewEditRun[],
): Preparation<TargetEditEffect> {
  if (target.kind !== "proposal-range") return kindMismatch();
  if (runs.length === 0) return noOp();
  const corrected = replaceProposalRange(target, runs[0]!.text);
  if (corrected.status === "changed") return mutated();
  if (corrected.status === "unchanged") return noOp();
  if (corrected.status === "failed") {
    // Unreachable: replaceProposalRange only refuses, reports unchanged, or
    // mutates. A failure here is a bug, and bugs throw rather than refuse.
    throw corrected.error.cause instanceof Error
      ? corrected.error.cause
      : new Error(corrected.error.message);
  }
  return corrected;
}

function commitPlan(
  target: ReviewTarget,
  plan: ReviewTargetEditPlan,
): Preparation<TargetEditEffect> {
  switch (plan.kind) {
    case "delete-proposal-caret":
      return commitDeleteProposalCaret(target, plan.backward, plan.granularity);
    case "delete-proposal-range":
      return commitDeleteProposalRange(target);
    case "delete-accepted-caret":
      return commitDeleteAcceptedCaret(
        target,
        plan.backward,
        plan.granularity,
        plan.identityOptions,
        plan.registration,
      );
    case "delete-accepted-range":
      if (target.kind !== "accepted-range") return kindMismatch();
      if (target.start === target.end) return noOp();
      return commitDeleteAcceptedSpan(
        target,
        plan.backward,
        plan.identityOptions,
        plan.registration,
      );
    case "insert-runs-at-caret":
      return commitInsertRunsAtCaret(
        target,
        plan.runs,
        plan.identityOptions,
        plan.registration,
        plan.continuation,
      );
    case "replace-range-with-runs":
      return commitReplaceRangeWithRuns(
        target,
        plan.runs,
        plan.identityOptions,
        plan.registration,
        plan.matchRunFormat,
        plan.useSelectionFormat,
      );
    case "correct-proposal-caret-with-runs":
      return commitCorrectProposalCaretWithRuns(target, plan.runs);
    case "correct-proposal-range-with-runs":
      return commitCorrectProposalRangeWithRuns(target, plan.runs);
  }
}

/**
 * Single commit seam. Overloads express paste's (and text insertion's)
 * non-resolution in the types: NonResolvingEditPlan inputs cannot yield
 * resolution-required, so those callers switch exhaustively without one.
 */
export function $commitTargetEdit(
  target: ReviewTarget,
  plan: ResolvingEditPlan,
): Preparation<TargetEditEffect>;
export function $commitTargetEdit(
  target: ReviewTarget,
  plan: NonResolvingEditPlan,
): Preparation<NonResolvingEditEffect>;
export function $commitTargetEdit(
  target: ReviewTarget,
  plan: ReviewTargetEditPlan,
): Preparation<TargetEditEffect> {
  return commitPlan(target, plan);
}
