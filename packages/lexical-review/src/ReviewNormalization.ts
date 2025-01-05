import { $isReviewTextNode, ReviewTextNode } from "./ReviewTextNode";

function $canReviewTextNodesBeMerged(
  node1: ReviewTextNode,
  node2: ReviewTextNode,
): boolean {
  return node1.__review == node2.__review;
}

function $mergeReviewTextNodes(
  node1: ReviewTextNode,
  node2: ReviewTextNode,
): ReviewTextNode {
  const writableNode1 = node1.mergeWithSibling(node2);

  // const normalizedNodes = getActiveEditor()._normalizedNodes;

  // normalizedNodes.add(node1.__key);
  // normalizedNodes.add(node2.__key);
  return writableNode1 as ReviewTextNode;
}

export function $normalizeReviewTextNode(textNode: ReviewTextNode): void {
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
