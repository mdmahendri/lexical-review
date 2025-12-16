import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_DOWN_COMMAND,
  COPY_COMMAND,
  PASTE_COMMAND,
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_NORMAL,
} from "lexical";
import { LexicalEditor } from "lexical";
import { copyToClipboard } from "@lexical/clipboard";
import { mergeRegister, objectKlassEquals } from "@lexical/utils";
import { $markForDelete, $markPasteInsert, $markTypingInsert } from "./ReviewSelection";
import { $isReviewTextNode, ReviewTextNode } from "./ReviewTextNode";
import { ReviewTextPlugin } from "./LexicalReviewTextPlugin";

export { ReviewTextPlugin, ReviewTextNode };

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

  // const normalizedNodes = getActiveEditor()._normalizedNodes;

  // normalizedNodes.add(node1.__key);
  // normalizedNodes.add(node2.__key);
  return writableNode1 as ReviewTextNode;
}

function $normalizeReviewTextNode(textNode: ReviewTextNode): void {
  let node = textNode;

  if (node.__text === "") {
    node.remove();
    return;
  }

  // Backward
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

  // Forward
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

export function registerReviewText(editor: LexicalEditor, granularity: "word" | "character" = "character"): () => void {
  const removeListener = mergeRegister(
    // needed to merge sibling of the same review type
    editor.registerNodeTransform(ReviewTextNode, (node) => {
      $normalizeReviewTextNode(node);
    }),

    editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        const content = event.key;
        const acceptableKeys = /^[a-zA-Z0-9\s\n.,;:'"()\-!&*?/]$/;
        if (!acceptableKeys.test(content) || event.ctrlKey) {
          return false;
        }
        event.preventDefault();
        const selection = $getSelection();
        //insertion is not allowed while selection is not collapsed
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }
        $markTypingInsert(selection, content);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    /** this command does not work */
    // editor.registerCommand(
    //   CONTROLLED_TEXT_INSERTION_COMMAND,
    //   (eventOrString) => {

    //     const selection = $getSelection();
    //     //insertion is not allowed while selection is not collapsed
    //     if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    //       return false;
    //     }
    //     if (typeof eventOrString === 'string') {
    //       $markForInsertion(selection, eventOrString);
    //       return true;
    //     } else return false;
    //   },
    //   COMMAND_PRIORITY_EDITOR
    // ),

    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        event.preventDefault();

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }
        $markForDelete(selection, true, granularity);

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => {
        event.preventDefault();

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }
        $markForDelete(selection, false, granularity);

        return true;
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

        //insertion is not allowed while selection is not collapsed
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
