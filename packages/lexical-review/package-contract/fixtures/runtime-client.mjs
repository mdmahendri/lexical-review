import assert from "node:assert/strict";

const client = await import("lexical-review/client");

assert.equal(typeof client.LegacyReviewTextPlugin, "function");
assert.equal(typeof client.registerLegacyReviewText, "function");
assert.equal("ReviewTextPlugin" in client, false);
assert.equal("registerReviewText" in client, false);
assert.equal("registerReviewSession" in client, false);
assert.equal("ReviewTextNode" in client, false);
assert.equal("$createReviewTextNode" in client, false);
assert.equal("$isReviewTextNode" in client, false);

console.log("client entrypoint resolved with its editor runtime exports");
