/**
 * Selective and atomic batch resolution (#59).
 *
 * Core contract under test: stable native IDs resolve against current
 * proposal-bearing nodes with strict preflight-then-mutate, deduped
 * input-order execution, whole-tree structural preflight on every batch,
 * refusal taxonomy (invalid-proposal-id / unsupported-target /
 * unsupported-input / invalid-structural-target /
 * unsafe-proposal-intersection), empty/duplicate/mixed-kind edge semantics,
 * selection recovery without focus side effects, inspect-after-resolve
 * refusal, and pending-only successor export. Order-independence vectors
 * from #56/#57/#58 live in their own specs and are referenced, not
 * duplicated; this file proves the batch mechanics.
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ParagraphNode,
  TextNode,
} from "lexical";
import {
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $deleteReviewText,
  $inspectReviewProposal,
  $insertReviewFragment,
  $insertReviewText,
  $mergeReviewParagraph,
  $resolveReviewProposal,
  $resolveReviewProposals,
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
const contents = () =>
  $getRoot()
    .getChildren()
    .map((node) => node.getTextContent());

function setup(children: unknown[] = [paragraph([text("AB")])]) {
  const editor = createEditor({
    namespace: "resolution",
    nodes: [...NODES],
    onError(error) {
      throw error;
    },
  });
  const input = reviewDocument(children);
  const original = JSON.stringify(input);
  const opened = openReviewSession(editor, input);
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
  return {
    editor,
    input,
    original,
    session: opened.value,
    update,
    read,
    snapshot,
  };
}

it.each(["accept", "reject", "remove"] as const)(
  "batch %s resolves mixed text kinds with one action",
  (action) => {
    const { update, read, session } = setup([
      paragraph([
        reviewNode("review-insertion", "a", [text("x")]),
        reviewNode("review-deletion", "b", [text("AB")]),
        text("CD"),
      ]),
    ]);
    update(() => {
      const nodes = $getRoot().getAllTextNodes();
      const target = nodes[nodes.length - 1]!;
      target.select(0, 2);
      expect($setReviewFormatting({ bold: true }, id("c")).status).toBe(
        "changed",
      );
    });
    update(() =>
      expect($resolveReviewProposals(["a", "b", "c"], action).status).toBe(
        "changed",
      ),
    );
    read(() => {
      expect($inspectReviewProposal("a").status).toBe("refused");
      expect($inspectReviewProposal("b").status).toBe("refused");
      expect($inspectReviewProposal("c").status).toBe("refused");
      if (action === "accept") expect(contents()).toEqual(["xCD"]);
      else expect(contents()).toEqual(["ABCD"]);
    });
    const exported = session.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status === "valid") {
      expect(validateReviewDocument(exported.value).status).toBe("valid");
      expect(JSON.stringify(exported.value)).not.toContain("terminal");
    }
  },
);

it.each(["accept", "reject"] as const)(
  "batch %s resolves repeated splits in input order",
  (action) => {
    const { update, read } = setup([paragraph([text("abcdef")])]);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(2, 2);
      $splitReviewParagraph(id("s1"));
    });
    update(() => {
      $getRoot().getAllTextNodes()[1]!.select(2, 2);
      $splitReviewParagraph(id("s2"));
    });
    update(() =>
      expect($resolveReviewProposals(["s1", "s2"], action).status).toBe(
        "changed",
      ),
    );
    read(() => {
      expect(contents()).toEqual(
        action === "accept" ? ["ab", "cd", "ef"] : ["abcdef"],
      );
      expect($inspectReviewProposal("s1").status).toBe("refused");
      expect($inspectReviewProposal("s2").status).toBe("refused");
    });
  },
);

it("batch of repeated splits is order-independent across separate states", () => {
  for (const order of [
    ["s1", "s2"],
    ["s2", "s1"],
  ] as const) {
    const { update, read } = setup([paragraph([text("abcdef")])]);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(2, 2);
      $splitReviewParagraph(id("s1"));
    });
    update(() => {
      $getRoot().getAllTextNodes()[1]!.select(2, 2);
      $splitReviewParagraph(id("s2"));
    });
    update(() =>
      expect($resolveReviewProposals([...order], "reject").status).toBe(
        "changed",
      ),
    );
    read(() => {
      expect(contents()).toEqual(["abcdef"]);
      expect($inspectReviewProposal(order[0]).status).toBe("refused");
      expect($inspectReviewProposal(order[1]).status).toBe("refused");
    });
  }
});

it("selective batch leaves the unlisted survivor pending with identity intact", () => {
  const { update, read, session } = setup([
    paragraph([
      text("AB"),
      reviewNode("review-insertion", "a", [text("x")]),
      reviewNode("review-insertion", "b", [text("y")]),
    ]),
  ]);
  update(() =>
    expect($resolveReviewProposals(["a"], "accept").status).toBe("changed"),
  );
  read(() => {
    expect(contents()).toEqual(["ABxy"]);
    expect($inspectReviewProposal("a").status).toBe("refused");
    expect($inspectReviewProposal("b")).toMatchObject({
      value: { kind: "insertion", proposal: { text: "y" } },
    });
  });
  const exported = session.exportDocument();
  expect(exported.status).toBe("valid");
  if (exported.status === "valid")
    expect(JSON.stringify(exported.value)).toContain('"proposalId":"b"');
});

it.each(["accept", "reject", "remove"] as const)(
  "empty batch %s is unchanged without mutation",
  (action) => {
    const { update, snapshot } = setup();
    const before = snapshot();
    update(() =>
      expect($resolveReviewProposals([], action).status).toBe("unchanged"),
    );
    expect(snapshot()).toEqual(before);
  },
);

it.each(["accept", "reject", "remove"] as const)(
  "duplicate batch %s resolves once",
  (action) => {
    const { update, read } = setup([
      paragraph([text("AB"), reviewNode("review-insertion", "a", [text("x")])]),
    ]);
    update(() =>
      expect($resolveReviewProposals(["a", "a", "a"], action).status).toBe(
        "changed",
      ),
    );
    read(() => {
      expect(contents()).toEqual(action === "accept" ? ["ABx"] : ["AB"]);
      expect($inspectReviewProposal("a").status).toBe("refused");
    });
  },
);

it("refusal taxonomy pins first-failure-in-input-order with zero mutation", () => {
  const cases: Array<{
    name: string;
    setupIds: () => void;
    ids: string[];
    code: string;
  }> = [
    {
      name: "malformed identity",
      setupIds: () => {},
      ids: [" a ", "missing-too"],
      code: "invalid-proposal-id",
    },
    {
      name: "unknown identity",
      setupIds: () => {},
      ids: ["missing"],
      code: "unsupported-target",
    },
  ];
  for (const { name, setupIds, ids, code } of cases) {
    const { update, snapshot } = setup();
    update(setupIds);
    const before = snapshot();
    update(() =>
      expect($resolveReviewProposals(ids, "accept")).toMatchObject({
        status: "refused",
        code,
      }),
    );
    expect(snapshot(), name).toEqual(before);
  }
});

it("first failure wins in input order", () => {
  const { update, snapshot } = setup();
  const before = snapshot();
  update(() =>
    expect(
      $resolveReviewProposals(["missing", " bad "], "accept"),
    ).toMatchObject({
      status: "refused",
      code: "unsupported-target",
    }),
  );
  expect(snapshot()).toEqual(before);
  update(() =>
    expect(
      $resolveReviewProposals([" bad ", "missing"], "accept"),
    ).toMatchObject({
      status: "refused",
      code: "invalid-proposal-id",
    }),
  );
  expect(snapshot()).toEqual(before);
});

it("resolved identity inspects as unsupported-target afterwards", () => {
  const { update, read, snapshot } = setup([
    paragraph([text("AB"), reviewNode("review-insertion", "a", [text("x")])]),
  ]);
  update(() => $getRoot().getAllTextNodes()[1]!.selectEnd());
  const selectionBefore = snapshot().selection;
  update(() =>
    expect($resolveReviewProposal("a", "accept").status).toBe("changed"),
  );
  read(() => {
    expect($inspectReviewProposal("a")).toMatchObject({
      status: "refused",
      code: "unsupported-target",
    });
    const selection = $getSelection();
    expect($isRangeSelection(selection)).toBe(true);
    expect(selectionBefore).not.toBeNull();
  });
});

it("inspecting a malformed identity is invalid-proposal-id without side effects", () => {
  const { read, snapshot } = setup();
  const before = snapshot();
  read(() => {
    expect($inspectReviewProposal(" bad ")).toMatchObject({
      status: "refused",
      code: "invalid-proposal-id",
    });
  });
  expect(snapshot()).toEqual(before);
});

it("text-only batch refuses invalid unrelated structure without mutation", () => {
  const { update, snapshot } = setup([
    paragraph([
      text("AB"),
      reviewNode("review-insertion", "a", [text("x")]),
      reviewNode("review-deletion", "b", [text("y")]),
    ]),
  ]);
  update(() => {
    $getRoot().getLastChildOrThrow<ParagraphNode>().setIndent(1);
  });
  const before = snapshot();
  update(() =>
    expect($resolveReviewProposals(["a", "b"], "accept")).toMatchObject({
      status: "refused",
    }),
  );
  expect(snapshot()).toEqual(before);
});

it("mixed batch with one unknown identity refuses before any mutation", () => {
  const { update, read, snapshot } = setup([
    paragraph([
      reviewNode("review-insertion", "a", [text("x")]),
      reviewNode("review-deletion", "b", [text("y")]),
      text("CD"),
    ]),
  ]);
  update(() => {
    const nodes = $getRoot().getAllTextNodes();
    const target = nodes[nodes.length - 1]!;
    target.select(0, 2);
    expect($setReviewFormatting({ bold: true }, id("c")).status).toBe(
      "changed",
    );
  });
  const before = snapshot();
  update(() =>
    expect(
      $resolveReviewProposals(["a", "missing", "c"], "accept"),
    ).toMatchObject({
      status: "refused",
      code: "unsupported-target",
    }),
  );
  expect(snapshot()).toEqual(before);
  read(() => {
    expect($inspectReviewProposal("a").status).toBe("unchanged");
    expect($inspectReviewProposal("c").status).toBe("unchanged");
  });
});

it("composition-active batch refuses without mutation", () => {
  const { editor, update, snapshot } = setup([
    paragraph([reviewNode("review-insertion", "a", [text("x")])]),
  ]);
  const composing = vi.spyOn(editor, "isComposing").mockReturnValue(true);
  try {
    const before = snapshot();
    update(() =>
      expect($resolveReviewProposals(["a"], "accept")).toMatchObject({
        status: "refused",
        code: "unsupported-input",
      }),
    );
    expect(snapshot()).toEqual(before);
  } finally {
    composing.mockRestore();
  }
});

it("unexpected mutation failure rolls back content and selection", () => {
  const errors: Error[] = [];
  const editor = createEditor({
    namespace: "resolution-rollback",
    nodes: [...NODES],
    onError: (error) => {
      errors.push(error);
    },
  });
  const opened = openReviewSession(
    editor,
    reviewDocument([
      paragraph([
        reviewNode("review-insertion", "a", [text("x")]),
        reviewNode("review-insertion", "b", [text("y")]),
      ]),
    ]),
  );
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  const selectionSnapshot = () =>
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection)
        ? {
            anchor: {
              key: selection.anchor.key,
              offset: selection.anchor.offset,
              type: selection.anchor.type,
            },
            focus: {
              key: selection.focus.key,
              offset: selection.focus.offset,
              type: selection.focus.type,
            },
          }
        : null;
    });
  update(() => $getRoot().getAllTextNodes()[0]!.select(0, 0));
  const before = editor.getEditorState();
  const selection = selectionSnapshot();
  // Failure-injection exception (allowed system boundary): a mid-mutation
  // Lexical throw is unreachable via public resolution input. Stubbing
  // selectEnd is the only way to prove the rollback below.
  const original = TextNode.prototype.selectEnd;
  const spy = vi
    .spyOn(TextNode.prototype, "selectEnd")
    .mockImplementationOnce(function (this: TextNode) {
      original.apply(this);
      throw new Error("after select");
    });
  try {
    update(() => {
      $resolveReviewProposals(["a", "b"], "accept");
    });
  } finally {
    spy.mockRestore();
  }
  // Lexical discards the pending update and reports through onError; the
  // throw propagates rather than returning `failed` from inside the update.
  expect(errors).toHaveLength(1);
  expect(editor.getEditorState().toJSON()).toEqual(before.toJSON());
  expect(selectionSnapshot()).toEqual(selection);
});

it("resolves a normalized fragment under its current insertion kind", () => {
  const { update, read, session } = setup([paragraph([text("AB")])]);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(1, 1);
    expect($insertReviewFragment(fragment("x\ny"), id("f")).status).toBe(
      "changed",
    );
  });
  update(() => {
    const parts = $getRoot()
      .getChildren<ParagraphNode>()
      .flatMap((node) =>
        node
          .getChildren()
          .filter((child) => child instanceof ReviewFragmentNode),
      );
    parts[1]!.selectStart();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  read(() => {
    expect(contents()).toEqual(["AxyB"]);
    expect($inspectReviewProposal("f")).toMatchObject({
      value: { kind: "insertion", proposal: { text: "xy" } },
    });
  });
  update(() =>
    expect($resolveReviewProposals(["f"], "accept").status).toBe("changed"),
  );
  read(() => {
    expect(contents()).toEqual(["AxyB"]);
    expect($inspectReviewProposal("f").status).toBe("refused");
  });
  expect(session.exportDocument().status).toBe("valid");
});

it("resolves current edited content, not the creation snapshot", () => {
  const { update, read } = setup([
    paragraph([text("AB"), reviewNode("review-insertion", "a", [text("x")])]),
  ]);
  update(() => {
    $getRoot().getAllTextNodes()[1]!.selectEnd();
    expect($insertReviewText("yz").status).toBe("changed");
  });
  read(() => {
    expect($inspectReviewProposal("a")).toMatchObject({
      value: { kind: "insertion", proposal: { text: "xyz" } },
    });
  });
  update(() =>
    expect($resolveReviewProposals(["a"], "accept").status).toBe("changed"),
  );
  read(() => expect(contents()).toEqual(["ABxyz"]));
});

it("untouched selection survives batch resolution exactly", () => {
  const { update, read } = setup([
    paragraph([
      text("keep "),
      reviewNode("review-insertion", "a", [text("x")]),
    ]),
  ]);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 0);
  });
  const selectionBefore = read(() => {
    const selection = $getSelection();
    return $isRangeSelection(selection)
      ? [selection.anchor.key, selection.anchor.offset]
      : null;
  });
  update(() =>
    expect($resolveReviewProposals(["a"], "accept").status).toBe("changed"),
  );
  read(() => {
    const selection = $getSelection();
    expect($isRangeSelection(selection)).toBe(true);
    if ($isRangeSelection(selection) && selectionBefore) {
      expect([selection.anchor.key, selection.anchor.offset]).toEqual(
        selectionBefore,
      );
    }
  });
});

it("merge resolves through the batch with survivor identity intact", () => {
  const { update, read, session } = setup([
    paragraph([text("left")]),
    paragraph([text("right")]),
  ]);
  update(() => {
    $getRoot().getAllTextNodes()[1]!.selectStart();
    expect($mergeReviewParagraph(true, id("m")).status).toBe("changed");
  });
  update(() => {
    $getRoot().getAllTextNodes()[0]!.selectEnd();
    expect($insertReviewText("!", id("t")).status).toBe("changed");
  });
  update(() =>
    expect($resolveReviewProposals(["m", "t"], "reject").status).toBe(
      "changed",
    ),
  );
  read(() => {
    expect(contents()).toEqual(["left", "right"]);
    expect($inspectReviewProposal("m").status).toBe("refused");
    expect($inspectReviewProposal("t").status).toBe("refused");
  });
  expect(session.exportDocument().status).toBe("valid");
});

it("successor export after batch resolution keeps pending work only", () => {
  const { update, session } = setup([
    paragraph([
      reviewNode("review-insertion", "a", [text("x")]),
      reviewNode("review-insertion", "b", [text("y")]),
    ]),
  ]);
  update(() =>
    expect($resolveReviewProposals(["a", "b"], "accept").status).toBe(
      "changed",
    ),
  );
  const exported = session.exportDocument();
  expect(exported.status).toBe("valid");
  if (exported.status !== "valid") return;
  expect(validateReviewDocument(exported.value).status).toBe("valid");
  const serialized = JSON.stringify(exported.value);
  expect(serialized).not.toContain('"proposalId":"a"');
  expect(serialized).not.toContain('"proposalId":"b"');
  expect(serialized).not.toContain("terminal");
});

it("batch remove matches reject mechanics with distinct intent", () => {
  const { update, read } = setup([
    paragraph([
      reviewNode("review-insertion", "a", [text("x")]),
      reviewNode("review-deletion", "b", [text("AB")]),
    ]),
  ]);
  update(() =>
    expect($resolveReviewProposals(["a", "b"], "remove").status).toBe(
      "changed",
    ),
  );
  read(() => {
    expect(contents()).toEqual(["AB"]);
    expect($inspectReviewProposal("a").status).toBe("refused");
    expect($inspectReviewProposal("b").status).toBe("refused");
  });
});

it("direct node construction cannot bypass batch preflight", () => {
  const { update, snapshot } = setup([paragraph([text("AB")])]);
  update(() => {
    const anchor = $getRoot().getAllTextNodes()[0]!;
    anchor.insertBefore(
      $createReviewInsertionNode("p").append(new TextNode("X")),
    );
    anchor.insertAfter(
      $createReviewDeletionNode("p").append(new TextNode("Y")),
    );
    anchor.selectStart();
  });
  const before = snapshot();
  update(() => {
    expect($resolveReviewProposal("p", "accept").status).toBe("refused");
    expect($resolveReviewProposals(["p"], "accept").status).toBe("refused");
  });
  expect(snapshot()).toEqual(before);
});
