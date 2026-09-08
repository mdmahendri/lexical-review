import assert from "node:assert/strict";

const client = await import("lexical-review/client");

assert.equal(typeof client.ReviewSessionPlugin, "function");
assert.equal(typeof client.registerReviewSession, "function");
assert.equal("LegacyReviewTextPlugin" in client, false);
assert.equal("registerLegacyReviewText" in client, false);
assert.equal("ReviewTextPlugin" in client, false);
assert.equal("registerReviewText" in client, false);
assert.equal("ReviewTextNode" in client, false);
assert.equal("$createReviewTextNode" in client, false);
assert.equal("$isReviewTextNode" in client, false);

console.log("client entrypoint resolved with its editor runtime exports");
