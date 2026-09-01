import {
  $getRoot,
  $getState,
  $setState,
  createState,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import {
  $createReviewProjection,
  type AcceptedDocumentView,
  type AcceptedPoint,
  type AcceptedTextRun,
  type ProjectionMode,
  type ReviewProjection,
} from "./ReviewProjection";
import {
  exportReviewDocument,
  validateReviewDocument,
  type ReviewDocumentV3,
  type ValidationResult,
} from "./LegacyReviewDocument";
import { ReviewTextNode } from "./ReviewTextNode";

export type {
  AcceptedDocumentView,
  AcceptedParagraph,
  AcceptedPoint,
  AcceptedTextRun,
  ProjectionMode,
  ReviewProjection,
} from "./ReviewProjection";
export { $canReviewSegmentsMerge } from "./ReviewProjection";

export type ReviewRefusal = Readonly<{
  code: ReviewRefusalCode;
  message: string;
}>;

export type ReviewRefusalCode =
  | "active-draft"
  | "ambiguous-boundary"
  | "deletion-target-unavailable"
  | "finalized-proposal-intersection"
  | "insertion-target-unavailable"
  | "invalid-proposal-identity"
  | "proposal-already-resolved"
  | "proposal-not-found"
  | "proposal-side-target"
  | "unsupported-deletion"
  | "unsupported-formatting"
  | "unsupported-insertion"
  | "unsupported-structure"
  | "unsupported-target"
  | "unsupported-transfer";

export type ReviewOperationalError = Readonly<{
  cause?: unknown;
  code: string;
  message: string;
}>;

export type ReviewOutcome<T = void> =
  | Readonly<{ status: "changed"; value: T }>
  | Readonly<{ status: "unchanged"; value: T }>
  | Readonly<{ reason: ReviewRefusal; status: "refused" }>
  | Readonly<{ error: ReviewOperationalError; status: "failed" }>;

export type InsertionPayload = Readonly<{
  runs: readonly AcceptedTextRun[];
}>;

export type InsertionDraft = Readonly<{
  kind: "insertion";
  payload: InsertionPayload;
  target: AcceptedPoint;
}>;

export type InsertionIntention = Readonly<{
  format?: number;
  target: AcceptedPoint;
  text: string;
}>;

export type InsertionIntentionPreparation =
  | Readonly<{ status: "ready"; value: InsertionIntention }>
  | Readonly<{ reason: ReviewRefusal; status: "refused" }>;

export type DeletionTarget = Readonly<{
  end: AcceptedPoint;
  start: AcceptedPoint;
}>;

export type DeletionPayload = Readonly<{
  runs: readonly AcceptedTextRun[];
}>;

export type DeletionDraft = Readonly<{
  kind: "deletion";
  payload: DeletionPayload;
  target: DeletionTarget;
}>;

export type DeletionIntention = Readonly<{
  draftSelection?: Readonly<{
    end: number;
    kind: "insertion";
    start: number;
  }>;
  target: DeletionTarget;
  direction?: "backward" | "forward" | "range";
}>;

export type DeletionIntentionPreparation =
  | Readonly<{
      status: "ready";
      value: DeletionIntention;
    }>
  | Readonly<{ reason: ReviewRefusal; status: "refused" }>;

export type InsertionProposal = Readonly<{
  id: string;
  kind: "insertion";
  payload: InsertionPayload;
  status: "accepted" | "pending" | "rejected";
  target: AcceptedPoint;
}>;

export type DeletionProposal = Readonly<{
  id: string;
  kind: "deletion";
  payload: DeletionPayload;
  status: "accepted" | "pending" | "rejected";
  target: DeletionTarget;
}>;

export type ReviewProposal = InsertionProposal | DeletionProposal;
export type ReviewDraft = InsertionDraft | DeletionDraft;

export type ProposalIdentityFactory = () => string;

export type ReviewSessionOptions = Readonly<{
  identityFactory?: ProposalIdentityFactory;
}>;

export type ReviewStateView = Readonly<{
  accepted: AcceptedDocumentView;
  draft: InsertionDraft | DeletionDraft | null;
  proposals: readonly (InsertionProposal | DeletionProposal)[];
}>;

export interface ReviewSession {
  acceptProposal(id: string): ReviewOutcome<ReviewProposal>;
  discardDraft(): ReviewOutcome;
  exportDocument(): ReviewOutcome<ReviewDocumentV3>;
  finalizeDraft(): ReviewOutcome<ReviewProposal | null>;
  getEditorState(): EditorState;
  deleteText(intention: DeletionIntention): ReviewOutcome<ReviewStateView>;
  insertText(intention: InsertionIntention): ReviewOutcome<ReviewStateView>;
  project(mode: ProjectionMode): ReviewProjection;
  readState(editorState?: EditorState): ReviewStateView;
  rejectProposal(id: string): ReviewOutcome<ReviewProposal>;
}

type LiveReviewMetadata = Readonly<{
  draft: InsertionDraft | DeletionDraft | null;
  proposals: readonly (InsertionProposal | DeletionProposal)[];
  version: 3;
}>;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function immutableTarget(
  target: AcceptedPoint | DeletionTarget,
): AcceptedPoint | DeletionTarget {
  return "offset" in target
    ? { ...target }
    : {
        end: { ...target.end },
        start: { ...target.start },
      };
}

function immutableReviewValue<
  T extends
    InsertionDraft | DeletionDraft | InsertionProposal | DeletionProposal,
>(value: T): T {
  return deepFreeze({
    ...value,
    payload: {
      runs: value.payload.runs.map((run) => ({ ...run })),
    },
    target: immutableTarget(value.target),
  }) as T;
}

function immutableDraft(
  draft: InsertionDraft | DeletionDraft,
): InsertionDraft | DeletionDraft {
  return immutableReviewValue(draft);
}

function immutableProposal(
  proposal: InsertionProposal | DeletionProposal,
): InsertionProposal | DeletionProposal {
  return immutableReviewValue(proposal);
}

const EMPTY_METADATA: LiveReviewMetadata = {
  draft: null,
  proposals: [],
  version: 3,
};

function parseMetadata(value: unknown): LiveReviewMetadata {
  if (typeof value !== "object" || value === null) {
    return EMPTY_METADATA;
  }
  const metadata = value as Partial<LiveReviewMetadata>;
  return {
    draft: metadata.draft == null ? null : immutableDraft(metadata.draft),
    proposals: Array.isArray(metadata.proposals)
      ? metadata.proposals.map(immutableProposal)
      : [],
    version: 3,
  };
}

const REVIEW_METADATA = createState("lexical-review", {
  parse: parseMetadata,
});

function stateView(editorState: EditorState): ReviewStateView {
  return editorState.read(() => {
    const root = $getRoot();
    const metadata = $getState(root, REVIEW_METADATA);
    const projection = $createReviewProjection().inspect({ kind: "state" });
    return deepFreeze({
      accepted: projection.accepted,
      draft:
        metadata.draft === null
          ? null
          : {
              ...metadata.draft,
              payload: {
                runs:
                  projection.draftRuns === null
                    ? metadata.draft.payload.runs
                    : projection.draftRuns,
              },
            },
      proposals: metadata.proposals,
    });
  });
}

function sameTarget(left: AcceptedPoint, right: AcceptedPoint): boolean {
  return left.offset === right.offset && left.paragraph === right.paragraph;
}

function mergeAcceptedTextRuns(
  runs: readonly AcceptedTextRun[],
): AcceptedTextRun[] {
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

function draftIsSemanticNoop(draft: ReviewDraft): boolean {
  return draft.payload.runs.every((run) => run.text.length === 0);
}

type DraftSettlement =
  | Readonly<{ kind: "discard" }>
  | Readonly<{ kind: "finalize"; proposal: ReviewProposal }>
  | Readonly<{ kind: "none" }>;

function $applyDraftSettlement(
  metadata: LiveReviewMetadata,
  settlement: DraftSettlement,
): LiveReviewMetadata {
  if (settlement.kind === "none") {
    return metadata;
  }
  if (settlement.kind === "finalize") {
    if (metadata.draft?.kind !== settlement.proposal.kind) {
      throw new Error("The proposal draft could not be finalized.");
    }
    const result = $createReviewProjection().reconcile({
      kind: "settle-draft",
      proposal: settlement.proposal,
    });
    if (result.status !== "changed") {
      throw new Error("The proposal draft could not be finalized.");
    }
    return {
      ...metadata,
      draft: null,
      proposals: [...metadata.proposals, settlement.proposal],
    };
  }
  $createReviewProjection().reconcile({ kind: "discard-draft" });
  return { ...metadata, draft: null };
}

type ProposalPreparation =
  | Readonly<{ status: "ready"; value: ReviewProposal }>
  | Extract<ReviewOutcome<never>, { status: "failed" | "refused" }>;

function failedOutcome(
  cause: unknown,
  code: string,
  message: string,
): Extract<ReviewOutcome<never>, { status: "failed" }> {
  return {
    error: {
      cause,
      code,
      message,
    },
    status: "failed",
  };
}

type DiscreteEditorUpdateResult =
  | Readonly<{ status: "completed" }>
  | Readonly<{ cause: unknown; status: "failed" }>;

function runDiscreteEditorUpdate(
  editor: LexicalEditor,
  update: () => void,
): DiscreteEditorUpdateResult {
  let callbackFailed = false;
  let callbackCause: unknown;
  try {
    editor.update(
      () => {
        try {
          update();
        } catch (cause) {
          callbackFailed = true;
          callbackCause = cause;
          throw cause;
        }
      },
      { discrete: true },
    );
  } catch (cause) {
    return {
      cause: callbackFailed ? callbackCause : cause,
      status: "failed",
    };
  }
  return !callbackFailed
    ? { status: "completed" }
    : { cause: callbackCause, status: "failed" };
}

function restoreEditorState(
  editor: LexicalEditor,
  editorState: EditorState,
): void {
  if (editorState.read(() => $getRoot().getChildrenSize() > 0)) {
    editor.setEditorState(editorState);
    return;
  }
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      $setState(root, REVIEW_METADATA, EMPTY_METADATA);
    },
    { discrete: true },
  );
}

class LexicalReviewSession implements ReviewSession {
  readonly #editor: LexicalEditor;
  readonly #identityFactory: ProposalIdentityFactory;

  constructor(editor: LexicalEditor, options: ReviewSessionOptions) {
    this.#editor = editor;
    this.#identityFactory =
      options.identityFactory ?? (() => globalThis.crypto.randomUUID());
  }

  acceptProposal(id: string): ReviewOutcome<ReviewProposal> {
    return this.#resolveProposal(id, "accepted");
  }

  discardDraft(): ReviewOutcome {
    if (this.readState().draft === null) {
      return { status: "unchanged", value: undefined };
    }
    const result = runDiscreteEditorUpdate(this.#editor, () => {
      const root = $getRoot();
      const metadata = $getState(root, REVIEW_METADATA);
      if (metadata.draft === null) {
        throw new Error("The proposal draft could not be discarded.");
      }
      const reconciliation = $createReviewProjection().reconcile({
        kind: "discard-draft",
      });
      if (reconciliation.status !== "changed") {
        throw new Error("The proposal draft could not be discarded.");
      }
      $setState(root, REVIEW_METADATA, { ...metadata, draft: null });
    });
    if (result.status === "failed") {
      return {
        error: {
          cause: result.cause,
          code: "discard-failed",
          message: "The proposal draft could not be discarded.",
        },
        status: "failed",
      };
    }
    return { status: "changed", value: undefined };
  }

  exportDocument(): ReviewOutcome<ReviewDocumentV3> {
    if (this.readState().draft !== null) {
      return {
        reason: {
          code: "active-draft",
          message: "Finalize or discard the active draft before native export.",
        },
        status: "refused",
      };
    }
    const result = exportReviewDocument(this.#editor.getEditorState());
    if (result.status === "valid") {
      return { status: "unchanged", value: result.value };
    }
    return {
      error: {
        code: "invalid-session-state",
        message: "The current Lexical EditorState is not a review document.",
      },
      status: "failed",
    };
  }

  finalizeDraft(): ReviewOutcome<ReviewProposal | null> {
    const before = this.readState();
    const prepared = this.#prepareDraftSettlement(before);
    if (prepared.status !== "ready") {
      return prepared;
    }
    if (prepared.value.kind === "none") {
      return { status: "unchanged", value: null };
    }
    const proposal =
      prepared.value.kind === "finalize" ? prepared.value.proposal : null;
    const result = runDiscreteEditorUpdate(this.#editor, () => {
      const root = $getRoot();
      const metadata = $getState(root, REVIEW_METADATA);
      $setState(
        root,
        REVIEW_METADATA,
        $applyDraftSettlement(metadata, prepared.value),
      );
    });
    if (result.status === "failed") {
      return failedOutcome(
        result.cause,
        "finalization-failed",
        "The proposal draft could not be finalized.",
      );
    }
    return { status: "changed", value: proposal };
  }

  getEditorState(): EditorState {
    return this.#editor.getEditorState();
  }

  deleteText(intention: DeletionIntention): ReviewOutcome<ReviewStateView> {
    const target = intention.target;

    if (
      target.start.paragraph !== target.end.paragraph ||
      !Number.isInteger(target.start.paragraph) ||
      target.start.paragraph < 0 ||
      !Number.isInteger(target.start.offset) ||
      !Number.isInteger(target.end.offset) ||
      target.start.offset < 0 ||
      target.end.offset < target.start.offset
    ) {
      return {
        reason: {
          code: "deletion-target-unavailable",
          message:
            "Deletion supports one nonempty same-paragraph accepted-state range.",
        },
        status: "refused",
      };
    }

    const before = this.readState();
    const targetResolution = this.#editor.getEditorState().read(() => {
      return $createReviewProjection().inspect({
        kind: "accepted-range",
        target,
      });
    });
    if (!targetResolution.withinBounds) {
      return {
        reason: {
          code: "deletion-target-unavailable",
          message: "The deletion target is outside accepted content.",
        },
        status: "refused",
      };
    }
    if (
      intention.draftSelection !== undefined &&
      before.draft?.kind === "insertion"
    ) {
      const { end, start } = intention.draftSelection;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
        return { status: "unchanged", value: before };
      }
      let changed = false;
      const result = runDiscreteEditorUpdate(this.#editor, () => {
        const root = $getRoot();
        const metadata = $getState(root, REVIEW_METADATA);
        if (metadata.draft?.kind !== "insertion") {
          return;
        }
        const reconciliation = $createReviewProjection().reconcile({
          end,
          kind: "trim-insertion-draft",
          start,
        });
        if (
          reconciliation.status !== "changed" ||
          reconciliation.value === undefined ||
          reconciliation.value.format === undefined ||
          reconciliation.value.text === undefined
        ) {
          return;
        }
        $setState(root, REVIEW_METADATA, {
          ...metadata,
          draft: {
            ...metadata.draft,
            payload: {
              runs: [
                {
                  format: reconciliation.value.format,
                  text: reconciliation.value.text,
                },
              ],
            },
          },
        });
        changed = true;
      });
      if (result.status === "failed") {
        return failedOutcome(
          result.cause,
          "deletion-failed",
          "The deletion intention could not correct the insertion draft.",
        );
      }
      return changed
        ? { status: "changed", value: this.readState() }
        : { status: "unchanged", value: before };
    }
    if (target.end.offset === target.start.offset) {
      return { status: "unchanged", value: before };
    }

    if (
      before.draft?.kind === "deletion" &&
      target.start.paragraph === before.draft.target.start.paragraph &&
      target.start.offset < before.draft.target.end.offset &&
      before.draft.target.start.offset < target.end.offset
    ) {
      let changed = false;
      const result = runDiscreteEditorUpdate(this.#editor, () => {
        const root = $getRoot();
        const metadata = $getState(root, REVIEW_METADATA);
        if (metadata.draft?.kind !== "deletion") {
          return;
        }
        const reconciliation = $createReviewProjection().reconcile({
          kind: "restore-deletion-draft",
        });
        if (reconciliation.status !== "changed") {
          return;
        }
        $setState(root, REVIEW_METADATA, { ...metadata, draft: null });
        changed = true;
      });
      if (result.status === "failed") {
        return failedOutcome(
          result.cause,
          "deletion-failed",
          "The deletion intention could not restore the deletion draft.",
        );
      }
      return changed
        ? { status: "changed", value: this.readState() }
        : { status: "unchanged", value: before };
    }

    const requestedRuns = targetResolution.requestedRuns;
    if (requestedRuns === null) {
      return {
        reason: {
          code: "deletion-target-unavailable",
          message:
            "The deletion target is not an unambiguous accepted-state range.",
        },
        status: "refused",
      };
    }

    const direction = intention.direction ?? "range";
    const continuesDraft =
      before.draft?.kind === "deletion" &&
      direction !== "range" &&
      (direction === "backward"
        ? target.end.offset === before.draft.target.start.offset
        : target.start.offset === before.draft.target.end.offset) &&
      target.start.paragraph === before.draft.target.start.paragraph;

    let settlement: DraftSettlement = { kind: "none" };
    if (before.draft !== null && !continuesDraft) {
      const prepared = this.#prepareDraftSettlement(before);
      if (prepared.status !== "ready") {
        return prepared;
      }
      settlement = prepared.value;
    }

    let changed = false;
    const result = runDiscreteEditorUpdate(this.#editor, () => {
      const root = $getRoot();
      let metadata = $getState(root, REVIEW_METADATA);
      if (metadata.draft !== null && !continuesDraft) {
        metadata = $applyDraftSettlement(metadata, settlement);
      }

      const reconciliation = $createReviewProjection().reconcile({
        kind: "mark-deletion",
        segment: { type: "draft-deletion" },
        target,
      });
      if (reconciliation.status !== "changed") {
        throw new Error("The validated deletion target became unavailable.");
      }

      if (continuesDraft && before.draft?.kind === "deletion") {
        const nextTarget: DeletionTarget =
          direction === "backward"
            ? { start: target.start, end: before.draft.target.end }
            : { start: before.draft.target.start, end: target.end };
        const payloadRuns = mergeAcceptedTextRuns(
          direction === "backward"
            ? [...requestedRuns, ...before.draft.payload.runs]
            : [...before.draft.payload.runs, ...requestedRuns],
        );
        $setState(root, REVIEW_METADATA, {
          ...metadata,
          draft: {
            kind: "deletion",
            payload: { runs: payloadRuns },
            target: nextTarget,
          },
        });
      } else {
        $setState(root, REVIEW_METADATA, {
          ...metadata,
          draft: {
            kind: "deletion",
            payload: { runs: requestedRuns },
            target,
          },
        });
      }
      changed = true;
    });
    if (result.status === "failed") {
      return failedOutcome(
        result.cause,
        "deletion-failed",
        "The deletion intention could not be applied.",
      );
    }

    return changed
      ? { status: "changed", value: this.readState() }
      : { status: "unchanged", value: before };
  }

  insertText(intention: InsertionIntention): ReviewOutcome<ReviewStateView> {
    const format = intention.format ?? 0;
    if (
      intention.text.length === 0 ||
      intention.text.includes("\n") ||
      !Number.isInteger(format) ||
      format < 0 ||
      (format & ~0b1111) !== 0
    ) {
      return {
        reason: {
          code: "unsupported-insertion",
          message:
            "Insertion text must be nonempty paragraph-local content with supported formatting.",
        },
        status: "refused",
      };
    }

    const before = this.readState();
    const beforeRun = before.draft?.payload.runs[0];
    const continuesDraft =
      before.draft?.kind === "insertion" &&
      sameTarget(before.draft.target, intention.target) &&
      beforeRun !== undefined &&
      beforeRun.format === format;
    let settlement: DraftSettlement = { kind: "none" };
    if (before.draft !== null && !continuesDraft) {
      const prepared = this.#prepareDraftSettlement(before);
      if (prepared.status !== "ready") {
        return prepared;
      }
      settlement = prepared.value;
    }

    let changed = false;
    const result = runDiscreteEditorUpdate(this.#editor, () => {
      const root = $getRoot();
      let metadata = $getState(root, REVIEW_METADATA);
      const projection = $createReviewProjection();
      if (
        !projection.inspect({
          kind: "insertion-point",
          target: intention.target,
        }).available
      ) {
        return;
      }
      if (metadata.draft !== null) {
        if (
          metadata.draft?.kind === "insertion" &&
          sameTarget(metadata.draft.target, intention.target)
        ) {
          const reconciliation = projection.reconcile({
            kind: "append-insertion-draft",
            run: { format, text: intention.text },
          });
          if (
            reconciliation.status === "changed" &&
            reconciliation.value?.format !== undefined &&
            reconciliation.value.text !== undefined
          ) {
            $setState(root, REVIEW_METADATA, {
              ...metadata,
              draft: {
                ...metadata.draft,
                payload: {
                  runs: [
                    {
                      format: reconciliation.value.format,
                      text: reconciliation.value.text,
                    },
                  ],
                },
              },
            });
            changed = true;
            return;
          }
        }
        metadata = $applyDraftSettlement(metadata, settlement);
      }

      const reconciliation = $createReviewProjection().reconcile({
        kind: "insert",
        runs: [{ format, text: intention.text }],
        segment: { type: "draft-insertion" },
        target: intention.target,
      });
      if (reconciliation.status !== "changed") {
        throw new Error("The validated insertion target became unavailable.");
      }
      $setState(root, REVIEW_METADATA, {
        ...metadata,
        draft: {
          kind: "insertion",
          payload: { runs: [{ format, text: intention.text }] },
          target: intention.target,
        },
      });
      changed = true;
    });
    if (result.status === "failed") {
      return failedOutcome(
        result.cause,
        "insertion-failed",
        "The insertion intention could not be applied.",
      );
    }

    if (!changed) {
      return {
        reason: {
          code: "insertion-target-unavailable",
          message:
            "The insertion target is not an unambiguous accepted-state caret.",
        },
        status: "refused",
      };
    }
    return { status: "changed", value: this.readState() };
  }

  project(mode: ProjectionMode): ReviewProjection {
    return this.#editor
      .getEditorState()
      .read(() =>
        deepFreeze($createReviewProjection().inspect({ kind: "view", mode })),
      );
  }

  readState(editorState = this.#editor.getEditorState()): ReviewStateView {
    return stateView(editorState);
  }

  #prepareProposal(
    draft: ReviewDraft,
    proposals: readonly ReviewProposal[],
  ): ProposalPreparation {
    let id: string;
    try {
      id = this.#identityFactory();
    } catch (cause) {
      return {
        error: {
          cause,
          code: "identity-generation-failed",
          message: "The proposal identity factory failed.",
        },
        status: "failed",
      };
    }
    if (id.length === 0 || proposals.some((proposal) => proposal.id === id)) {
      return {
        reason: {
          code: "invalid-proposal-identity",
          message:
            "The proposal identity must be nonempty and unique in the session.",
        },
        status: "refused",
      };
    }
    const proposal =
      draft.kind === "insertion"
        ? {
            id,
            kind: "insertion" as const,
            payload: draft.payload,
            status: "pending" as const,
            target: draft.target,
          }
        : {
            id,
            kind: "deletion" as const,
            payload: draft.payload,
            status: "pending" as const,
            target: draft.target,
          };
    return { status: "ready", value: immutableProposal(proposal) };
  }

  #prepareDraftSettlement(
    state: ReviewStateView,
  ):
    | Readonly<{ status: "ready"; value: DraftSettlement }>
    | Extract<ReviewOutcome<never>, { status: "failed" | "refused" }> {
    if (state.draft === null) {
      return { status: "ready", value: { kind: "none" } };
    }
    if (draftIsSemanticNoop(state.draft)) {
      return { status: "ready", value: { kind: "discard" } };
    }
    const prepared = this.#prepareProposal(state.draft, state.proposals);
    return prepared.status === "ready"
      ? {
          status: "ready",
          value: { kind: "finalize", proposal: prepared.value },
        }
      : prepared;
  }

  rejectProposal(id: string): ReviewOutcome<ReviewProposal> {
    return this.#resolveProposal(id, "rejected");
  }

  #resolveProposal(
    id: string,
    resolution: "accepted" | "rejected",
  ): ReviewOutcome<ReviewProposal> {
    const before = this.readState();
    const proposal = before.proposals.find((candidate) => candidate.id === id);
    if (proposal === undefined) {
      return {
        reason: {
          code: "proposal-not-found",
          message: "The requested proposal does not exist.",
        },
        status: "refused",
      };
    }
    if (proposal.status !== "pending") {
      return proposal.status === resolution
        ? { status: "unchanged", value: proposal }
        : {
            reason: {
              code: "proposal-already-resolved",
              message: "The proposal already has a terminal resolution.",
            },
            status: "refused",
          };
    }

    const settlement = this.#prepareDraftSettlement(before);
    if (settlement.status !== "ready") {
      return settlement;
    }

    const resolved = immutableProposal({ ...proposal, status: resolution });
    const result = runDiscreteEditorUpdate(this.#editor, () => {
      const root = $getRoot();
      let metadata = $getState(root, REVIEW_METADATA);
      metadata = $applyDraftSettlement(metadata, settlement.value);
      const projectionResult = $createReviewProjection().reconcile({
        candidates: metadata.proposals.filter(
          (candidate) => candidate.id !== id,
        ),
        kind: "resolve-proposal",
        proposal,
        resolution,
      });
      if (projectionResult.status !== "changed") {
        throw new Error("The pending proposal has no projection segment.");
      }
      $setState(root, REVIEW_METADATA, {
        ...metadata,
        proposals: metadata.proposals.map((candidate) => {
          if (candidate.id === id) {
            return resolved;
          }
          if (resolution !== "accepted") {
            return candidate;
          }
          const target = projectionResult.value?.remappedTargets?.find(
            (update) => update.id === candidate.id,
          )?.target;
          return target === undefined
            ? candidate
            : immutableProposal({
                ...candidate,
                target,
              } as ReviewProposal);
        }),
      });
    });
    if (result.status === "failed") {
      return failedOutcome(
        result.cause,
        "resolution-failed",
        "The proposal could not be resolved.",
      );
    }
    return { status: "changed", value: resolved };
  }
}

export function importReviewDocument(
  editor: LexicalEditor,
  input: unknown,
): ValidationResult<EditorState> {
  const validated = validateReviewDocument(input);
  if (validated.status !== "valid") {
    return validated;
  }
  try {
    return {
      status: "valid",
      value: editor.parseEditorState(validated.value),
    };
  } catch (cause) {
    return {
      issues: [
        {
          code: "invalid-document",
          message:
            cause instanceof Error
              ? cause.message
              : "Lexical could not parse the review document.",
          path: "$",
        },
      ],
      status: "invalid",
    };
  }
}

export function openReviewSession(
  editor: LexicalEditor,
  input: unknown,
  options: ReviewSessionOptions = {},
): ValidationResult<ReviewSession> {
  const imported = importReviewDocument(editor, input);
  if (imported.status !== "valid") {
    return imported;
  }
  const serializedMetadata = (
    imported.value.toJSON().root.$ as
      Record<string, { proposals?: readonly ReviewProposal[] }> | undefined
  )?.["lexical-review"];
  if (
    serializedMetadata?.proposals?.some(
      (proposal) => proposal.status === "pending",
    ) &&
    !editor.hasNode(ReviewTextNode)
  ) {
    return {
      issues: [
        {
          code: "invalid-document",
          message:
            "ReviewTextNode must be registered before opening pending proposals.",
          path: "$",
        },
      ],
      status: "invalid",
    };
  }
  const previousEditorState = editor.getEditorState();
  editor.setEditorState(imported.value);
  const result = runDiscreteEditorUpdate(editor, () => {
    const metadata = $getState($getRoot(), REVIEW_METADATA);
    const reconciliation = $createReviewProjection().reconcile({
      kind: "install-proposals",
      proposals: metadata.proposals.filter(
        (proposal) => proposal.status === "pending",
      ),
    });
    if (reconciliation.status === "unavailable") {
      throw new Error(reconciliation.reason.message);
    }
  });
  if (result.status === "failed") {
    restoreEditorState(editor, previousEditorState);
    return {
      issues: [
        {
          code: "invalid-document",
          message:
            result.cause instanceof Error
              ? result.cause.message
              : "The review projection could not be installed.",
          path: "$",
        },
      ],
      status: "invalid",
    };
  }
  return {
    status: "valid",
    value: new LexicalReviewSession(editor, options),
  };
}
