const assert = require("node:assert/strict");

const root = require("lexical-review");

assert.equal(typeof root.ReviewTextNode, "function");
assert.equal(typeof root.$createReviewTextNode, "function");
assert.equal(typeof root.$isReviewTextNode, "function");
assert.equal("ReviewTextPlugin" in root, false);
assert.equal("registerReviewText" in root, false);

console.log("root entrypoint resolved with its CommonJS core runtime exports");
