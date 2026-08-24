import review = require("lexical-review");

const reviewType: review.TextReviewType = "original";
const reviewNode: review.ReviewTextNode = review.$createReviewTextNode(
  "commonjs root consumer",
  reviewType,
);
const isReviewNode: boolean = review.$isReviewTextNode(reviewNode);

void isReviewNode;
