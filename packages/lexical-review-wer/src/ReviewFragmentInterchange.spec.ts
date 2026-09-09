import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from "lexical";
import {
  $insertReviewFragment,
  $deleteReviewText,
  ReviewFragmentNode,
  ReviewBoundaryNode,
  ReviewInsertionNode,
  openReviewSession,
  validateReviewDocument,
} from "lexical-review";
import { exportAtomicFragmentToWERv1 } from "./index";

it("refuses the whole current fragment without decomposition or input mutation", () => {
  const editor = createEditor({
    nodes: [ReviewFragmentNode, ReviewBoundaryNode, ReviewInsertionNode],
    onError(error) {
      throw error;
    },
  });
  const opened = openReviewSession(editor, acceptedDocument());
  if (opened.status !== "valid") throw new Error("fixture");
  editor.update(
    () => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      $insertReviewFragment(
        [
          { runs: [{ text: "x", format: 1 }] },
          { runs: [{ text: "y", format: 2 }] },
        ],
        { proposalIdFactory: () => "f" },
      );
    },
    { discrete: true },
  );
  const saved = opened.value.exportDocument();
  if (saved.status !== "valid") throw new Error("export");
  const before = JSON.stringify(saved.value),
    state = editor.getEditorState();
  const result = exportAtomicFragmentToWERv1(saved.value, {
    inputRef: "artifact:current-fragment",
  });
  expect(result).toMatchObject({
    status: "unsupported",
    mappingReport: {
      inputRef: "artifact:current-fragment",
      outputRef: null,
      outputMutation: "none",
      outcome: "unsupported",
      issues: [
        {
          proposalIds: ["f"],
          action: "refused",
          condition: "unsupported",
          impact: "none",
        },
      ],
    },
  });
  expect(result).not.toHaveProperty("document");
  expect(JSON.stringify(saved.value)).toBe(before);
  expect(editor.getEditorState()).toBe(state);
  editor.update(
    () => {
      $getRoot().getAllTextNodes()[2]!.selectStart();
      expect($deleteReviewText(true).status).toBe("changed");
    },
    { discrete: true },
  );
  const normalized = opened.value.exportDocument();
  if (normalized.status !== "valid") throw new Error("normalized export");
  expect(
    exportAtomicFragmentToWERv1(normalized.value, {
      inputRef: "artifact:normalized-insertion",
    }),
  ).toEqual({ status: "not-applicable" });
  expect(JSON.stringify(normalized)).toContain('"proposalId":"f"');
});
it("does not report successful mapping for accepted-only input or malformed fragments", () => {
  const input = validateReviewDocument(acceptedDocument());
  if (input.status !== "valid") throw new Error("fixture");
  expect(
    exportAtomicFragmentToWERv1(input.value, { inputRef: "artifact:accepted" }),
  ).toEqual({ status: "not-applicable" });
  expect(
    exportAtomicFragmentToWERv1(input.value, { inputRef: "" }),
  ).toMatchObject({ status: "failed" });
});

// Build adapter-owned inputs through public APIs, without importing native test internals.
function acceptedDocument() {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode("AB")));
    },
    { discrete: true },
  );
  const { root } = editor.getEditorState().toJSON();
  return {
    root: { ...root, $: { "lexical-review": { version: 3, extensions: [] } } },
  };
}
