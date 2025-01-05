/**
 * we need to override behavior for some function from
 * RangeSelection and LexicalUpdate and Normalization
 */

import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  ElementNode,
  PointType,
  RangeSelection,
} from "lexical";
import {
  $createReviewTextNode,
  $isReviewTextNode,
  ReviewTextNode,
} from "./ReviewTextNode";

// perform delete according to node type
function nodeDeleteByReviewType(
  node: ReviewTextNode,
  offset: number,
  del: number,
  isBackward: boolean,
  moveSelection: boolean,
) {
  if (node.hasReviewType("insertion")) {
    // delete only part of text in <ins> tag
    node.deleteInsertionText(offset, del);
  } else if (node.hasReviewType("deletion")) {
    // a part of text in <del> tag is choosen to be deleted
    // undo the entire del tag and revert to original
    const delOrigNode = node.setReviewType("original");
    if (moveSelection) {
      if (isBackward) {
        delOrigNode.selectStart();
      } else {
        delOrigNode.selectEnd();
      }
    }
  } else {
    // share some similarity to insertion, but instead of
    // removing from editorState, mark it for deletion
    const reviewTextNodes = node.deleteOriginalText(offset, del);
    // the text deleted by user is always located on the second element of list
    const delMarkNode = reviewTextNodes[1];
    if (moveSelection && delMarkNode) {
      if (isBackward) {
        delMarkNode.selectStart();
      } else {
        delMarkNode.selectEnd();
      }
    }
  }
}

/**
 * mimic removeText()
 * we do not include block detect $getAncestor for element,
 * or handling for offset adjustment of token mode
 * since we are only dealing with normal text
 */
function suggestDeletion(selection: RangeSelection) {
  const { anchor, focus } = selection;
  const isBackward = selection.isBackward();
  const [firstPoint, lastPoint] = isBackward
    ? [focus, anchor]
    : [anchor, focus];
  const firstNode = firstPoint.getNode();
  const lastNode = lastPoint.getNode();

  // work on nodes between first and last node
  const selectedNodes = selection.getNodes();
  selectedNodes.forEach((node) => {
    if (
      $isReviewTextNode(node) &&
      node.getKey() !== firstNode.getKey() &&
      node.getKey() !== lastNode.getKey()
    ) {
      if (node.hasReviewType("original")) {
        node.setReviewType("deletion");
      } else if (node.hasReviewType("deletion")) {
        // a part of text in <del> tag is choosen to be deleted
        // undo the entire del tag and revert to original
        node.setReviewType("original");
      } else {
        // insertion in the middle, just remove it
        node.remove();
      }
      // we only allow paragraph delete for newly added insert.
      // for original, do not delete the paragraph - instead
      // delete entire text
    } else if ($isParagraphNode(node) && node.getChildrenSize() == 0) {
      node.remove();
    }
  });

  // make sure that no ParagraphNode is modified
  if ($isReviewTextNode(firstNode) && $isReviewTextNode(lastNode)) {
    // deleting occur in one single add, del, orig node
    if (firstNode == lastNode) {
      const del = Math.abs(focus.offset - anchor.offset);
      nodeDeleteByReviewType(
        firstNode,
        firstPoint.offset,
        del,
        isBackward,
        true,
      );

      return;
    }

    /**
     * handle deletion for the first !== last node
     * deleting occur in multiple combination of add, del, orig
     * 1st case: deleting a word which is part of orig and del
     * result: delete the whole word, so do nothing for del part
     * example: <del>cut in the mid</del>dle -> <del>cut in the middle</del>
     * or vice versa
     * 2nd case, ...
     * */
    if (firstNode !== lastNode) {
      const del = firstNode.getTextContentSize() - firstPoint.offset;
      // handle for first node

      // selection is done in word level for non insertion, this checks prevent
      // deletion of original node placed in the same word ex: mid<ins>dle</ins>
      // will be selected as a word, this will prevent marking mid as <del>mid</del>
      if (!firstNode.hasReviewType("original")) {
        nodeDeleteByReviewType(
          firstNode,
          firstPoint.offset,
          del,
          isBackward,
          false,
        );
      }

      // handle for last node
      nodeDeleteByReviewType(lastNode, 0, lastPoint.offset, isBackward, false);
    }
  }
}

// mimic deleteWord()
// TODO: resolve error when doing backspace at the start of the paragraph
export function $markForDelete(
  selection: RangeSelection,
  isBackward: boolean,
): void {
  if (selection.isCollapsed()) {
    const anchor = selection.anchor;
    const anchorNode = anchor.getNode() as ReviewTextNode | ElementNode;

    //different behavior only needed for insertion, to accomodate a typing error
    if (
      $isReviewTextNode(anchorNode) &&
      anchorNode.hasReviewType("insertion") &&
      isBackward
    ) {
      selection.modify("extend", isBackward, "character");
    } else {
      selection.modify("extend", isBackward, "word");
    }
  }

  suggestDeletion(selection);
}

function insertReviewTextNode(
  targetNode: ReviewTextNode,
  anchor: PointType,
  text: string,
): void {
  let newReviewTextNode = $createReviewTextNode(text, "insertion");
  // no need to check for inline parent, because we do not have
  // such thing, only parent of paragraph (not inline) is available.
  // this conditional enable insertion from the start of text node
  // of another type for example: inserting 'test' in <del>The</del>
  // will make it <ins>test</ins><del>The</del> not <del>testThe</de>
  if (anchor.offset === 0) {
    targetNode.insertBefore(newReviewTextNode);
    newReviewTextNode.selectEnd();

    // adding this for the similar reason to above conditional
  } else if (anchor.offset === targetNode.getTextContentSize()) {
    targetNode.insertAfter(newReviewTextNode);
    newReviewTextNode.selectEnd();

    // insertion in the middle of node, <orig>this is inside<orig>
    // of text 'not' become <orig>this is</orig><ins>not</ins>
    // <orig> inside</orig>
    // there is no <orig> it just to show demo
  } else {
    newReviewTextNode = targetNode.insertBetweenAddOrOrig(anchor.offset, text);
    if (targetNode.hasReviewType("original")) {
      newReviewTextNode.selectEnd();
    } else {
      const newOffset = anchor.offset + text.length;
      newReviewTextNode.select(newOffset, newOffset);
    }
  }
}

// mimic $insertDataTransferForRichText but only for text/plain
export function $markPasteInsert(text: string): void {
  if (text != null) {
    const parts = text.split(/\r?\n/);
    if (parts[parts.length - 1] === "") {
      parts.pop();
    }
    for (let i = 0; i < parts.length; i++) {
      const currentSelection = $getSelection();
      if ($isRangeSelection(currentSelection)) {
        const part = parts[i];
        if (part === "\n" || part === "\r\n") {
          currentSelection.insertParagraph();
        } else {
          const newReviewTextNode = $createReviewTextNode(part, "insertion");
          currentSelection.insertNodes([newReviewTextNode]);
          newReviewTextNode.selectEnd();
        }
      }
    }
  }
}

// mimic inserText(), only handle typing (no multiline insert)
export function $markTypingInsert(
  selection: RangeSelection,
  text: string,
): void {
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (
    // not text node
    !$isReviewTextNode(anchorNode) ||
    // or text node but in the middle of deletion node.
    // for now, user must undelete first, before insertion
    ($isReviewTextNode(anchorNode) &&
      anchorNode.hasReviewType("deletion") &&
      anchor.offset !== anchorNode.getTextContentSize())
  ) {
    // typing at the start of a paragraph
    if ($isParagraphNode(anchorNode)) {
      const newReviewTextNode = $createReviewTextNode(text, "insertion");
      anchorNode.append(newReviewTextNode);
      newReviewTextNode.selectEnd();
    }
    return;
  }
  // the one whom only allowed to reach here are
  // selection of review type insertion or original
  insertReviewTextNode(anchorNode, anchor, text);

  return;
}
