import {
  $getSelection,
  $isRangeSelection,
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
  KEY_ENTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  PASTE_COMMAND,
  REMOVE_TEXT_COMMAND,
  SET_TEXT_FORMAT_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import {
  $createReviewProjection,
  type ProjectionSelectionInspection,
  type ReviewProjectionCursor,
} from "./ReviewProjection";
import {
  type DeletionIntentionPreparation,
  type InsertionIntentionPreparation,
  type ReviewOutcome,
  type ReviewRefusal,
  type ReviewRefusalCode,
  type ReviewSession as LegacyReviewSession,
  type ReviewStateView,
} from "./LegacyReviewSession";
import {
  registerNodeBackedReviewSession,
  type NodeBackedReviewSessionRegistrationOptions,
} from "./registerNodeBackedReviewSession";
import type { ReviewSession as NodeBackedReviewSession } from "./ReviewSession";

type SelectionSnapshot = Readonly<{
  anchor: Readonly<{ key: string; offset: number; type: "element" | "text" }>;
  focus: Readonly<{ key: string; offset: number; type: "element" | "text" }>;
}>;

function refusal(code: ReviewRefusalCode, message: string): ReviewRefusal {
  return { code, message };
}

function getSelectionTargetRefusal(
  selection: ProjectionSelectionInspection,
): ReviewRefusal | null {
  if (selection.status === "unsupported") {
    return refusal(
      "unsupported-target",
      "The selection does not identify a supported review target.",
    );
  }
  if (!selection.collapsed) {
    return selection.selected.finalizedProposal
      ? refusal(
          "finalized-proposal-intersection",
          "The selection intersects finalized proposal content.",
        )
      : refusal(
          "unsupported-target",
          "The range is not supported by this review intention.",
        );
  }
  if (
    selection.anchor.association === "proposal-insertion" ||
    selection.anchor.association === "proposal-deletion"
  ) {
    return refusal(
      "proposal-side-target",
      "Finalized proposal content is not an accepted-side target.",
    );
  }
  if (selection.acceptedBoundary === "unsupported") {
    return refusal(
      "unsupported-target",
      "The selection does not identify a supported paragraph target.",
    );
  }
  return selection.acceptedBoundary === "ambiguous"
    ? refusal(
        "ambiguous-boundary",
        "The caret boundary does not carry one accepted-side association.",
      )
    : null;
}

function getUnsupportedIntentionRefusal(
  fallback: ReviewRefusal,
): ReviewRefusal {
  const projection = $createReviewProjection();
  return (
    getSelectionTargetRefusal(projection.inspect({ kind: "selection" })) ??
    fallback
  );
}

function snapshotSelection(selection: RangeSelection): SelectionSnapshot {
  return {
    anchor: {
      key: selection.anchor.key,
      offset: selection.anchor.offset,
      type: selection.anchor.type,
    },
    focus: {
      key: selection.focus.key,
      offset: selection.focus.offset,
      type: selection.focus.type,
    },
  };
}

function getSelectionSnapshot(): SelectionSnapshot | null {
  const selection = $getSelection();
  return $isRangeSelection(selection) ? snapshotSelection(selection) : null;
}

function restoreSelectionSnapshot(snapshot: SelectionSnapshot): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  selection.anchor.set(
    snapshot.anchor.key,
    snapshot.anchor.offset,
    snapshot.anchor.type,
  );
  selection.focus.set(
    snapshot.focus.key,
    snapshot.focus.offset,
    snapshot.focus.type,
  );
  selection.dirty = true;
  return true;
}

function prepareInsertionIntention(
  projection: ReviewProjectionCursor,
  text: string,
): InsertionIntentionPreparation {
  const selection = projection.inspect({ kind: "selection" });
  const targetRefusal = getSelectionTargetRefusal(selection);
  if (targetRefusal !== null) {
    return { reason: targetRefusal, status: "refused" };
  }
  if (selection.status !== "available" || !selection.collapsed) {
    return {
      reason: refusal(
        "unsupported-target",
        "Insertion requires one collapsed accepted-side caret.",
      ),
      status: "refused",
    };
  }
  if (
    selection.anchor.association === "draft-insertion" &&
    selection.insertionDraft.target !== null
  ) {
    return {
      status: "ready",
      value: {
        format: selection.anchor.format,
        target: selection.insertionDraft.target,
        text,
      },
    };
  }
  if (selection.anchor.association !== "accepted") {
    return {
      reason: refusal(
        "proposal-side-target",
        "Finalized proposal content is not an accepted-side target.",
      ),
      status: "refused",
    };
  }
  if (selection.anchor.accepted === null) {
    return {
      reason: refusal(
        "unsupported-target",
        "The selection does not identify a supported paragraph target.",
      ),
      status: "refused",
    };
  }
  return {
    status: "ready",
    value: {
      format: selection.anchor.format,
      target: selection.anchor.accepted,
      text,
    },
  };
}

function prepareDeletionIntention(
  projection: ReviewProjectionCursor,
  isBackward: boolean,
  granularity: "word" | "character",
): DeletionIntentionPreparation {
  const nativeSelection = $getSelection();
  if (!$isRangeSelection(nativeSelection)) {
    return {
      reason: refusal(
        "unsupported-target",
        "Deletion requires one supported range selection.",
      ),
      status: "refused",
    };
  }

  const snapshot = snapshotSelection(nativeSelection);
  const wasCollapsed = nativeSelection.isCollapsed();
  let selection = projection.inspect({ kind: "selection" });
  if (selection.status !== "available") {
    return {
      reason: refusal(
        "unsupported-target",
        "Deletion requires one supported range selection.",
      ),
      status: "refused",
    };
  }
  const initialPoint = wasCollapsed ? selection.anchor.accepted : null;
  if (
    selection.selected.finalizedProposal ||
    (selection.collapsed &&
      (selection.anchor.association === "proposal-insertion" ||
        selection.anchor.association === "proposal-deletion"))
  ) {
    return {
      reason: refusal(
        selection.collapsed
          ? "proposal-side-target"
          : "finalized-proposal-intersection",
        selection.collapsed
          ? "Finalized proposal content is not an accepted-side target."
          : "The selection intersects finalized proposal content.",
      ),
      status: "refused",
    };
  }

  if (wasCollapsed) {
    const adjacent = isBackward
      ? selection.deletionDraft.adjacentBackward
      : selection.deletionDraft.adjacentForward;
    if (initialPoint !== null && adjacent) {
      return {
        status: "ready",
        value: {
          direction: isBackward ? "backward" : "forward",
          target: { end: initialPoint, start: initialPoint },
        },
      };
    }
    if (
      selection.deletionDraft.inside &&
      selection.deletionDraft.target !== null
    ) {
      return {
        status: "ready",
        value: {
          direction: isBackward ? "backward" : "forward",
          target: selection.deletionDraft.target,
        },
      };
    }
    try {
      projection.reconcile({
        kind: "place-selection",
        target: { isBackward, kind: "deletion-native-continuation" },
      });
      nativeSelection.modify("extend", isBackward, granularity);
      selection = projection.inspect({ kind: "selection" });
    } catch {
      restoreSelectionSnapshot(snapshot);
      return {
        reason: refusal(
          "deletion-target-unavailable",
          "The native selection could not resolve the deletion target.",
        ),
        status: "refused",
      };
    }
  }

  if (selection.status !== "available") {
    restoreSelectionSnapshot(snapshot);
    return {
      reason: refusal(
        "unsupported-target",
        "Deletion requires one supported range selection.",
      ),
      status: "refused",
    };
  }
  if (selection.selected.finalizedProposal) {
    restoreSelectionSnapshot(snapshot);
    return {
      reason: refusal(
        "finalized-proposal-intersection",
        "The selection intersects finalized proposal content.",
      ),
      status: "refused",
    };
  }
  if (selection.selected.draftDeletion) {
    const { anchor, focus } = selection;
    if (
      !selection.collapsed &&
      anchor.accepted !== null &&
      focus.accepted !== null &&
      anchor.accepted.paragraph === focus.accepted.paragraph &&
      anchor.accepted.offset !== focus.accepted.offset
    ) {
      const start =
        anchor.accepted.offset <= focus.accepted.offset
          ? anchor.accepted
          : focus.accepted;
      const end =
        anchor.accepted.offset <= focus.accepted.offset
          ? focus.accepted
          : anchor.accepted;
      return {
        status: "ready",
        value: { direction: "range", target: { end, start } },
      };
    }
    restoreSelectionSnapshot(snapshot);
    if (initialPoint === null) {
      return {
        reason: refusal(
          "unsupported-target",
          "The deletion caret does not identify accepted content.",
        ),
        status: "refused",
      };
    }
    return {
      status: "ready",
      value: {
        direction: isBackward ? "backward" : "forward",
        target: { end: initialPoint, start: initialPoint },
      },
    };
  }
  if (
    selection.insertionDraft.selection !== null &&
    selection.insertionDraft.target !== null
  ) {
    return {
      status: "ready",
      value: {
        direction: isBackward ? "backward" : "forward",
        draftSelection: {
          ...selection.insertionDraft.selection,
          kind: "insertion",
        },
        target: {
          end: selection.insertionDraft.target,
          start: selection.insertionDraft.target,
        },
      },
    };
  }
  if (selection.selected.draftInsertion) {
    restoreSelectionSnapshot(snapshot);
    return {
      reason: refusal(
        "unsupported-target",
        "A deletion range may not mix insertion-draft and accepted content.",
      ),
      status: "refused",
    };
  }
  const { anchor, focus } = selection;
  if (
    anchor.accepted === null ||
    focus.accepted === null ||
    anchor.accepted.paragraph !== focus.accepted.paragraph
  ) {
    restoreSelectionSnapshot(snapshot);
    return {
      reason: refusal(
        "unsupported-target",
        "Deletion supports one same-paragraph accepted-state range.",
      ),
      status: "refused",
    };
  }
  const start =
    anchor.accepted.offset <= focus.accepted.offset
      ? anchor.accepted
      : focus.accepted;
  const end =
    anchor.accepted.offset <= focus.accepted.offset
      ? focus.accepted
      : anchor.accepted;
  return {
    status: "ready",
    value: {
      direction: wasCollapsed ? (isBackward ? "backward" : "forward") : "range",
      target: { end, start },
    },
  };
}

const UNSUPPORTED_DELETION: ReviewRefusal = {
  code: "unsupported-deletion",
  message: "Deletion authoring is not supported by this review session yet.",
};
const UNSUPPORTED_FORMATTING: ReviewRefusal = {
  code: "unsupported-formatting",
  message: "Formatting authoring is not supported by this review session yet.",
};
const UNSUPPORTED_STRUCTURE: ReviewRefusal = {
  code: "unsupported-structure",
  message:
    "Paragraph structure authoring is not supported by this review session yet.",
};
const UNSUPPORTED_TRANSFER: ReviewRefusal = {
  code: "unsupported-transfer",
  message: "Content transfer is not supported by this review session yet.",
};

export type ReviewSessionRegistrationOptions = Readonly<{
  onDeletionOutcome?: (outcome: ReviewOutcome<ReviewStateView>) => void;
  onInsertionOutcome?: (outcome: ReviewOutcome<ReviewStateView>) => void;
  onOutcome?: (outcome: ReviewOutcome<ReviewStateView>) => void;
}>;

function registerLegacyReviewSession(
  editor: LexicalEditor,
  session: LegacyReviewSession,
  options: ReviewSessionRegistrationOptions = {},
): () => void {
  const report = (outcome: ReviewOutcome<ReviewStateView>): void => {
    options.onOutcome?.(outcome);
  };
  const refuse = (fallback: ReviewRefusal): ReviewRefusal => {
    const reason = getUnsupportedIntentionRefusal(fallback);
    report({
      reason,
      status: "refused",
    });
    return reason;
  };
  const refuseDeletion = () => {
    const reason = refuse(UNSUPPORTED_DELETION);
    options.onDeletionOutcome?.({ reason, status: "refused" });
    return true;
  };
  const handleDeletion = (
    isBackward: boolean,
    granularity: "word" | "character",
    event?: Event | null,
  ): boolean => {
    event?.preventDefault();
    const selectionBefore = getSelectionSnapshot();
    const prepared = prepareDeletionIntention(
      $createReviewProjection(),
      isBackward,
      granularity,
    );
    if (prepared.status === "refused") {
      report(prepared);
      options.onDeletionOutcome?.(prepared);
      return true;
    }
    queueMicrotask(() => {
      const outcome = session.deleteText(prepared.value);
      report(outcome);
      options.onDeletionOutcome?.(outcome);
      if (outcome.status === "changed") {
        editor.update(
          () => {
            if (prepared.value.draftSelection !== undefined) {
              $createReviewProjection().reconcile({
                kind: "place-selection",
                target: {
                  kind: "insertion-draft-offset",
                  offset: prepared.value.draftSelection.start,
                },
              });
            } else {
              $createReviewProjection().reconcile({
                kind: "place-selection",
                target: {
                  direction: prepared.value.direction ?? "range",
                  kind: "deletion-draft-continuation",
                },
              });
            }
          },
          { discrete: true },
        );
      } else if (selectionBefore !== null) {
        editor.update(() => restoreSelectionSnapshot(selectionBefore), {
          discrete: true,
        });
      }
    });
    return true;
  };
  const handleBeforeInput = (event: InputEvent): boolean => {
    if (event.inputType !== "deleteContentForward") {
      return false;
    }
    return handleDeletion(false, "character", event);
  };
  const refuseStructure = () => {
    refuse(UNSUPPORTED_STRUCTURE);
    return true;
  };
  const refuseTransfer = (event: Event | null) => {
    event?.preventDefault();
    refuse(UNSUPPORTED_TRANSFER);
    return true;
  };
  const handleFormatting = () => {
    const reason = getUnsupportedIntentionRefusal(UNSUPPORTED_FORMATTING);
    if (reason === UNSUPPORTED_FORMATTING) {
      return false;
    }
    report({ reason, status: "refused" });
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
        const prepared = prepareInsertionIntention(
          $createReviewProjection(),
          text,
        );
        if (prepared.status === "refused") {
          report(prepared);
          options.onInsertionOutcome?.(prepared);
          return true;
        }
        queueMicrotask(() => {
          const outcome = session.insertText(prepared.value);
          report(outcome);
          options.onInsertionOutcome?.(outcome);
          if (outcome.status === "changed") {
            editor.update(
              () => {
                $createReviewProjection().reconcile({
                  kind: "place-selection",
                  target: { kind: "insertion-draft-end" },
                });
              },
              { discrete: true },
            );
          }
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (isBackward) => handleDeletion(isBackward, "character"),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_WORD_COMMAND,
      (isBackward) => handleDeletion(isBackward, "word"),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      REMOVE_TEXT_COMMAND,
      (event) => handleDeletion(false, "character", event),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_LINE_COMMAND,
      refuseDeletion,
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
      FORMAT_TEXT_COMMAND,
      handleFormatting,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      SET_TEXT_FORMAT_COMMAND,
      handleFormatting,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      refuseStructure,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      PASTE_COMMAND,
      refuseTransfer,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(DROP_COMMAND, refuseTransfer, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(CUT_COMMAND, refuseTransfer, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(
      INSERT_LINE_BREAK_COMMAND,
      refuseStructure,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        event?.preventDefault();
        refuse(UNSUPPORTED_STRUCTURE);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}

function isLegacyReviewSession(
  session: LegacyReviewSession | NodeBackedReviewSession,
): session is LegacyReviewSession {
  return "readState" in session && typeof session.readState === "function";
}

export function registerReviewSession(
  editor: LexicalEditor,
  session: LegacyReviewSession,
  options?: ReviewSessionRegistrationOptions,
): () => void;
export function registerReviewSession(
  editor: LexicalEditor,
  session: NodeBackedReviewSession,
  options?: NodeBackedReviewSessionRegistrationOptions,
): () => void;
export function registerReviewSession(
  editor: LexicalEditor,
  session: LegacyReviewSession | NodeBackedReviewSession,
  options:
    | ReviewSessionRegistrationOptions
    | NodeBackedReviewSessionRegistrationOptions = {},
): () => void {
  if (isLegacyReviewSession(session)) {
    return registerLegacyReviewSession(
      editor,
      session,
      options as ReviewSessionRegistrationOptions,
    );
  }
  return registerNodeBackedReviewSession(
    editor,
    session,
    options as NodeBackedReviewSessionRegistrationOptions,
  );
}
