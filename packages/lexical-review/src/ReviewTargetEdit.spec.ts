/**
 * Target-edit seam validation: pure builder policy plus refusal preservation
 * and logical selection through the public intent seams.
 *
 * What this suite pins (and why):
 * - Builders decide purely-decidable policy editor-free, with verbatim
 *   refusal codes (no editor reads, no editor writes).
 * - Every returned refusal preserves accepted content, pending work, the
 *   review projection, and the logical selection.
 * - Identity-factory refusal precedes equivalence-unchanged (precedence).
 * - Equivalent replacement reports unchanged with byte-identical state
 *   (split-free equivalence: no node splits on unchanged paths).
 * - Post-mutation logical selection lands where the previous inline
 *   implementations placed it.
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $inspectReviewProposal,
  $setReviewFormatting,
  openReviewSession,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewInsertionNode,
  type ReviewIntentOutcome,
} from "./index";
import { $applyPasteRuns } from "./ReviewPaste";
import {
  $classifyReviewDeletion,
  buildPastePlan,
  buildTextDeletionPlan,
  buildTextInsertionPlan,
} from "./ReviewTargetEdit";
import { inspectReviewTarget } from "./ReviewTargeting";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function setup(
  children: unknown[],
  nodes = [ReviewInsertionNode, ReviewDeletionNode],
) {
  const editor = createEditor({
    namespace: "target-edit",
    nodes,
    onError: (error) => {
      throw error;
    },
  });
  const opened = openReviewSession(
    editor,
    reviewDocument([paragraph(children)]),
  );
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  return editor;
}

function snapshotState(editor: LexicalEditor) {
  return JSON.stringify(editor.getEditorState().toJSON());
}

function snapshotSelection(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return "none";
    const point = (p: { key: string; offset: number; type: string }) =>
      `${p.key}:${p.offset}:${p.type}`;
    return `${point(selection.anchor)}|${point(selection.focus)}|${selection.format}`;
  });
}

function expectPreserved(
  editor: LexicalEditor,
  beforeDoc: string,
  beforeSelection: string,
) {
  expect(snapshotState(editor)).toBe(beforeDoc);
  expect(snapshotSelection(editor)).toBe(beforeSelection);
}

describe("target-edit builders (pure, editor-free)", () => {
  it("refuses formatting-side deletion with the verbatim prepare code", () => {
    for (const kind of ["proposal-caret", "proposal-range"] as const) {
      expect(
        buildTextDeletionPlan(kind, "formatting", true, "character", {}),
      ).toEqual({
        status: "refused",
        code: "unsupported-proposal-edit",
        message: "Text deletion cannot alter a pending formatting target.",
      });
    }
  });

  it("selects deletion variants per target kind", () => {
    expect(
      buildTextDeletionPlan("proposal-caret", "insertion", true, "word", {}),
    ).toMatchObject({
      status: "ready",
      value: { kind: "delete-proposal-caret", granularity: "word" },
    });
    expect(
      buildTextDeletionPlan(
        "proposal-range",
        "deletion",
        true,
        "character",
        {},
      ),
    ).toMatchObject({
      status: "ready",
      value: { kind: "delete-proposal-range" },
    });
    expect(
      buildTextDeletionPlan("accepted-caret", null, false, "character", {}),
    ).toMatchObject({
      status: "ready",
      value: { kind: "delete-accepted-caret" },
    });
    expect(
      buildTextDeletionPlan("accepted-range", null, false, "character", {}),
    ).toMatchObject({
      status: "ready",
      value: { kind: "delete-accepted-range" },
    });
  });

  it("refuses deletion-side insertion typing with verbatim messages", () => {
    expect(
      buildTextInsertionPlan("proposal-caret", "deletion", "x", 0, {}),
    ).toEqual({
      status: "refused",
      code: "unsupported-proposal-edit",
      message:
        "Insertion typing may edit pending insertion content, not deletion content.",
    });
    expect(
      buildTextInsertionPlan("proposal-range", "deletion", "x", 0, {}),
    ).toEqual({
      status: "refused",
      code: "unsupported-proposal-edit",
      message:
        "Insertion replacement may edit pending insertion content, not deletion content.",
    });
  });

  it("refuses deletion-side paste with the verbatim paste message", () => {
    for (const kind of ["proposal-caret", "proposal-range"] as const) {
      expect(
        buildPastePlan(kind, "deletion", [{ text: "x", format: 0 }], {}),
      ).toEqual({
        status: "refused",
        code: "unsupported-proposal-edit",
        message:
          "Pasted content may correct pending insertion content, not deletion content. Resolve first.",
      });
    }
  });

  it("refuses multi-run paste over an insertion range with the verbatim message", () => {
    expect(
      buildPastePlan(
        "proposal-range",
        "insertion",
        [
          { text: "a", format: 1 },
          { text: "b", format: 2 },
        ],
        {},
      ),
    ).toEqual({
      status: "refused",
      code: "unsupported-proposal-edit",
      message:
        "Formatted paste over an insertion range is unsupported; resolve the proposal first, then paste at a caret.",
    });
    expect(
      buildPastePlan(
        "proposal-range",
        "insertion",
        [{ text: "a", format: 0 }],
        {},
      ),
    ).toMatchObject({
      status: "ready",
      value: { kind: "correct-proposal-range-with-runs" },
    });
  });

  it("marks continuation continue-adjacent for typing and fresh for paste", () => {
    expect(
      buildTextInsertionPlan("accepted-caret", null, "x", 0, {}),
    ).toMatchObject({
      status: "ready",
      value: {
        kind: "insert-runs-at-caret",
        continuation: "continue-adjacent",
      },
    });
    expect(
      buildPastePlan("accepted-caret", null, [{ text: "x", format: 0 }], {}),
    ).toMatchObject({
      status: "ready",
      value: { kind: "insert-runs-at-caret", continuation: "fresh" },
    });
  });
});

describe("deletion classification without mutation", () => {
  it("classifies a supported range to a ready plan with state preserved", () => {
    const editor = setup([text("AB")]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 1);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let plan: unknown;
    editor.update(
      () => {
        const inspection = inspectReviewTarget();
        expect(inspection.status).toBe("ready");
        if (inspection.status !== "ready") return;
        plan = $classifyReviewDeletion(
          inspection.value,
          false,
          "character",
          {},
        );
      },
      { discrete: true },
    );
    expect(plan).toMatchObject({
      status: "ready",
      value: { kind: "delete-accepted-range" },
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("refuses a formatting proposal range with the delete route's code", () => {
    const editor = setup(
      [text("target")],
      [ReviewFormattingNode, ReviewInsertionNode, ReviewDeletionNode],
    );
    const factory = () => "fmt";
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 6);
        expect(
          $setReviewFormatting({ bold: true }, { proposalIdFactory: factory })
            .status,
        ).toBe("changed");
        $getRoot().getAllTextNodes()[0]!.select(1, 3);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let classified: ReviewIntentOutcome | undefined;
    let deleted: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        const inspection = inspectReviewTarget();
        expect(inspection.status).toBe("ready");
        if (inspection.status !== "ready") return;
        const plan = $classifyReviewDeletion(
          inspection.value,
          false,
          "character",
          {},
        );
        if (plan.status !== "ready") classified = plan;
        deleted = $deleteReviewText(false, {});
      },
      { discrete: true },
    );
    expect(classified).toMatchObject({
      status: "refused",
      code: "unsupported-proposal-edit",
    });
    expect(deleted).toMatchObject({
      status: "refused",
      code: "unsupported-proposal-edit",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });
});

describe("refusal preservation through the intent seams", () => {
  it("preserves state when deleting inside a formatting proposal", () => {
    const editor = setup(
      [text("target")],
      [ReviewFormattingNode, ReviewInsertionNode, ReviewDeletionNode],
    );
    const factory = () => "fmt";
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 6);
        expect(
          $setReviewFormatting({ bold: true }, { proposalIdFactory: factory })
            .status,
        ).toBe("changed");
        $getRoot().getAllTextNodes()[0]!.select(1, 1);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $deleteReviewText(true, {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      code: "unsupported-proposal-edit",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("preserves state when typing into deletion content", () => {
    const editor = setup([reviewNode("review-deletion", "d", [text("gone")])]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(1, 1);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $insertReviewText("x", {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      code: "unsupported-proposal-edit",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("preserves state when deletion would cross proposal content", () => {
    const editor = setup([
      reviewNode("review-insertion", "p", [text("x")]),
      text("ab"),
    ]);
    editor.update(
      () => {
        $getRoot()
          .getAllTextNodes()
          .find((node) => node.getTextContent() === "ab")!
          .select(0, 0);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $deleteReviewText(true, {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      code: "deletion-target-unavailable",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("reports invalid-proposal-id before equivalence-unchanged", () => {
    const editor = setup([text("AB")]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 2);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    const failingFactory = (): string => {
      throw new Error("boom");
    };
    editor.update(
      () => {
        // Same text as selected: equivalent, but identity minting comes first.
        outcome = $insertReviewText("AB", {
          proposalIdFactory: failingFactory,
        });
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      code: "invalid-proposal-id",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("reports invalid-proposal-id for deletion and preserves state", () => {
    const editor = setup([text("AB")]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(1, 1);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    const failingFactory = (): string => {
      throw new Error("boom");
    };
    editor.update(
      () => {
        outcome = $deleteReviewText(false, {
          proposalIdFactory: failingFactory,
        });
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      code: "invalid-proposal-id",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("preserves state when the deletion node is not registered", () => {
    const editor = setup([text("AB")], [ReviewInsertionNode]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(1, 1);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $deleteReviewText(false, {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      code: "invalid-structural-target",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("refuses multi-run paste over an insertion range with zero runs inserted", () => {
    const editor = setup([reviewNode("review-insertion", "p", [text("hi")])]);
    const normalization = {
      source: "text/plain" as const,
      flattened: [],
      lost: [],
      softBreakConverted: false,
    };
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 2);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $applyPasteRuns(
          [
            { text: "a", format: 1 },
            { text: "b", format: 2 },
          ],
          normalization,
          {},
        );
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({
      status: "refused",
      code: "unsupported-proposal-edit",
      message:
        "Formatted paste over an insertion range is unsupported; resolve the proposal first, then paste at a caret.",
    });
    expectPreserved(editor, beforeDoc, beforeSelection);
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("p")),
    ).toMatchObject({ value: { proposal: { text: "hi" } } });
  });

  it("reports unchanged with byte-identical state for equivalent replacement", () => {
    const editor = setup([text("AB")]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 2);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $insertReviewText("AB", {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "unchanged" });
    // Split-free equivalence: an unchanged replacement leaves zero mutation.
    expectPreserved(editor, beforeDoc, beforeSelection);
  });

  it("reports unchanged with byte-identical state for equivalent paste", () => {
    const editor = setup([text("AB")]);
    const normalization = {
      source: "text/plain" as const,
      flattened: [],
      lost: [],
      softBreakConverted: false,
    };
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 2);
      },
      { discrete: true },
    );
    const beforeDoc = snapshotState(editor);
    const beforeSelection = snapshotSelection(editor);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $applyPasteRuns(
          [{ text: "AB", format: 0 }],
          normalization,
          {},
        );
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "unchanged" });
    expectPreserved(editor, beforeDoc, beforeSelection);
  });
});

describe("logical selection after target-edit mutation", () => {
  it("formats range replacement from the selection, not the anchor node", () => {
    const editor = setup([text("AB")]);
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 2);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error("No selection");
        // Diverge the selection format from the plain anchor text node.
        selection.format = 2;
        outcome = $insertReviewText("XY", {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    const formats = editor.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .map((node) => node.getFormat()),
    );
    // Old side "AB" keeps 0; new side "XY" inherits the selection format.
    expect(formats).toEqual([0, 2]);
  });

  it("rests the caret on the accepted neighbor after forward deletion", () => {
    const editor = setup([text("AB")]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 0);
      },
      { discrete: true },
    );
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $deleteReviewText(false, {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    const logical = editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed())
        return null;
      return {
        offset: selection.anchor.offset,
        text: selection.anchor.getNode().getTextContent(),
      };
    });
    expect(logical).toEqual({ offset: 0, text: "B" });
  });

  it("continues adjacent insertion typing at the touching edge", () => {
    const editor = setup([
      reviewNode("review-insertion", "p", [text("x")]),
      text("B"),
    ]);
    editor.update(
      () => {
        $getRoot()
          .getAllTextNodes()
          .find((node) => node.getTextContent() === "B")!
          .select(0, 0);
      },
      { discrete: true },
    );
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $insertReviewText("y", {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("p")),
    ).toMatchObject({ value: { proposal: { text: "xy" } } });
    const logical = editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed())
        return null;
      return {
        offset: selection.anchor.offset,
        text: selection.anchor.getNode().getTextContent(),
      };
    });
    expect(logical).toEqual({ offset: 2, text: "xy" });
  });

  it("rests the caret at the end of a multi-format paste batch", () => {
    const editor = setup([text("AB")]);
    const normalization = {
      source: "text/plain" as const,
      flattened: [],
      lost: [],
      softBreakConverted: false,
    };
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(1, 1);
      },
      { discrete: true },
    );
    let outcome: ReviewIntentOutcome | undefined;
    const factory = (() => {
      let next = 0;
      return () => `paste-${(next += 1)}`;
    })();
    editor.update(
      () => {
        outcome = $applyPasteRuns(
          [
            { text: "C", format: 1 },
            { text: "D", format: 2 },
          ],
          normalization,
          { proposalIdFactory: factory },
        );
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("paste-1")),
    ).toMatchObject({ value: { proposal: { text: "CD" } } });
    const logical = editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed())
        return null;
      return {
        offset: selection.anchor.offset,
        text: selection.anchor.getNode().getTextContent(),
      };
    });
    expect(logical).toEqual({ offset: 1, text: "D" });
  });

  it("inserts a three-run alternating-format batch atomically", () => {
    const editor = setup([text("Z")]);
    const normalization = {
      source: "text/plain" as const,
      flattened: [],
      lost: [],
      softBreakConverted: false,
    };
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(0, 0);
      },
      { discrete: true },
    );
    let outcome: ReviewIntentOutcome | undefined;
    const factory = () => "paste-3";
    editor.update(
      () => {
        // Every run after the first forks a new node off live state written
        // by the previous run: the old per-run re-inspect loop risked
        // partial mutation exactly here.
        outcome = $applyPasteRuns(
          [
            { text: "A", format: 1 },
            { text: "B", format: 2 },
            { text: "C", format: 1 },
          ],
          normalization,
          { proposalIdFactory: factory },
        );
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("paste-3")),
    ).toMatchObject({ value: { proposal: { text: "ABC" } } });
    const observed = editor.getEditorState().read(() => {
      const nodes = $getRoot().getAllTextNodes();
      const selection = $getSelection();
      const caret =
        selection !== null &&
        $isRangeSelection(selection) &&
        selection.isCollapsed()
          ? {
              offset: selection.anchor.offset,
              text: selection.anchor.getNode().getTextContent(),
            }
          : null;
      return {
        caret,
        runs: nodes
          .filter((node) => node.getTextContent() !== "Z")
          .map((node) => ({
            format: node.getFormat(),
            text: node.getTextContent(),
          })),
      };
    });
    expect(observed.runs).toEqual([
      { format: 1, text: "A" },
      { format: 2, text: "B" },
      { format: 1, text: "C" },
    ]);
    expect(observed.caret).toEqual({ offset: 1, text: "C" });
  });

  it("batches alternating-format runs through a proposal caret atomically", () => {
    const editor = setup([reviewNode("review-insertion", "p", [text("x")])]);
    const normalization = {
      source: "text/plain" as const,
      flattened: [],
      lost: [],
      softBreakConverted: false,
    };
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(1, 1);
      },
      { discrete: true },
    );
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        // Starts inside the pending insertion, so this exercises the
        // rewritten correct-proposal-caret batch: each run after the first
        // forks a node off live state written by the previous run, under
        // the same proposal identity throughout.
        outcome = $applyPasteRuns(
          [
            { text: "A", format: 1 },
            { text: "B", format: 2 },
            { text: "C", format: 1 },
          ],
          normalization,
          {},
        );
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("p")),
    ).toMatchObject({ value: { proposal: { text: "xABC" } } });
    const observed = editor.getEditorState().read(() => {
      const nodes = $getRoot().getAllTextNodes();
      const selection = $getSelection();
      const caret =
        selection !== null &&
        $isRangeSelection(selection) &&
        selection.isCollapsed()
          ? {
              offset: selection.anchor.offset,
              text: selection.anchor.getNode().getTextContent(),
            }
          : null;
      return {
        caret,
        runs: nodes.map((node) => ({
          format: node.getFormat(),
          text: node.getTextContent(),
        })),
      };
    });
    expect(observed.runs).toEqual([
      { format: 0, text: "x" },
      { format: 1, text: "A" },
      { format: 2, text: "B" },
      { format: 1, text: "C" },
    ]);
    expect(observed.caret).toEqual({ offset: 1, text: "C" });
  });

  it("forks a node when correcting a proposal caret with a new format", () => {
    const editor = setup([reviewNode("review-insertion", "p", [text("x")])]);
    const normalization = {
      source: "text/plain" as const,
      flattened: [],
      lost: [],
      softBreakConverted: false,
    };
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(1, 1);
      },
      { discrete: true },
    );
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $applyPasteRuns(
          [{ text: "Y", format: 1 }],
          normalization,
          {},
        );
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("p")),
    ).toMatchObject({ value: { proposal: { text: "xY" } } });
    const logical = editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed())
        return null;
      return {
        offset: selection.anchor.offset,
        text: selection.anchor.getNode().getTextContent(),
      };
    });
    expect(logical).toEqual({ offset: 1, text: "Y" });
  });

  it("rests the caret at the splice point after proposal-caret deletion", () => {
    const editor = setup([reviewNode("review-insertion", "p", [text("abc")])]);
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(2, 2);
      },
      { discrete: true },
    );
    let outcome: ReviewIntentOutcome | undefined;
    editor.update(
      () => {
        outcome = $deleteReviewText(true, {});
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("p")),
    ).toMatchObject({ value: { proposal: { text: "ac" } } });
    const logical = editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed())
        return null;
      return {
        offset: selection.anchor.offset,
        text: selection.anchor.getNode().getTextContent(),
      };
    });
    expect(logical).toEqual({ offset: 1, text: "ac" });
  });
});
