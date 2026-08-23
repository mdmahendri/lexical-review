/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */

const assert = require("node:assert/strict");

const root = require("lexical-review");
const client = require("lexical-review/client");

assert.equal(typeof root.ReviewTextNode, "function");
assert.equal(typeof root.$createReviewTextNode, "function");
assert.equal(typeof root.$isReviewTextNode, "function");
assert.equal(typeof client.ReviewTextPlugin, "function");
assert.equal(typeof client.registerReviewText, "function");
assert.equal("ReviewTextNode" in client, false);
assert.equal("ReviewTextPlugin" in root, false);

console.log("commonjs entrypoints resolved with their expected exports");
