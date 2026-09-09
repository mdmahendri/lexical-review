const assert = require("node:assert/strict");

const client = require("lexical-review/client");

assert.equal(typeof client.ReviewSessionPlugin, "function");
assert.equal(typeof client.registerReviewSession, "function");

console.log(
  "client entrypoint resolved with its CommonJS editor runtime exports",
);
