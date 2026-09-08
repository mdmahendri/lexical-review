import assert from "node:assert/strict";
import { createEditor } from "lexical";

const root = await import("lexical-review");

assert.equal(typeof root.ReviewInsertionNode, "function");
assert.equal(typeof root.ReviewDeletionNode, "function");
assert.equal(typeof root.openReviewSession, "function");
for (const name of [
  "$deleteReviewText",
  "$insertReviewText",
  "$replaceReviewText",
  "$inspectReviewProposal",
  "$resolveReviewProposal",
  "$resolveReviewProposals",
]) {
  assert.equal(typeof root[name], "function");
}
assert.equal(typeof root.validateReviewDocument, "function");

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
assert.equal(opened.value.exportDocument().status, "valid");

console.log("root entrypoint resolved with its core runtime exports");
