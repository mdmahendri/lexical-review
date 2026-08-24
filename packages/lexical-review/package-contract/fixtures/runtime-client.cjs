/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */

const assert = require("node:assert/strict");

const client = require("lexical-review/client");

assert.equal(typeof client.ReviewTextPlugin, "function");
assert.equal(typeof client.registerReviewText, "function");
assert.equal("ReviewTextNode" in client, false);
assert.equal("$createReviewTextNode" in client, false);
assert.equal("$isReviewTextNode" in client, false);

console.log(
  "client entrypoint resolved with its CommonJS editor runtime exports",
);
