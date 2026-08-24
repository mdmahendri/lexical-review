import {
  $createReviewTextNode,
  $isReviewTextNode,
  ReviewTextNode,
  type TextReviewType,
} from "lexical-review";

const reviewType: TextReviewType = "original";
const reviewNode: ReviewTextNode = $createReviewTextNode(
  "server consumer",
  reviewType,
);
const isReviewNode: boolean = $isReviewTextNode(reviewNode);

void isReviewNode;
