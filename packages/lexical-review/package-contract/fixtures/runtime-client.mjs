import assert from "node:assert/strict";

const client = await import("lexical-review/client");

assert.equal(typeof client.ReviewSessionPlugin, "function");
assert.equal(typeof client.registerReviewSession, "function");

console.log("client entrypoint resolved with its editor runtime exports");
