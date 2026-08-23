import assert from "node:assert/strict";

const client = await import("lexical-review/client");

assert.equal(typeof client.ReviewTextPlugin, "function");
assert.equal(typeof client.registerReviewText, "function");
assert.equal("ReviewTextNode" in client, false);
assert.equal("$createReviewTextNode" in client, false);
assert.equal("$isReviewTextNode" in client, false);

console.log("client entrypoint resolved with its editor runtime exports");
