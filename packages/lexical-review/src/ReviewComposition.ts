/**
 * Composition lifecycle for the client review session (#64).
 *
 * Intermediate native DOM mutations during text composition carry no
 * revision-proposal identity; the pre-composition editor state is snapshotted
 * on composition start and a single review intent is applied from snapshot
 * plus committed data once composition ends.
 *
 * This module owns the whole lifecycle: snapshot capture, completion
 * deduplication (first completion wins across compositionend and Safari's
 * insertFromComposition), snapshot restoration, and trailing Enter
 * suppression. No composition state crosses the registration seam, so the
 * remaining handlers keep no ordering assumptions about it; they only route
 * their composition events here and ask whether a trailing Enter belongs to
 * a completed commit.
 */
import {
  $getSelection,
  $isRangeSelection,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import type { ReviewAuthoringOptions } from "./ReviewAuthoring";
import type { ReviewIntentOutcome } from "./ReviewIntent";
import { $deleteReviewText, $insertReviewText } from "./ReviewIntentDispatch";
import { validateStructuralState } from "./ReviewStructure";

export type ReviewCompositionReporter = (
  outcome: ReviewIntentOutcome,
  kind: "deletion" | "insertion" | null,
) => void;

export type ReviewCompositionLifecycle = Readonly<{
  snapshotCompositionStart: () => boolean;
  recordCompositionEnd: (data: string) => boolean;
  recordCompositionInsertion: (event: InputEvent) => boolean;
  normalizeCompletedComposition: () => void;
  consumeTrailingEnter: (event: Event | null | undefined) => boolean;
}>;

export function createReviewCompositionLifecycle(args: {
  editor: LexicalEditor;
  options: ReviewAuthoringOptions;
  handledEvents: WeakSet<Event>;
  report: ReviewCompositionReporter;
}): ReviewCompositionLifecycle {
  const { editor, options, handledEvents, report } = args;
  let compositionSnapshot: EditorState | null = null;
  let pendingCompositionData: string | null = null;
  let compositionEnterArmed = false;
  let normalizingComposition = false;

  const snapshotCompositionStart = (): boolean => {
    compositionSnapshot = editor.getEditorState();
    pendingCompositionData = null;
    compositionEnterArmed = false;
    return false;
  };
  const recordCompositionEnd = (data: string): boolean => {
    // First completion wins; a trailing duplicate (e.g. Safari
    // insertFromComposition followed by compositionend) must not create a
    // second proposal. Always return false so Lexical clears its composition
    // key and provisional subclass state.
    if (pendingCompositionData === null) {
      pendingCompositionData = data;
      compositionEnterArmed = /[\r\n]/u.test(data);
    }
    return false;
  };
  const recordCompositionInsertion = (event: InputEvent): boolean => {
    if (handledEvents.has(event)) return true;
    handledEvents.add(event);
    // Safari commits via beforeinput insertFromComposition; claiming here
    // defers the single apply to the update listener below.
    if (pendingCompositionData === null) {
      const data = event.data ?? "";
      pendingCompositionData = data;
      compositionEnterArmed = /[\r\n]/u.test(data);
    }
    return true;
  };
  const normalizeCompletedComposition = (): void => {
    if (normalizingComposition) return;
    if (pendingCompositionData === null || compositionSnapshot === null) return;
    if (editor.isComposing()) return;
    const snapshot = compositionSnapshot;
    const data = pendingCompositionData;
    compositionSnapshot = null;
    pendingCompositionData = null;
    compositionEnterArmed = false;
    normalizingComposition = true;
    try {
      if (/[\r\n]/u.test(data)) {
        editor.setEditorState(snapshot);
        report(
          {
            code: "unsupported-input",
            message:
              "Composition commits support inline text only; paragraph breaks are refused without mutation.",
            status: "refused",
          },
          null,
        );
        return;
      }
      if (data === "") {
        const collapsed = snapshot.read(() => {
          const selection = $getSelection();
          return !$isRangeSelection(selection) || selection.isCollapsed();
        });
        editor.setEditorState(snapshot);
        if (collapsed) {
          report({ status: "unchanged", value: undefined }, null);
          return;
        }
        editor.update(
          () => {
            report($deleteReviewText(false, options), "deletion");
          },
          { discrete: true },
        );
        return;
      }
      editor.setEditorState(snapshot);
      editor.update(
        () => {
          const structural = validateStructuralState();
          report(structural ?? $insertReviewText(data, options), "insertion");
        },
        { discrete: true },
      );
    } catch (cause) {
      try {
        editor.setEditorState(snapshot);
      } catch {
        // Preserve the live state when even the snapshot restore fails.
      }
      report(
        {
          error: {
            cause,
            code: "composition-normalization-failed",
            message:
              cause instanceof Error
                ? cause.message
                : "Composition normalization failed.",
          },
          status: "failed",
        },
        null,
      );
    } finally {
      normalizingComposition = false;
    }
  };
  const consumeTrailingEnter = (event: Event | null | undefined): boolean => {
    // Trailing-newline dispatch from Lexical's composition-end path is part
    // of the same physical commit. Claim silently: the single composition
    // outcome (refusal) is reported by the normalizer.
    if (!compositionEnterArmed) return false;
    event?.preventDefault();
    return true;
  };

  return {
    consumeTrailingEnter,
    normalizeCompletedComposition,
    recordCompositionEnd,
    recordCompositionInsertion,
    snapshotCompositionStart,
  };
}
