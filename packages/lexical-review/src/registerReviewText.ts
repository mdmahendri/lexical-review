import {
  $getSelection,
  $isRangeSelection,
  BEFORE_INPUT_COMMAND,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_EDITOR,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  COPY_COMMAND,
  PASTE_COMMAND,
  KEY_ENTER_COMMAND,
  LexicalEditor,
  TextNode,
} from "lexical";
import { copyToClipboard } from "@lexical/clipboard";
import { mergeRegister, objectKlassEquals } from "@lexical/utils";
import { $markForDelete, $markPasteInsert, $markTypingInsert } from "./ReviewSelection";
import {
  $createReviewTextNode,
  $isReviewTextNode,
  ReviewTextNode,
} from "./ReviewTextNode";

function $canReviewTextNodesBeMerged(
  node1: ReviewTextNode,
  node2: ReviewTextNode
): boolean {
  return node1.__review == node2.__review;
}

function $mergeReviewTextNodes(
  node1: ReviewTextNode,
  node2: ReviewTextNode
): ReviewTextNode {
  const writableNode1 = node1.mergeWithSibling(node2);
  return writableNode1 as ReviewTextNode;
}

function $normalizeReviewTextNode(textNode: ReviewTextNode): void {
  let node = textNode;

  if (node.__text === "") {
    node.remove();
    return;
  }

  let previousNode;
  while (
    (previousNode = node.getPreviousSibling()) !== null &&
    $isReviewTextNode(previousNode)
  ) {
    if (previousNode.__text === "") {
      previousNode.remove();
    } else if ($canReviewTextNodesBeMerged(previousNode, node)) {
      node = $mergeReviewTextNodes(previousNode, node);
      break;
    } else {
      break;
    }
  }

  let nextNode;
  while (
    (nextNode = node.getNextSibling()) !== null &&
    $isReviewTextNode(nextNode)
  ) {
    if (nextNode.__text === "") {
      nextNode.remove();
    } else if ($canReviewTextNodesBeMerged(node, nextNode)) {
      node = $mergeReviewTextNodes(node, nextNode);
      break;
    } else {
      break;
    }
  }
}

function $normalizeTextNodeToReviewTextNode(node: TextNode): void {
  // Review mode is editor-wide. Convert text introduced through a Lexical
  // API into an original review node before it can be edited normally.
  if ($isReviewTextNode(node)) {
    return;
  }

  const reviewNode = $createReviewTextNode(node.getTextContent(), "original");
  reviewNode.setFormat(node.getFormat());
  reviewNode.setDetail(node.getDetail());
  reviewNode.setMode(node.getMode());
  reviewNode.setStyle(node.getStyle());
  node.replace(reviewNode);
}

export function registerReviewText(
  editor: LexicalEditor,
  granularity: "word" | "character" = "character"
): () => void {
  if (!editor.hasNode(ReviewTextNode)) {
    throw new Error(
      "registerReviewText requires ReviewTextNode to be registered in the editor.",
    );
  }

  const removeListener = mergeRegister(
    editor.registerNodeTransform(TextNode, (node) => {
      $normalizeTextNodeToReviewTextNode(node);
    }),

    editor.registerNodeTransform(ReviewTextNode, (node) => {
      $normalizeReviewTextNode(node);
    }),

    editor.registerCommand(
      BEFORE_INPUT_COMMAND,
      (event) => {
        if (
          (event.inputType !== "insertText" &&
            event.inputType !== "insertTranspose") ||
          event.data == null ||
          event.data === "" ||
          event.data === "\n" ||
          event.data === "\r\n"
        ) {
          return false;
        }

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        event.preventDefault();
        return editor.dispatchCommand(
          CONTROLLED_TEXT_INSERTION_COMMAND,
          event.data,
        );
      },
      COMMAND_PRIORITY_LOW,
    ),

    editor.registerCommand(
      CONTROLLED_TEXT_INSERTION_COMMAND,
      (eventOrText) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        const text =
          typeof eventOrText === "string" ? eventOrText : eventOrText.data;
        if (text == null) {
          return false;
        }

        $markTypingInsert(selection, text);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),

    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (isBackward) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        $markForDelete(selection, isBackward, granularity);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),

    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        event.preventDefault();
        return editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true);
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        event.preventDefault();
        return editor.dispatchCommand(DELETE_CHARACTER_COMMAND, false);
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }
        selection.insertParagraph();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      COPY_COMMAND,
      (event) => {
        copyToClipboard(
          editor,
          objectKlassEquals(event, ClipboardEvent)
            ? (event as ClipboardEvent)
            : null
        );
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        event.preventDefault();
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const clipboardData = (event as ClipboardEvent).clipboardData;
        if (clipboardData && clipboardData.getData("text/plain")) {
          $markPasteInsert(clipboardData.getData("text/plain"));
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_EDITOR
    )
  );

  return removeListener;
}
