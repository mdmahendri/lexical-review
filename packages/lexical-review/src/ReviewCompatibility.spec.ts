/**
 * Compatibility matrix (#58): which pending proposals may coexist, admitted
 * through live authoring and serialized import alike.
 *
 * Cells already proven elsewhere (referenced, not duplicated):
 * - split strictly inside insertion/deletion/formatting/replacement: refused,
 *   endpoint permitted — ReviewStructure.spec ("refuses splitting inside %s").
 * - repeated splits resolve independently of order — ReviewStructure.spec
 *   ("batch %s of repeated splits is independent of request order").
 * - chained merges, duplicate identity, ranges: refused — ReviewStructure.spec
 *   ("refuses range, surrogate-interior, duplicate identity, and chained merge").
 * - mixed fragment/accepted ownership: refused — ReviewFragment.spec
 *   ("refuses mixed ownership without changing document or selection").
 * - fragment coexistence across reject orders — ReviewFragment.spec
 *   ("rejects split first without losing the fragment",
 *   "accepted-side deletion is independent and survives fragment rejection").
 * - formatting across accepted/proposal sides and identities: refused —
 *   ReviewFormatting.spec ("refuses formatting across accepted/proposal sides").
 * - formatting no-op detection and revert unwrapping — ReviewFormatting.spec
 *   ("detects no-ops before splitting or allocating identity").
 * - replacement cancellation and cross-paragraph identity — ReviewReplacement.spec
 *   ("cancels the entire replacement on %s", "rejects cross-paragraph shared identity").
 * - insertion/deletion continuation and terminal boundaries —
 *   ReviewIntentDispatch.spec (typing/deletion ownership rows).
 * - separate creation at incompatible formatting boundaries — ReviewText.spec
 *   ("creates a separate proposal at an incompatible accepted formatting boundary").
 *
 * Rows below cover the remaining cells: coexistence permits, untested
 * refusals, live/import agreement on shared-identity violations, no-op
 * disappearance, and terminal-record-free removal. Every refusal row also
 * proves no mutation of document or logical selection.
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ParagraphNode,
} from "lexical";
import {
  $createReviewBoundaryNode,
  $createReviewDeletionNode,
  $createReviewFormattingNode,
  $createReviewInsertionNode,
  $deleteReviewText,
  $inspectReviewProposal,
  $inspectReviewProposalSnapshot,
  $insertReviewFragment,
  $insertReviewText,
  $mergeReviewParagraph,
  $resolveReviewProposal,
  $setReviewFormatting,
  $splitReviewParagraph,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  validateReviewDocument,
} from "./index";
import { collectProposalNodes } from "./ReviewProposalCollection";
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

function setup(children: unknown[] = [paragraph([text("AB")])]) {
  const editor = createEditor({
    namespace: "compatibility",
    nodes: [...NODES],
    onError(error) {
      throw error;
    },
  });
  const opened = openReviewSession(editor, reviewDocument(children));
  if (opened.status !== "valid")
    throw new Error(`Invalid fixture: ${JSON.stringify(opened)}`);
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  const read = <T>(fn: () => T): T => editor.getEditorState().read(fn);
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

describe("compatibility matrix: coexistence permits", () => {
  it("adjacent insertion and deletion proposals coexist and resolve independently", () => {
    const { session, read, update } = setup([
      paragraph([
        reviewNode("review-insertion", "a", [text("x")]),
        reviewNode("review-deletion", "b", [text("y")]),
      ]),
    ]);
    expect(session.exportDocument().status).toBe("valid");
    expect(read(() => $inspectReviewProposal("a"))).toMatchObject({
      value: { kind: "insertion" },
    });
    expect(read(() => $inspectReviewProposal("b"))).toMatchObject({
      value: { kind: "deletion" },
    });
    update(() =>
      expect($resolveReviewProposal("a", "accept").status).toBe("changed"),
    );
    expect(read(() => $inspectReviewProposal("b"))).toMatchObject({
      value: { kind: "deletion", proposal: { text: "y" } },
    });
    expect(session.exportDocument().status).toBe("valid");
  });

  it("an independent insertion coexists with a replacement", () => {
    const { session, read, update } = setup([
      paragraph([
        reviewNode("review-deletion", "p", [text("o")]),
        reviewNode("review-insertion", "p", [text("n")]),
        reviewNode("review-insertion", "q", [text("z")]),
      ]),
    ]);
    expect(session.exportDocument().status).toBe("valid");
    update(() =>
      expect($resolveReviewProposal("q", "reject").status).toBe("changed"),
    );
    expect(read(() => $inspectReviewProposal("p"))).toMatchObject({
      value: { kind: "replacement" },
    });
    expect(session.exportDocument().status).toBe("valid");
  });

  it("formatting adjacent to an insertion keeps both identities", () => {
    const { session, read, update } = setup([paragraph([text("ab")])]);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 1);
      expect($setReviewFormatting({ bold: true }, id("f")).status).toBe(
        "changed",
      );
    });
    update(() => {
      $getRoot().getAllTextNodes().at(-1)!.selectEnd();
      expect($insertReviewText("z", id("g")).status).toBe("changed");
    });
    expect(read(() => $inspectReviewProposal("f"))).toMatchObject({
      value: { kind: "formatting" },
    });
    expect(read(() => $inspectReviewProposal("g"))).toMatchObject({
      value: { kind: "insertion" },
    });
    expect(session.exportDocument().status).toBe("valid");
  });

  it("a split coexists with a later insertion", () => {
    const { session, read, update } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      expect($splitReviewParagraph(id("s")).status).toBe("changed");
    });
    update(() =>
      expect($insertReviewText("X", id("t")).status).toBe("changed"),
    );
    expect(read(() => $inspectReviewProposal("s"))).toMatchObject({
      value: { kind: "structure" },
    });
    expect(read(() => $inspectReviewProposal("t"))).toMatchObject({
      value: { kind: "insertion" },
    });
    expect(session.exportDocument().status).toBe("valid");
  });

  it("a fragment coexists with an independent deletion of accepted text", () => {
    const { session, read, update } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      expect(
        $insertReviewFragment(
          [
            { runs: [{ text: "x", format: 0 }] },
            { runs: [{ text: "y", format: 0 }] },
          ],
          id("f"),
        ).status,
      ).toBe("changed");
    });
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 1);
      expect($deleteReviewText(false).status).toBe("changed");
    });
    expect(read(() => $inspectReviewProposal("f"))).toMatchObject({
      value: { kind: "fragment" },
    });
    expect(session.exportDocument().status).toBe("valid");
  });

  it("stacked formatting on one range extends the same proposal", () => {
    const { read, update } = setup([paragraph([text("ab")])]);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 2);
      expect($setReviewFormatting({ bold: true }, id("f")).status).toBe(
        "changed",
      );
    });
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 2);
      expect($setReviewFormatting({ italic: true }).status).toBe("changed");
    });
    read(() => {
      expect(collectProposalNodes("f").wrappers.length).toBe(1);
      expect($inspectReviewProposal("f")).toMatchObject({
        value: {
          kind: "formatting",
          proposal: { current: [{ text: "ab", format: 3 }] },
        },
      });
    });
  });

  it("formatting wholly inside an insertion corrects the insertion", () => {
    const { read, update } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      expect($insertReviewText("x", id("a")).status).toBe("changed");
    });
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 1);
      expect($setReviewFormatting({ bold: true }).status).toBe("changed");
    });
    read(() => {
      expect($inspectReviewProposal("a")).toMatchObject({
        value: { kind: "insertion", proposal: { text: "x" } },
      });
      expect(collectProposalNodes("a").wrappers.length).toBe(1);
    });
  });
});

describe("compatibility matrix: refusals preserve state and selection", () => {
  it("typing at an element caret between two insertions is ambiguous", () => {
    const { update, snapshot } = setup([
      paragraph([
        reviewNode("review-insertion", "a", [text("x")]),
        reviewNode("review-insertion", "b", [text("y")]),
      ]),
    ]);
    update(() => $getRoot().getFirstChildOrThrow<ParagraphNode>().select(1, 1));
    const before = snapshot();
    update(() =>
      expect($insertReviewText("z", id("c"))).toMatchObject({
        status: "refused",
        code: "ambiguous-boundary",
      }),
    );
    expect(snapshot()).toEqual(before);
  });

  it("fragment creation at an unresolved split boundary is refused", () => {
    const { update, snapshot } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      expect($splitReviewParagraph(id("s")).status).toBe("changed");
    });
    const before = snapshot();
    update(() =>
      expect(
        $insertReviewFragment(
          [
            { runs: [{ text: "x", format: 0 }] },
            { runs: [{ text: "y", format: 0 }] },
          ],
          id("f"),
        ),
      ).toMatchObject({
        status: "refused",
        code: "unsafe-proposal-intersection",
      }),
    );
    expect(snapshot()).toEqual(before);
  });

  it("splitting a paragraph holding a pending merge is refused", () => {
    const { update, snapshot } = setup([
      paragraph([text("AX")]),
      paragraph([text("B")]),
    ]);
    update(() => {
      $getRoot().getAllTextNodes()[1]!.selectStart();
      expect($mergeReviewParagraph(true, id("m")).status).toBe("changed");
    });
    update(() => $getRoot().getAllTextNodes()[0]!.select(1, 1));
    const before = snapshot();
    update(() =>
      expect($splitReviewParagraph(id("s"))).toMatchObject({
        status: "refused",
        code: "unsafe-proposal-intersection",
      }),
    );
    expect(snapshot()).toEqual(before);
  });

  it("merging across fragment ownership is refused", () => {
    // The second paragraph starts inside the fragment (it owns the paragraph
    // break), so targeting reports an ambiguous interior boundary before the
    // merge claim runs. That is the truthful code: the caret has no
    // accepted-side meaning there.
    const { update, snapshot } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      expect(
        $insertReviewFragment(
          [
            { runs: [{ text: "x", format: 0 }] },
            { runs: [{ text: "y", format: 0 }] },
          ],
          id("f"),
        ).status,
      ).toBe("changed");
    });
    update(() => ($getRoot().getChildren()[1] as ParagraphNode).select(0, 0));
    const before = snapshot();
    update(() =>
      expect($mergeReviewParagraph(true, id("m"))).toMatchObject({
        status: "refused",
        code: "ambiguous-boundary",
      }),
    );
    expect(snapshot()).toEqual(before);
  });
});

describe("compatibility matrix: shared identity is rejected live and on import", () => {
  const cases = [
    {
      name: "text identity shared with a boundary",
      inspect: "x",
      buildLive: () => {
        const first = $createParagraphNode().append(
          $createTextNode("A"),
          $createReviewInsertionNode("x").append($createTextNode("i")),
        );
        const second = $createParagraphNode().append(
          $createReviewBoundaryNode("x", "split"),
          $createTextNode("B"),
        );
        $getRoot().append(first, second);
      },
      buildDoc: () => [
        paragraph([
          text("A"),
          reviewNode("review-insertion", "x", [text("i")]),
        ]),
        paragraph([boundaryFixture("x", "split"), text("B")]),
      ],
    },
    {
      name: "insertion ordered before deletion under one identity",
      inspect: "x",
      buildLive: () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createReviewInsertionNode("x").append($createTextNode("a")),
            $createReviewDeletionNode("x").append($createTextNode("b")),
          ),
        );
      },
      buildDoc: () => [
        paragraph([
          reviewNode("review-insertion", "x", [text("a")]),
          reviewNode("review-deletion", "x", [text("b")]),
        ]),
      ],
    },
    {
      name: "noncontiguous wrappers under one identity",
      inspect: "x",
      buildLive: () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createReviewInsertionNode("x").append($createTextNode("a")),
            $createTextNode("m"),
            $createReviewInsertionNode("x").append($createTextNode("b")),
          ),
        );
      },
      buildDoc: () => [
        paragraph([
          reviewNode("review-insertion", "x", [text("a")]),
          text("m"),
          reviewNode("review-insertion", "x", [text("b")]),
        ]),
      ],
    },
    {
      name: "one identity across two paragraphs",
      inspect: "x",
      buildLive: () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createReviewInsertionNode("x").append($createTextNode("a")),
          ),
          $createParagraphNode().append(
            $createReviewInsertionNode("x").append($createTextNode("b")),
          ),
        );
      },
      buildDoc: () => [
        paragraph([reviewNode("review-insertion", "x", [text("a")])]),
        paragraph([reviewNode("review-insertion", "x", [text("b")])]),
      ],
    },
    {
      name: "formatting identity on two wrappers",
      inspect: "f",
      buildLive: () => {
        const accepted = [{ text: "a", format: 0 }];
        $getRoot().append(
          $createParagraphNode().append(
            $createReviewFormattingNode("f", accepted).append(
              $createTextNode("a"),
            ),
            $createReviewFormattingNode("f", accepted).append(
              $createTextNode("a"),
            ),
          ),
        );
      },
      buildDoc: () => [
        paragraph([
          {
            ...reviewNode("review-insertion", "f", [text("a")]),
            type: "review-formatting",
            accepted: [{ text: "a", format: 0 }],
          },
          {
            ...reviewNode("review-insertion", "f", [text("a")]),
            type: "review-formatting",
            accepted: [{ text: "a", format: 0 }],
          },
        ]),
      ],
    },
  ];

  it.each(cases)("$name", (row) => {
    const { read, update } = setup();
    update(row.buildLive);
    read(() =>
      expect($inspectReviewProposal(row.inspect)).toMatchObject({
        status: "refused",
        code: "unsafe-proposal-intersection",
      }),
    );
    read(() =>
      expect($inspectReviewProposalSnapshot(row.inspect)).toMatchObject({
        status: "refused",
        code: "unsafe-proposal-intersection",
      }),
    );
    expect(
      validateReviewDocument(reviewDocument(row.buildDoc())).status,
    ).not.toBe("valid");
  });
});

describe("compatibility matrix: no-op disappearance and removal", () => {
  it("replacing accepted text with identical text and format is unchanged", () => {
    const { update, read, snapshot, session } = setup();
    update(() => $getRoot().getAllTextNodes()[0]!.select(0, 2));
    const before = snapshot();
    update(() =>
      expect($insertReviewText("AB", id("p")).status).toBe("unchanged"),
    );
    expect(snapshot()).toEqual(before);
    expect(session.exportDocument().status).toBe("valid");
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 1);
      expect($insertReviewText("X", id("q")).status).toBe("changed");
    });
    expect(read(() => $inspectReviewProposal("q"))).toMatchObject({
      value: { kind: "replacement", proposal: { oldText: "A", newText: "X" } },
    });
  });

  it("a fully deleted insertion disappears without record", () => {
    const { session, read, update } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      expect($insertReviewText("x", id("a")).status).toBe("changed");
    });
    update(() => expect($deleteReviewText(true).status).toBe("changed"));
    read(() => {
      expect(collectProposalNodes("a").wrappers).toEqual([]);
      expect($inspectReviewProposal("a").status).toBe("refused");
    });
    expect(session.exportDocument().status).toBe("valid");
  });

  it("explicit removal leaves no terminal record", () => {
    const { session, read, update } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1);
      expect($insertReviewText("x", id("a")).status).toBe("changed");
    });
    update(() =>
      expect($resolveReviewProposal("a", "remove").status).toBe("changed"),
    );
    const exported = session.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status === "valid") {
      expect(validateReviewDocument(exported.value).status).toBe("valid");
      expect(JSON.stringify(exported.value)).not.toContain("terminal");
    }
    read(() => expect($inspectReviewProposal("a").status).toBe("refused"));
  });
});
