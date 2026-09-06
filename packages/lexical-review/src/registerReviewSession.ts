import { $insertReviewFragment, type ReviewFragment } from "./ReviewFragment";
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
  const handleDeletion = (
    backward: boolean,
    event?: Event | null,
    granularity: "character" | "word" = "character",
  ): boolean => {
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    event?.preventDefault();
    const outcome = $deleteReviewText(backward, { ...options, granularity });
    reportOutcome(options, outcome, "deletion");
    return true;
  };
  const handleSplit = (event?: Event | null): boolean => {
    event?.preventDefault();
    if (event && handledEvents.has(event)) return true;
    if (event) handledEvents.add(event);
    reportOutcome(options, $splitReviewParagraph(options), null);
    return true;
  };
  const handleBeforeInput = (event: InputEvent): boolean => {
    if (event.inputType === "insertParagraph") return handleSplit(event);
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
  const handleRemoval = (event: InputEvent | null): boolean => {
    if (event !== null) {
      if (
        event.inputType === "deleteByCut" ||
        event.inputType === "deleteByDrag"
      ) {
        return refuseTransfer(event);
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
    editor.registerCommand(CUT_COMMAND, refuseTransfer, COMMAND_PRIORITY_HIGH),
  );
}
