const assert = require("node:assert/strict");

const client = require("lexical-review/client");

assert.equal(typeof client.LegacyReviewTextPlugin, "function");
assert.equal(typeof client.registerLegacyReviewText, "function");
assert.equal(typeof client.ReviewSessionPlugin, "function");
assert.equal(typeof client.registerReviewSession, "function");
assert.equal("ReviewTextPlugin" in client, false);
assert.equal("registerReviewText" in client, false);
assert.equal("ReviewTextNode" in client, false);
assert.equal("$createReviewTextNode" in client, false);
assert.equal("$isReviewTextNode" in client, false);

console.log(
  "client entrypoint resolved with its CommonJS editor runtime exports",
);
