import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  TextNode,
  createEditor,
} from "lexical";
import {
  $acceptReviewInsertion,
  $deleteReviewText,
  $inspectReviewInsertion,
  $insertReviewText,
  $rejectReviewInsertion,
  $removeReviewInsertion,
  $isReviewInsertionNode,
  openReviewSession,
  ReviewInsertionNode,
  ReviewDeletionNode,
  type ReviewIntentOutcome,
} from "./index";
import { registerReviewSession } from "./client";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function setup(children: unknown[] = [text("AB")]) {
  const errors: Error[] = [];
  const editor = createEditor({
    namespace: "insertion-authoring",
    nodes: [ReviewInsertionNode, ReviewDeletionNode],
    onError: (error) => {
      errors.push(error);
    },
  });
  const opened = openReviewSession(
    editor,
    reviewDocument([paragraph(children)]),
  );
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  return { editor, session: opened.value, errors };
}

function selectAccepted(offset: number) {
  const node = $getRoot().getAllTextNodes()[0]!;
  node.select(offset, offset);
}

function selectionSnapshot() {
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
        format: selection.format,
        style: selection.style,
      }
    : null;
}

it.each(["root", "client"] as const)(
  "authors, navigates, corrects and reopens the same identity through %s",
  async (route) => {
    const { editor, session } = setup();
    const outcomes: ReviewIntentOutcome[] = [];
    const factory = vi.fn(() => "insertion");
    const unregister = registerReviewSession(editor, session, {
      proposalIdFactory: factory,
      onOutcome: (value) => outcomes.push(value),
    });
    const insert = (value: string) =>
      editor.update(
        () => {
          if (route === "root")
            outcomes.push(
              $insertReviewText(value, { proposalIdFactory: factory }),
            );
          else editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, value);
        },
        { discrete: true },
      );
    editor.update(() => selectAccepted(1), { discrete: true });
    insert("new");
    // Navigate away, then return through the accepted side after the proposal.
    editor.update(
      () => {
        const nodes = $getRoot().getAllTextNodes();
        nodes[0]!.selectStart();
      },
      { discrete: true },
    );
    editor.update(() => $getRoot().getAllTextNodes().at(-1)!.selectStart(), {
      discrete: true,
    });
    insert("!");
    editor.update(() => $getRoot().getAllTextNodes()[1]!.select(0, 3), {
      discrete: true,
    });
    insert("corrected");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "changed",
      "changed",
      "changed",
    ]);
    expect(
      editor.getEditorState().read(() => $inspectReviewInsertion("insertion")),
    ).toEqual({
      status: "unchanged",
      value: { proposalId: "insertion", text: "corrected!" },
    });
    expect(editor.getEditorState().read(selectionSnapshot)).toMatchObject({
      anchor: { offset: 9 },
      focus: { offset: 9 },
    });
    const saved = session.exportDocument();
    expect(saved.status).toBe("valid");
    if (saved.status !== "valid") return;
    const reopened = setup();
    expect(openReviewSession(reopened.editor, saved.value).status).toBe(
      "valid",
    );
    expect(
      reopened.editor
        .getEditorState()
        .read(() => $inspectReviewInsertion("insertion")),
    ).toEqual(
      editor.getEditorState().read(() => $inspectReviewInsertion("insertion")),
    );
    await Promise.resolve();
    unregister();
  },
);

it.each([
  ["accept", $acceptReviewInsertion, "AXB"],
  ["reject", $rejectReviewInsertion, "AB"],
  ["remove", $removeReviewInsertion, "AB"],
] as const)(
  "%s settles the entire insertion and preserves formatting without a terminal record",
  (_name, settle, expected) => {
    const { editor, session } = setup([
      text("A"),
      reviewNode("review-insertion", "p", [text("X", 1)]),
      text("B"),
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    editor.setRootElement(root);
    editor.update(() => $getRoot().getAllTextNodes()[1]!.selectEnd(), {
      discrete: true,
    });
    expect(root.querySelector("ins > strong")?.textContent).toBe("X");
    editor.update(() => expect(settle("p").status).toBe("changed"), {
      discrete: true,
    });
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe(expected);
    expect(root.querySelector("ins")).toBeNull();
    if (_name === "accept")
      expect(root.querySelector("strong")?.textContent).toBe("X");
    expect(JSON.stringify(session.exportDocument())).not.toContain(
      '"proposalId"',
    );
    expect(editor.getEditorState().read(selectionSnapshot)).not.toBeNull();
    editor.setRootElement(null);
    root.remove();
  },
);

it("refuses identity factory failures without changing state or selection", () => {
  const { editor } = setup();
  editor.update(() => selectAccepted(1), { discrete: true });
  const before = editor.getEditorState();
  const selection = before.read(selectionSnapshot);
  editor.update(
    () => {
      expect(
        $insertReviewText("X", {
          proposalIdFactory: () => {
            throw new Error("factory failed");
          },
        }),
      ).toMatchObject({ status: "refused", code: "invalid-proposal-id" });
    },
    { discrete: true },
  );
  expect(editor.getEditorState().toJSON()).toEqual(before.toJSON());
  expect(editor.getEditorState().read(selectionSnapshot)).toEqual(selection);
});

it.each(["root", "client"] as const)(
  "rolls back an unexpected mutation failure on the %s route",
  (route) => {
    const { editor, session, errors } = setup();
    registerReviewSession(editor, session);
    editor.update(() => selectAccepted(1), { discrete: true });
    const before = editor.getEditorState();
    const selection = before.read(selectionSnapshot);
    const original = TextNode.prototype.splitText;
    const spy = vi
      .spyOn(TextNode.prototype, "splitText")
      .mockImplementation(function (this: TextNode, ...offsets) {
        original.apply(this, offsets);
        throw new Error("after split");
      });
    try {
      editor.update(
        () => {
          if (route === "root") $insertReviewText("X");
          else editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X");
        },
        { discrete: true },
      );
    } finally {
      spy.mockRestore();
    }
    expect(errors).toHaveLength(1);
    expect(editor.getEditorState().toJSON()).toEqual(before.toJSON());
    expect(editor.getEditorState().read(selectionSnapshot)).toEqual(selection);
  },
);

it("refuses resolution of a disconnected or unknown identity atomically", () => {
  const { editor } = setup();
  editor.update(
    () => {
      const paragraph = $getRoot().getFirstChildOrThrow();
      // Deliberately create a malformed live identity, bypassing native import validation.
      if (!("append" in paragraph)) throw new Error("Expected paragraph");
      const node = $getRoot().getAllTextNodes()[0]!;
      node.insertBefore(new ReviewInsertionNode("p").append(new TextNode("X")));
      node.insertAfter(new ReviewInsertionNode("p").append(new TextNode("Y")));
      node.selectStart();
    },
    { discrete: true },
  );
  const before = editor.getEditorState();
  for (const id of ["p", "missing"])
    editor.update(
      () => {
        expect($acceptReviewInsertion(id).status).toBe("refused");
      },
      { discrete: true },
    );
  expect(editor.getEditorState().toJSON()).toEqual(before.toJSON());
  expect(editor.getEditorState().read(selectionSnapshot)).toEqual(
    before.read(selectionSnapshot),
  );
});

it("creates a separate proposal at an incompatible accepted formatting boundary", () => {
  const { editor } = setup([
    text("A"),
    reviewNode("review-insertion", "p", [text("X")]),
  ]);
  editor.update(
    () => {
      $getRoot().getAllTextNodes()[0]!.setFormat(1);
      selectAccepted(1);
      $insertReviewText("B", { proposalIdFactory: () => "q" });
    },
    { discrete: true },
  );
  editor.getEditorState().read(() => {
    const proposals = $getRoot()
      .getAllTextNodes()
      .map((node) => node.getParent())
      .filter($isReviewInsertionNode);
    expect(proposals.map((node) => node.getProposalId())).toEqual(["q", "p"]);
    const child = proposals[0]!.getFirstChild();
    expect($isTextNode(child) && child.hasFormat("bold")).toBe(true);
  });
});

it("generates identity immediately and refuses an exhausted duplicate factory", () => {
  const { editor, session } = setup();
  editor.update(
    () => {
      selectAccepted(1);
      expect($insertReviewText("X").status).toBe("changed");
    },
    { discrete: true },
  );
  const id = editor.getEditorState().read(() => {
    const parent = $getRoot().getAllTextNodes()[1]!.getParent();
    if (!$isReviewInsertionNode(parent)) throw new Error("Expected insertion");
    return parent.getProposalId();
  });
  expect(id.length).toBeGreaterThan(0);
  expect(session.exportDocument().status).toBe("valid");
  editor.update(() => selectAccepted(0), { discrete: true });
  const before = editor.getEditorState();
  editor.update(
    () =>
      expect(
        $insertReviewText("Y", { proposalIdFactory: () => id }),
      ).toMatchObject({ status: "refused", code: "invalid-proposal-id" }),
    { discrete: true },
  );
  expect(editor.getEditorState().toJSON()).toEqual(before.toJSON());
  expect(editor.getEditorState().read(selectionSnapshot)).toEqual(
    before.read(selectionSnapshot),
  );
});

it.each([
  ["delete", false],
  ["delete", true],
  ["replace", false],
  ["replace", true],
] as const)(
  "%s across formatted insertion wrappers preserves identity and removes empty wrappers (backward=%s)",
  (operation, backward) => {
    const { editor, session, errors } = setup([
      reviewNode("review-insertion", "p", [text("ab", 1)]),
      reviewNode("review-insertion", "p", [text("cd", 2)]),
      reviewNode("review-insertion", "p", [text("ef", 8)]),
    ]);
    editor.update(
      () => {
        const nodes = $getRoot().getAllTextNodes();
        const first = nodes[0]!;
        const last = nodes[2]!;
        first.select(1, 1);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error("Expected a range");
        selection.anchor.set(
          backward ? last.getKey() : first.getKey(),
          backward ? 2 : 1,
          "text",
        );
        selection.focus.set(
          backward ? first.getKey() : last.getKey(),
          backward ? 1 : 2,
          "text",
        );
        const outcome =
          operation === "replace"
            ? $insertReviewText("X")
            : $deleteReviewText(backward);
        expect(outcome.status).toBe("changed");
      },
      { discrete: true },
    );
    const expectedText = operation === "replace" ? "aX" : "a";
    editor.getEditorState().read(() => {
      const paragraphNode = $getRoot().getFirstChildOrThrow();
      const nodes = $getRoot().getAllTextNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.getTextContent()).toBe(expectedText);
      expect(nodes[0]!.getFormat()).toBe(1);
      expect(nodes[0]!.getParent()!.getParent()).toBe(paragraphNode);
      expect(nodes[0]!.getParent()!.getParent()!.getChildrenSize()).toBe(1);
      expect($inspectReviewInsertion("p")).toEqual({
        status: "unchanged",
        value: { proposalId: "p", text: expectedText },
      });
    });
    const saved = session.exportDocument();
    expect(saved.status).toBe("valid");
    expect(errors).toEqual([]);
  },
);
