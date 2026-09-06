/**
 * Reviewer primitives (#60): detached inspection snapshots, deterministic
 * document-order enumeration with pure previous/next lookup, and read-only
 * accepted-state / all-accepted outcome snapshots over live state.
 *
 * Owned here: unified snapshot payloads with call-time attachment, ordering
 * tie-breaks (adjacent first-component order, single-entry fragments anchored
 * first, split/merge marker slots), null-edge navigation semantics,
 * selection-independent side-effect-free reads, snapshot consistency,
 * no-mutation previews, composition gating, and the accepted-refuse vs
 * all-accepted-throw mapping.
 *
 * Owned elsewhere (referenced, not duplicated): kind-specific
 * `$inspectReviewProposal` and the inspect-after-resolve guarantee (#59),
 * successor export and import validation (#62), extensions (#63), route
 * adapters (#68), and panel/focus implementations (host/demo).
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ParagraphNode,
  type TextNode,
} from "lexical";
import {
  $createReviewBoundaryNode,
  $insertReviewFragment,
  $insertReviewText,
  $inspectReviewProposalSnapshot,
  $listReviewProposals,
  $mergeReviewParagraph,
  $previewAcceptedState,
  $previewAllAccepted,
  $resolveReviewProposal,
  $setReviewFormatting,
  $splitReviewParagraph,
  getNextProposal,
  getPrevProposal,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
} from "./index";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

const NODES = [
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewBoundaryNode,
] as const;

const id = (value: string) => ({ proposalIdFactory: () => value });
const fragment = (value: string, format = 0) =>
  value.split("\n").map((part) => ({
    runs: part ? [{ text: part, format }] : [],
    emptyFormat: format,
  }));

function boundaryFixture(proposalId: string, kind: "split" | "merge") {
  return {
    type: "review-boundary",
    version: 1,
    proposalId,
    kind,
    leftFormat: 0,
    rightFormat: 0,
    extensions: [],
  };
}

function setup(children: unknown[] = [paragraph([text("AB")])]) {
  const editor = createEditor({
    namespace: "reviewer",
    nodes: [...NODES],
    onError(error) {
      throw error;
    },
  });
  const opened = openReviewSession(editor, reviewDocument(children));
  if (opened.status !== "valid")
    throw new Error(`Invalid fixture: ${JSON.stringify(opened)}`);
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  // editor.read (not getEditorState().read) so $getEditor()-dependent gates
  // such as validateStructuralState see an active editor.
  const read = <T>(fn: () => T): T => editor.read(fn);
  const snapshot = () =>
    read(() => {
      const selection = $getSelection();
      return {
        document: editor.getEditorState().toJSON(),
        selection: $isRangeSelection(selection)
          ? [
              selection.anchor.key,
              selection.anchor.offset,
              selection.anchor.type,
              selection.focus.key,
              selection.focus.offset,
              selection.focus.type,
            ]
          : null,
      };
    });
  return { editor, session: opened.value, update, read, snapshot };
}

function textByContent(value: string): TextNode {
  const found = $getRoot()
    .getAllTextNodes()
    .find((node) => node.getTextContent() === value);
  if (!found) throw new Error(`Missing text node: ${value}`);
  return found;
}

/** Seven-kind document: text kinds serialized, the rest authored live. */
function setupSevenKinds() {
  const helpers = setup([
    paragraph([
      text("t0"),
      reviewNode("review-insertion", "a", [text("x")]),
      text("t1"),
    ]),
    paragraph([reviewNode("review-deletion", "b", [text("y")]), text("t2")]),
    paragraph([
      reviewNode("review-deletion", "c", [text("o")]),
      reviewNode("review-insertion", "c", [text("n")]),
    ]),
    paragraph([text("fmt")]),
    paragraph([text("sp1")]),
    paragraph([boundaryFixture("e", "split"), text("sp2")]),
    paragraph([text("mg1"), boundaryFixture("f", "merge"), text("mg2")]),
    paragraph([text("h1h2")]),
  ]);
  const { update } = helpers;
  update(() => {
    textByContent("fmt").select(0, 3);
    expect($setReviewFormatting({ bold: true }, id("d")).status).toBe(
      "changed",
    );
  });
  update(() => {
    textByContent("h1h2").select(2, 2);
    expect($insertReviewFragment(fragment("q1\nq2"), id("g")).status).toBe(
      "changed",
    );
  });
  return helpers;
}

describe("reviewer ordering and navigation", () => {
  it("lists all seven kinds in document order with one entry per identity", () => {
    const { read } = setupSevenKinds();
    read(() => {
      expect($listReviewProposals()).toEqual([
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
      ]);
    });
  });

  it("neighbour lookup is pure with null-edge semantics", () => {
    const list = ["a", "b", "c"];
    expect(getNextProposal(list, null)).toBe("a");
    expect(getPrevProposal(list, null)).toBe("c");
    expect(getNextProposal(list, "b")).toBe("c");
    expect(getPrevProposal(list, "b")).toBe("a");
    expect(getNextProposal(list, "c")).toBeNull();
    expect(getPrevProposal(list, "a")).toBeNull();
    expect(getNextProposal(list, "resolved")).toBeNull();
    expect(getPrevProposal(list, " bad ")).toBeNull();
    expect(getNextProposal([], null)).toBeNull();
    expect(getPrevProposal([], null)).toBeNull();
    expect(getNextProposal([], "a")).toBeNull();
  });

  it("an empty document lists no identities", () => {
    const { read } = setup([paragraph([])]);
    read(() => {
      expect($listReviewProposals()).toEqual([]);
    });
  });
});

describe("reviewer inspection snapshots", () => {
  it("inspects text kinds with runs and call-time attachment", () => {
    const { read } = setup([
      paragraph([text("t0"), reviewNode("review-insertion", "a", [text("x")])]),
      paragraph([reviewNode("review-deletion", "b", [text("y")])]),
      paragraph([
        reviewNode("review-deletion", "c", [text("o")]),
        reviewNode("review-insertion", "c", [text("n")]),
      ]),
    ]);
    read(() => {
      expect($inspectReviewProposalSnapshot("a")).toEqual({
        status: "ready",
        value: {
          proposalId: "a",
          kind: "insertion",
          attachment: { paragraphIndex: 0, childIndex: 1 },
          content: { text: "x", runs: [{ text: "x", format: 0 }] },
        },
      });
      expect($inspectReviewProposalSnapshot("b")).toEqual({
        status: "ready",
        value: {
          proposalId: "b",
          kind: "deletion",
          attachment: { paragraphIndex: 1, childIndex: 0 },
          content: { text: "y", runs: [{ text: "y", format: 0 }] },
        },
      });
      expect($inspectReviewProposalSnapshot("c")).toEqual({
        status: "ready",
        value: {
          proposalId: "c",
          kind: "replacement",
          attachment: { paragraphIndex: 2, childIndex: 0 },
          content: {
            oldText: "o",
            newText: "n",
            oldRuns: [{ text: "o", format: 0 }],
            newRuns: [{ text: "n", format: 0 }],
          },
        },
      });
    });
  });

  it("inspects formatting with accepted and current runs", () => {
    const { update, read } = setup([paragraph([text("fmt")])]);
    update(() => {
      textByContent("fmt").select(0, 3);
      expect($setReviewFormatting({ bold: true }, id("d")).status).toBe(
        "changed",
      );
    });
    read(() => {
      expect($inspectReviewProposalSnapshot("d")).toEqual({
        status: "ready",
        value: {
          proposalId: "d",
          kind: "formatting",
          attachment: { paragraphIndex: 0, childIndex: 0 },
          content: {
            accepted: [{ text: "fmt", format: 0 }],
            current: [{ text: "fmt", format: 1 }],
          },
        },
      });
    });
  });

  it("inspects split and merge markers at their marker slots", () => {
    const { read } = setup([
      paragraph([text("sp1")]),
      paragraph([boundaryFixture("e", "split"), text("sp2")]),
      paragraph([text("mg1"), boundaryFixture("f", "merge"), text("mg2")]),
    ]);
    read(() => {
      expect($inspectReviewProposalSnapshot("e")).toEqual({
        status: "ready",
        value: {
          proposalId: "e",
          kind: "split",
          attachment: { paragraphIndex: 1, childIndex: 0 },
          content: { kind: "split" },
        },
      });
      expect($inspectReviewProposalSnapshot("f")).toEqual({
        status: "ready",
        value: {
          proposalId: "f",
          kind: "merge",
          attachment: { paragraphIndex: 2, childIndex: 1 },
          content: { kind: "merge" },
        },
      });
    });
  });

  it("inspects fragments with paragraph payload anchored at the first component", () => {
    const { update, read } = setup([paragraph([text("AB")])]);
    update(() => {
      textByContent("AB").select(1, 1);
      expect($insertReviewFragment(fragment("x\ny"), id("g")).status).toBe(
        "changed",
      );
    });
    read(() => {
      expect($listReviewProposals()).toEqual(["g"]);
      expect($inspectReviewProposalSnapshot("g")).toMatchObject({
        status: "ready",
        value: {
          proposalId: "g",
          kind: "fragment",
          attachment: { paragraphIndex: 0, childIndex: 1 },
          content: {
            paragraphs: [
              { runs: [{ text: "x", format: 0 }] },
              { runs: [{ text: "y", format: 0 }] },
            ],
          },
        },
      });
    });
  });

  it("reports a normalized single-paragraph fragment under its current kind", () => {
    const { update, read } = setup([paragraph([text("AB")])]);
    update(() => {
      textByContent("AB").select(1, 1);
      expect(
        $insertReviewFragment(
          [{ runs: [{ text: "solo", format: 0 }], emptyFormat: 0 }],
          id("n"),
        ).status,
      ).toBe("changed");
    });
    read(() => {
      expect($inspectReviewProposalSnapshot("n")).toMatchObject({
        status: "ready",
        value: {
          proposalId: "n",
          kind: "insertion",
          content: { text: "solo" },
        },
      });
    });
  });

  it("refuses malformed and unknown identities with pinned codes", () => {
    const { read, snapshot } = setup();
    const before = snapshot();
    read(() => {
      expect($inspectReviewProposalSnapshot(" bad ")).toMatchObject({
        status: "refused",
        code: "invalid-proposal-id",
      });
      expect($inspectReviewProposalSnapshot("missing")).toMatchObject({
        status: "refused",
        code: "unsupported-target",
      });
    });
    expect(snapshot()).toEqual(before);
  });

  it("keeps inspection independent of selection and preserves it", () => {
    const { update, read, snapshot } = setup([
      paragraph([
        text("t0"),
        reviewNode("review-insertion", "a", [text("x")]),
        text("t1"),
      ]),
    ]);
    update(() => {
      textByContent("t0").select(0, 0);
    });
    const first = read(() => $inspectReviewProposalSnapshot("a"));
    update(() => {
      textByContent("t1").select(2, 2);
    });
    const second = read(() => $inspectReviewProposalSnapshot("a"));
    expect(second).toEqual(first);
    const before = snapshot();
    read(() => {
      $listReviewProposals();
      $inspectReviewProposalSnapshot("a");
      getNextProposal(["a"], "a");
      getPrevProposal(["a"], null);
    });
    expect(snapshot()).toEqual(before);
  });

  it("returns detached snapshots stable across later mutation", () => {
    const { update, read } = setup([
      paragraph([reviewNode("review-insertion", "a", [text("x")])]),
    ]);
    const before = read(() => $inspectReviewProposalSnapshot("a"));
    const frozen = JSON.parse(JSON.stringify(before));
    update(() => {
      textByContent("x").selectEnd();
      expect($insertReviewText("Z").status).toBe("changed");
    });
    expect(before).toEqual(frozen);
    read(() => {
      expect($inspectReviewProposalSnapshot("a")).toMatchObject({
        status: "ready",
        value: { kind: "insertion", content: { text: "xZ" } },
      });
    });
  });
});

describe("reviewer previews", () => {
  it("derives accepted-state and all-accepted texts without mutation", () => {
    const { read, snapshot } = setupSevenKinds();
    const before = snapshot();
    read(() => {
      expect($previewAcceptedState()).toEqual({
        status: "ready",
        value: {
          paragraphs: [
            "t0t1",
            "yt2",
            "o",
            "fmt",
            "sp1sp2",
            "mg1",
            "mg2",
            "h1h2",
          ],
        },
      });
      expect($previewAllAccepted()).toEqual({
        paragraphs: [
          "t0xt1",
          "t2",
          "n",
          "fmt",
          "sp1",
          "sp2",
          "mg1mg2",
          "h1q1",
          "q2h2",
        ],
      });
    });
    expect(snapshot()).toEqual(before);
  });

  it("gates previews during composition while reads stay available", () => {
    const { editor, read, snapshot } = setup([
      paragraph([reviewNode("review-insertion", "a", [text("x")])]),
    ]);
    const composing = vi.spyOn(editor, "isComposing").mockReturnValue(true);
    try {
      const before = snapshot();
      read(() => {
        expect($listReviewProposals()).toEqual(["a"]);
        expect($inspectReviewProposalSnapshot("a")).toMatchObject({
          status: "ready",
          value: { kind: "insertion" },
        });
        expect($previewAcceptedState()).toMatchObject({
          status: "refused",
          code: "unsupported-input",
        });
        expect(() => $previewAllAccepted()).toThrow();
      });
      expect(snapshot()).toEqual(before);
    } finally {
      composing.mockRestore();
    }
  });

  it("refuses accepted previews and throws all-accepted previews on invalid trees", () => {
    const { update, read, snapshot } = setup([
      paragraph([text("sp1")]),
      paragraph([boundaryFixture("e", "split"), text("sp2")]),
    ]);
    update(() => {
      $getRoot()
        .getChildren<ParagraphNode>()[1]!
        .append($createReviewBoundaryNode("z", "merge", 0, 0));
    });
    const before = snapshot();
    read(() => {
      expect($inspectReviewProposalSnapshot("e")).toMatchObject({
        status: "refused",
        code: "invalid-structural-target",
      });
      expect($previewAcceptedState()).toMatchObject({
        status: "refused",
        code: "invalid-structural-target",
      });
      expect(() => $previewAllAccepted()).toThrow();
    });
    expect(snapshot()).toEqual(before);
  });
});

describe("reviewer resolution consequences", () => {
  it("omits resolved identities from fresh lists and refuses re-inspection", () => {
    const { update, read } = setup([
      paragraph([
        reviewNode("review-insertion", "a", [text("x")]),
        reviewNode("review-deletion", "b", [text("y")]),
      ]),
    ]);
    update(() =>
      expect($resolveReviewProposal("a", "accept").status).toBe("changed"),
    );
    read(() => {
      expect($inspectReviewProposalSnapshot("a")).toMatchObject({
        status: "refused",
        code: "unsupported-target",
      });
      expect($listReviewProposals()).toEqual(["b"]);
      expect(getNextProposal(["b"], "a")).toBeNull();
      expect(getPrevProposal(["b"], "a")).toBeNull();
    });
  });

  it("reflects post-resolution content in previews without history", () => {
    const { update, read, session } = setup([
      paragraph([text("sp1")]),
      paragraph([boundaryFixture("e", "split"), text("sp2")]),
    ]);
    update(() =>
      expect($resolveReviewProposal("e", "reject").status).toBe("changed"),
    );
    read(() => {
      expect($listReviewProposals()).toEqual([]);
      expect($previewAcceptedState()).toMatchObject({
        status: "ready",
        value: { paragraphs: ["sp1sp2"] },
      });
      expect($previewAllAccepted()).toEqual({ paragraphs: ["sp1sp2"] });
    });
    const exported = session.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status === "valid")
      expect(JSON.stringify(exported.value)).not.toContain("terminal");
  });

  it("orders authored split and merge markers with live previews to match", () => {
    const { update, read } = setup([
      paragraph([text("AB")]),
      paragraph([text("CD")]),
      paragraph([text("EF")]),
    ]);
    update(() => {
      textByContent("AB").select(1, 1);
      expect($splitReviewParagraph(id("s")).status).toBe("changed");
    });
    update(() => {
      $getRoot().getChildren<ParagraphNode>()[3]!.select(0, 0);
      expect($mergeReviewParagraph(true, id("m")).status).toBe("changed");
    });
    read(() => {
      expect($listReviewProposals()).toEqual(["s", "m"]);
      expect($inspectReviewProposalSnapshot("s")).toMatchObject({
        status: "ready",
        value: { kind: "split", attachment: { paragraphIndex: 1 } },
      });
      expect($inspectReviewProposalSnapshot("m")).toMatchObject({
        status: "ready",
        value: { kind: "merge", attachment: { paragraphIndex: 2 } },
      });
      expect($previewAcceptedState()).toMatchObject({
        status: "ready",
        value: { paragraphs: ["AB", "CD", "EF"] },
      });
      expect($previewAllAccepted()).toEqual({ paragraphs: ["A", "B", "CDEF"] });
    });
  });
});
