import assert from "node:assert/strict";

const root = await import("lexical-review");

assert.equal(typeof root.ReviewTextNode, "function");
assert.equal(typeof root.$createReviewTextNode, "function");
assert.equal(typeof root.$isReviewTextNode, "function");
assert.equal("ReviewTextPlugin" in root, false);
assert.equal("registerReviewText" in root, false);

console.log("root entrypoint resolved with its core runtime exports");
