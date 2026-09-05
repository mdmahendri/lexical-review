const assert = require("node:assert/strict");
const { createEditor } = require("lexical");

const root = require("lexical-review");

assert.equal(typeof root.ReviewInsertionNode, "function");
assert.equal(typeof root.ReviewDeletionNode, "function");
assert.equal(typeof root.LegacyReviewTextNode, "function");
assert.equal("ReviewTextNode" in root, false);
assert.equal(typeof root.openReviewSession, "function");
for (const name of [
  "$insertReviewText",
  "$inspectReviewInsertion",
  "$removeReviewInsertion",
  "$acceptReviewInsertion",
  "$rejectReviewInsertion",
]) {
  assert.equal(typeof root[name], "function");
}
assert.equal(typeof root.validateReviewDocument, "function");
assert.equal("ReviewTextPlugin" in root, false);
assert.equal("registerReviewText" in root, false);

const editor = createEditor({
  nodes: [root.ReviewInsertionNode, root.ReviewDeletionNode],
  onError: (error) => void error,
});
const opened = root.openReviewSession(editor, {
  root: {
    children: [
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        type: "paragraph",
        version: 1,
      },
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
    $: { "lexical-review": { extensions: [], version: 3 } },
  },
});
assert.equal(opened.status, "valid");
assert.equal("insertText" in opened.value, false);
assert.equal("finalizeDraft" in opened.value, false);
assert.equal("discardDraft" in opened.value, false);
assert.equal("acceptProposal" in opened.value, false);
assert.equal("rejectProposal" in opened.value, false);
assert.equal(opened.value.exportDocument().status, "valid");

console.log("root entrypoint resolved with its CommonJS core runtime exports");
