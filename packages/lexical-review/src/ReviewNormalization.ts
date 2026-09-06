import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type ElementNode,
  type PointType,
} from "lexical";
import {
  $canReviewElementNodesBeMerged,
  isReviewElementNode,
  type ReviewElementNode,
} from "./ReviewNodes";

type PointSnapshot = Readonly<{
  key: string;
  offset: number;
  type: "element" | "text";
}>;

function snapshotPoint(point: PointType): PointSnapshot {
  return { key: point.key, offset: point.offset, type: point.type };
}

function restorePointAfterReviewElementMerge(
  point: PointType,
  snapshot: PointSnapshot,
  left: ReviewElementNode,
  right: ReviewElementNode,
  parent: ElementNode,
  leftChildCount: number,
  rightIndex: number,
): void {
  if (snapshot.type === "element" && snapshot.key === right.getKey()) {
    point.set(left.getKey(), leftChildCount + snapshot.offset, "element");
    return;
  }
  if (snapshot.type === "element" && snapshot.key === parent.getKey()) {
    if (snapshot.offset === rightIndex) {
      point.set(left.getKey(), leftChildCount, "element");
    } else if (snapshot.offset > rightIndex) {
      point.set(parent.getKey(), snapshot.offset - 1, "element");
    } else {
      point.set(parent.getKey(), snapshot.offset, "element");
    }
    return;
  }
  point.set(snapshot.key, snapshot.offset, snapshot.type);
}

function mergeReviewElementNodes(
  left: ReviewElementNode,
  right: ReviewElementNode,
): void {
  const parent = left.getParent();
  const rightIndex = right.getIndexWithinParent();
  if (!$isElementNode(parent) || rightIndex < 0) {
    return;
  }
  const leftChildCount = left.getChildrenSize();
  const selection = $getSelection();
  const anchor = $isRangeSelection(selection)
    ? snapshotPoint(selection.anchor)
    : null;
  const focus = $isRangeSelection(selection)
    ? snapshotPoint(selection.focus)
    : null;

  left.append(...right.getChildren());
  right.remove();

  if ($isRangeSelection(selection) && anchor !== null && focus !== null) {
    restorePointAfterReviewElementMerge(
      selection.anchor,
      anchor,
      left,
      right,
      parent,
      leftChildCount,
      rightIndex,
    );
    restorePointAfterReviewElementMerge(
      selection.focus,
      focus,
      left,
      right,
      parent,
      leftChildCount,
      rightIndex,
    );
    selection.dirty = true;
  }
}

export function normalizeReviewElementNode(node: ReviewElementNode): void {
  if (!node.isAttached()) {
    return;
  }
  const previous = node.getPreviousSibling();
  if (
    isReviewElementNode(previous) &&
    $canReviewElementNodesBeMerged(previous, node)
  ) {
    mergeReviewElementNodes(previous, node);
    return;
  }
  const next = node.getNextSibling();
  if (isReviewElementNode(next) && $canReviewElementNodesBeMerged(node, next)) {
    mergeReviewElementNodes(node, next);
  }
}
