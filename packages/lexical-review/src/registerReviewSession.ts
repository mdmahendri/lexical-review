import { $insertReviewFragment, type ReviewFragment } from "./ReviewFragment";
import { createReviewCompositionLifecycle } from "./ReviewComposition";
import { classifyTransferInput } from "./ReviewTransferPolicy";
import {
  $copyReviewSelection,
  $cutReviewSelection,
  type ReviewCopyProjectionMode,
} from "./ReviewClipboard";
import { $dropReviewSelection, $pasteReviewSelection } from "./ReviewPaste";
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
import {
  $resolveReviewProposals,
  type ProposalResolutionAction,
} from "./ReviewResolution";
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

/**
 * Route payload for settling pending proposals through the client session
 * (#68). One call carries exactly one action; the handler forwards
 * `(ids, action)` to `$resolveReviewProposals` unchanged and reports its
 * outcome via `onOutcome`. It adds routing and claiming only: no reordering,
 * no refusal remapping, no focus or scroll side effects. Dispatch inside a
 * Lexical update like the other root operations, or bare like the editing
 * commands; either way the handler runs the same semantic call.
 */
export type ReviewResolutionRoutePayload = Readonly<{
  ids: readonly string[];
  action: ProposalResolutionAction;
}>;

export const RESOLVE_REVIEW_PROPOSALS_COMMAND =
  createCommand<ReviewResolutionRoutePayload>(
    "RESOLVE_REVIEW_PROPOSALS_COMMAND",
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
  // #64 composition lifecycle (snapshot, completion deduplication,
  // restoration, trailing Enter suppression) lives behind this seam; no
  // composition state is shared with the handlers below.
  const composition = createReviewCompositionLifecycle({
    editor,
    handledEvents,
    options,
    report: (outcome, kind) => reportOutcome(options, outcome, kind),
  });
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
    // One physical action is claimed once even when Lexical bridges the same
    // event object across commands (e.g. BEFORE_INPUT into a CONTROLLED or
    // core fallback dispatch). Distinct event objects from one gesture are
    // ordered by the platform instead: keydown preventDefault suppresses the
    // paired beforeinput, and returning true here suppresses Lexical's own
    // CONTROLLED/core follow-ups.
    if (handledEvents.has(event)) return true;
    // Intermediate composition input (insertCompositionText and friends) is
    // adapter state owned by Lexical/the browser; the single review intention
    // is derived at completion. insertFromComposition reaches us through
    // CONTROLLED_TEXT_INSERTION_COMMAND after core handling.
    if (editor.isComposing()) return false;
    if (event.inputType === "insertParagraph") return handleSplit(event);
    const transferInput = classifyTransferInput("beforeinput", event);
    if (transferInput.kind === "suppress") return suppressTransferRoute(event);
    if (event.inputType === "insertLineBreak") {
      event.preventDefault();
      handledEvents.add(event);
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
      handledEvents.add(event);
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
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
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
    // The owning gesture route reports the single outcome (see
    // ReviewTransferPolicy); the follow-up half is claimed silently here so
    // no second outcome is reported and native fallback mutation is
    // suppressed.
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
  const handlePaste = (event?: Event | null): boolean => {
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    reportOutcome(
      options,
      $pasteReviewSelection(event, options) as unknown as ReviewIntentOutcome,
      "insertion",
    );
    return true;
  };
  const handleDrop = (event?: Event | null): boolean => {
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    reportOutcome(
      options,
      $dropReviewSelection(event, options) as unknown as ReviewIntentOutcome,
      "insertion",
    );
    return true;
  };
  const handleRemoval = (event: InputEvent | null): boolean => {
    if (event !== null) {
      if (handledEvents.has(event)) return true;
      const transferInput = classifyTransferInput("removal", event);
      if (transferInput.kind === "suppress")
        return suppressTransferRoute(event);
      event.preventDefault();
      handledEvents.add(event);
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
      composition.snapshotCompositionStart,
      COMMAND_PRIORITY_CRITICAL,
    ),
    editor.registerCommand(
      COMPOSITION_END_COMMAND,
      (event) =>
        composition.recordCompositionEnd(
          event && typeof event.data === "string" ? event.data : "",
        ),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerUpdateListener(composition.normalizeCompletedComposition),
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
    editor.registerCommand(
      RESOLVE_REVIEW_PROPOSALS_COMMAND,
      (payload) => {
        const outcome =
          payload === null ||
          typeof payload !== "object" ||
          (payload.action !== "accept" &&
            payload.action !== "reject" &&
            payload.action !== "remove")
            ? unsupportedOutcome(
                "unsupported-input",
                "Resolution commands carry exactly one action: accept, reject, or remove.",
              )
            : $resolveReviewProposals(payload.ids, payload.action);
        reportOutcome(options, outcome, null);
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
        if (typeof eventOrText !== "string" && handledEvents.has(eventOrText))
          return true;
        if (
          typeof eventOrText !== "string" &&
          eventOrText.inputType === "insertFromComposition"
        ) {
          return composition.recordCompositionInsertion(eventOrText);
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
        if (typeof eventOrText !== "string") {
          const transferInput = classifyTransferInput(
            "controlled",
            eventOrText,
          );
          if (transferInput.kind === "suppress")
            return suppressTransferRoute(eventOrText);
          if (transferInput.kind === "refuse") {
            handledEvents.add(eventOrText);
            return refuseTransfer(eventOrText);
          }
        }
        const text =
          typeof eventOrText === "string" ? eventOrText : eventOrText.data;
        if (text == null) {
          return false;
        }
        if (typeof eventOrText !== "string") handledEvents.add(eventOrText);
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
        if (composition.consumeTrailingEnter(event)) return true;
        if (editor.isComposing()) return false;
        event?.preventDefault();
        return event?.shiftKey ? refuseStructure() : handleSplit(event);
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(PASTE_COMMAND, handlePaste, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(DROP_COMMAND, handleDrop, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(COPY_COMMAND, handleCopy, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(CUT_COMMAND, handleCut, COMMAND_PRIORITY_HIGH),
  );
}
