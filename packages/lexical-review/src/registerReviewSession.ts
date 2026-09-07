import { $insertReviewFragment, type ReviewFragment } from "./ReviewFragment";
import {
  $copyReviewSelection,
  $cutReviewSelection,
  type ReviewCopyProjectionMode,
} from "./ReviewClipboard";
import { registerReviewInputFormatting } from "./ReviewInputFormatting";
import {
  $setReviewFormatting,
  $toggleReviewFormatting,
  type ReviewFormattingProperty,
} from "./ReviewFormatting";
import { normalizeReviewElementNode } from "./ReviewNormalization";
import {
  createCommand,
  $getSelection,
  $isRangeSelection,
  BEFORE_INPUT_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  COPY_COMMAND,
  CUT_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  DROP_COMMAND,
  FORMAT_TEXT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  REMOVE_TEXT_COMMAND,
  SET_TEXT_FORMAT_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { ReviewDeletionNode, ReviewInsertionNode } from "./ReviewNodes";
import type { ReviewSession } from "./ReviewSession";
import {
  $deleteReviewText,
  $insertReviewText,
  $moveReviewCaret,
  $replaceReviewText,
  $splitReviewParagraph,
} from "./ReviewIntentDispatch";
import type { ReviewAuthoringOptions } from "./ReviewAuthoring";
import { validateStructuralState } from "./ReviewStructure";
import type {
  ReviewIntentOutcome,
  ReviewIntentRefusalCode,
} from "./ReviewIntent";
export type {
  ReviewIntentError,
  ReviewIntentOutcome,
  ReviewIntentRefusal,
  ReviewIntentRefusalCode,
} from "./ReviewIntent";
export type { ReviewProposalIdFactory } from "./ReviewAuthoring";
export const INSERT_REVIEW_FRAGMENT_COMMAND = createCommand<ReviewFragment>(
  "INSERT_REVIEW_FRAGMENT_COMMAND",
);

export type ReviewSessionRegistrationOptions = ReviewAuthoringOptions &
  Readonly<{
    /**
     * Clipboard projection for ordinary copy/cut (#65). Defaults to
     * `"all-accepted"`; hosts may select `"accepted-state"` instead.
     */
    copyProjection?: ReviewCopyProjectionMode;
    onDeletionOutcome?: (outcome: ReviewIntentOutcome) => void;
    onInsertionOutcome?: (outcome: ReviewIntentOutcome) => void;
    onOutcome?: (outcome: ReviewIntentOutcome) => void;
  }>;

function unsupportedOutcome(
  code: ReviewIntentRefusalCode,
  message: string,
): ReviewIntentOutcome {
  return { code, message, status: "refused" };
}

function reportOutcome(
  options: ReviewSessionRegistrationOptions,
  outcome: ReviewIntentOutcome,
  kind: "deletion" | "insertion" | null,
): void {
  options.onOutcome?.(outcome);
  if (kind === "deletion") {
    options.onDeletionOutcome?.(outcome);
  } else if (kind === "insertion") {
    options.onInsertionOutcome?.(outcome);
  }
}

export function registerReviewSession(
  editor: LexicalEditor,
  session: ReviewSession,
  options: ReviewSessionRegistrationOptions = {},
): () => void {
  if (session.getEditorState() !== editor.getEditorState()) {
    throw new Error(
      "A node-backed review session must be registered with the same Lexical editor that opened it.",
    );
  }
  const handledEvents = new WeakSet<Event>();
  // #64 composition adapter state. Intermediate native DOM mutations during
  // composition carry no proposal identity; the pre-composition EditorState is
  // snapshotted on COMPOSITION_START and a single semantic intention is
  // applied from snapshot plus committed data once composition ends.
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
        reportOutcome(
          options,
          unsupportedOutcome(
            "unsupported-input",
            "Composition commits support inline text only; paragraph breaks are refused without mutation.",
          ),
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
          reportOutcome(
            options,
            { status: "unchanged", value: undefined },
            null,
          );
          return;
        }
        editor.update(
          () => {
            reportOutcome(
              options,
              $deleteReviewText(false, options),
              "deletion",
            );
          },
          { discrete: true },
        );
        return;
      }
      editor.setEditorState(snapshot);
      editor.update(
        () => {
          const structural = validateStructuralState();
          reportOutcome(
            options,
            structural ?? $insertReviewText(data, options),
            "insertion",
          );
        },
        { discrete: true },
      );
    } catch (cause) {
      try {
        editor.setEditorState(snapshot);
      } catch {
        // Preserve the live state when even the snapshot restore fails.
      }
      reportOutcome(
        options,
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
  const handleDeletion = (
    backward: boolean,
    event?: Event | null,
    granularity: "character" | "word" = "character",
  ): boolean => {
    if (editor.isComposing()) return false;
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    event?.preventDefault();
    const outcome = $deleteReviewText(backward, { ...options, granularity });
    reportOutcome(options, outcome, "deletion");
    return true;
  };
  const handleSplit = (event?: Event | null): boolean => {
    if (editor.isComposing()) return false;
    event?.preventDefault();
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    reportOutcome(options, $splitReviewParagraph(options), null);
    return true;
  };
  const handleBeforeInput = (event: InputEvent): boolean => {
    // Intermediate composition input (insertCompositionText and friends) is
    // adapter state owned by Lexical/the browser; the single review intention
    // is derived at completion. insertFromComposition reaches us through
    // CONTROLLED_TEXT_INSERTION_COMMAND after core handling.
    if (editor.isComposing()) return false;
    if (event.inputType === "insertParagraph") return handleSplit(event);
    if (
      event.inputType === "deleteByCut" ||
      event.inputType === "deleteByDrag"
    ) {
      return suppressTransferRoute(event);
    }
    if (event.inputType === "insertLineBreak") {
      event.preventDefault();
      return refuseStructure();
    }
    if (
      (event.inputType === "insertText" ||
        event.inputType === "insertReplacementText") &&
      !event.isComposing &&
      event.data !== null &&
      event.dataTransfer == null
    ) {
      event.preventDefault();
      if (!handledEvents.has(event)) {
        handledEvents.add(event);
        const operation =
          event.inputType === "insertReplacementText"
            ? $replaceReviewText
            : $insertReviewText;
        reportOutcome(options, operation(event.data, options), "insertion");
      }
      return true;
    }
    if (event.inputType === "deleteContentBackward") {
      return handleDeletion(true, event);
    }
    if (event.inputType === "deleteContentForward") {
      return handleDeletion(false, event);
    }
    if (
      event.inputType === "deleteWordBackward" ||
      event.inputType === "deleteWordForward"
    )
      return handleDeletion(
        event.inputType === "deleteWordBackward",
        event,
        "word",
      );
    const formatting: Record<string, ReviewFormattingProperty> = {
      formatBold: "bold",
      formatItalic: "italic",
      formatUnderline: "underline",
      formatStrikeThrough: "strikethrough",
    };
    const property = formatting[event.inputType];
    if (property) {
      event.preventDefault();
      if (!handledEvents.has(event)) {
        handledEvents.add(event);
        reportOutcome(
          options,
          $toggleReviewFormatting(property, options),
          null,
        );
      }
      return true;
    }
    if (event.inputType.startsWith("format")) {
      event.preventDefault();
      reportOutcome(
        options,
        unsupportedOutcome(
          "unsupported-formatting",
          "Unsupported native formatting property.",
        ),
        null,
      );
      return true;
    }
    return false;
  };
  const refuseDeletionGranularity = (event?: KeyboardEvent | null): boolean => {
    event?.preventDefault();
    reportOutcome(
      options,
      unsupportedOutcome(
        "unsupported-target",
        "Review deletion supports character, word, and explicit range intentions; line deletion is unsupported.",
      ),
      "deletion",
    );
    return true;
  };
  const refuseStructure = (): boolean => {
    reportOutcome(
      options,
      unsupportedOutcome(
        "unsupported-structure",
        "Soft line breaks are unsupported in review mode.",
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
  const suppressTransferRoute = (event?: Event | null): boolean => {
    // #65: the cut/drop gesture owns its single outcome at CUT/DROP_COMMAND,
    // the only routes carrying clipboard data. The deletion half of the same
    // physical gesture is claimed silently here so no second outcome is
    // reported and native fallback mutation is suppressed.
    event?.preventDefault();
    if (event) handledEvents.add(event);
    return true;
  };
  const clipboardMode = (): ReviewCopyProjectionMode =>
    options.copyProjection ?? "all-accepted";
  const handleCopy = (event?: Event | null): boolean => {
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    reportOutcome(
      options,
      $copyReviewSelection(event, {
        ...options,
        mode: clipboardMode(),
      }) as unknown as ReviewIntentOutcome,
      null,
    );
    return true;
  };
  const handleCut = (event?: Event | null): boolean => {
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    reportOutcome(
      options,
      $cutReviewSelection(event, {
        ...options,
        mode: clipboardMode(),
      }) as unknown as ReviewIntentOutcome,
      null,
    );
    return true;
  };
  const handleRemoval = (event: InputEvent | null): boolean => {
    if (event !== null) {
      if (
        event.inputType === "deleteByCut" ||
        event.inputType === "deleteByDrag"
      ) {
        return suppressTransferRoute(event);
      }
      event.preventDefault();
      reportOutcome(
        options,
        unsupportedOutcome(
          "unsupported-input",
          "This native text-removal route is not supported by the node-backed review session.",
        ),
        "deletion",
      );
      return true;
    }
    const selection = $getSelection();
    if ($isRangeSelection(selection) && selection.isCollapsed()) {
      reportOutcome(
        options,
        { status: "unchanged", value: undefined },
        "deletion",
      );
      return true;
    }
    return handleDeletion(false);
  };

  const normalizationRegistrations: Array<() => void> = [];
  if (editor.hasNode(ReviewInsertionNode)) {
    normalizationRegistrations.push(
      editor.registerNodeTransform(ReviewInsertionNode, (node) => {
        normalizeReviewElementNode(node);
      }),
    );
  }
  if (editor.hasNode(ReviewDeletionNode)) {
    normalizationRegistrations.push(
      editor.registerNodeTransform(ReviewDeletionNode, (node) => {
        normalizeReviewElementNode(node);
      }),
    );
  }

  return mergeRegister(
    registerReviewInputFormatting(editor),
    editor.registerCommand(
      COMPOSITION_START_COMMAND,
      snapshotCompositionStart,
      COMMAND_PRIORITY_CRITICAL,
    ),
    editor.registerCommand(
      COMPOSITION_END_COMMAND,
      (event) =>
        recordCompositionEnd(
          event && typeof event.data === "string" ? event.data : "",
        ),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerUpdateListener(normalizeCompletedComposition),
    editor.registerCommand(
      INSERT_REVIEW_FRAGMENT_COMMAND,
      (fragment) => {
        reportOutcome(
          options,
          $insertReviewFragment(fragment, options),
          "insertion",
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    ...([KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND] as const).map(
      (command, index) =>
        editor.registerCommand(
          command,
          (event) => {
            if (
              event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return false;
            if (!$moveReviewCaret(index === 0)) return false;
            event.preventDefault();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
    ),
    ...normalizationRegistrations,
    editor.registerCommand(
      BEFORE_INPUT_COMMAND,
      handleBeforeInput,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      CONTROLLED_TEXT_INSERTION_COMMAND,
      (eventOrText) => {
        if (
          typeof eventOrText !== "string" &&
          eventOrText.inputType === "insertFromComposition"
        ) {
          return recordCompositionInsertion(eventOrText);
        }
        if (editor.isComposing()) {
          // Lexical composition anchoring (COMPOSITION_START_CHAR): raw
          // adapter state, never a proposal and never an outcome. The single
          // review intention is normalized at completion.
          if (typeof eventOrText === "string") {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertText(eventOrText);
            return true;
          }
          return false;
        }
        if (
          typeof eventOrText !== "string" &&
          (eventOrText.dataTransfer != null ||
            eventOrText.inputType === "insertFromDrop" ||
            eventOrText.inputType === "insertFromYank")
        ) {
          return refuseTransfer(eventOrText);
        }
        const text =
          typeof eventOrText === "string" ? eventOrText : eventOrText.data;
        if (text == null) {
          return false;
        }
        const outcome =
          typeof eventOrText !== "string" &&
          eventOrText.inputType === "insertReplacementText"
            ? $replaceReviewText(text, options)
            : $insertReviewText(text, options);
        reportOutcome(options, outcome, "insertion");
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (backward) => handleDeletion(backward),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_WORD_COMMAND,
      (backward) => handleDeletion(backward, null, "word"),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      REMOVE_TEXT_COMMAND,
      handleRemoval,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) =>
        event?.metaKey
          ? refuseDeletionGranularity(event)
          : handleDeletion(
              true,
              event,
              event?.ctrlKey || event?.altKey ? "word" : "character",
            ),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) =>
        event?.metaKey
          ? refuseDeletionGranularity(event)
          : handleDeletion(
              false,
              event,
              event?.ctrlKey || event?.altKey ? "word" : "character",
            ),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DELETE_LINE_COMMAND,
      () => refuseDeletionGranularity(),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      (property) => {
        if (editor.isComposing()) return false;
        reportOutcome(
          options,
          $toggleReviewFormatting(
            property as ReviewFormattingProperty,
            options,
          ),
          null,
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      SET_TEXT_FORMAT_COMMAND,
      (change) => {
        if (editor.isComposing()) return false;
        reportOutcome(options, $setReviewFormatting(change, options), null);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => handleSplit(),
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
        if (compositionEnterArmed) {
          // Trailing-newline dispatch from Lexical's composition-end path is
          // part of the same physical commit. Claim silently: the single
          // composition outcome (refusal) is reported by the normalizer.
          event?.preventDefault();
          return true;
        }
        if (editor.isComposing()) return false;
        event?.preventDefault();
        return event?.shiftKey ? refuseStructure() : handleSplit(event);
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      PASTE_COMMAND,
      refuseTransfer,
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(DROP_COMMAND, refuseTransfer, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(COPY_COMMAND, handleCopy, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(CUT_COMMAND, handleCut, COMMAND_PRIORITY_HIGH),
  );
}
