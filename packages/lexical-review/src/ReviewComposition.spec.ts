import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  DELETE_CHARACTER_COMMAND,
  createEditor,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import {
  $insertReviewFragment,
  $inspectReviewProposal,
  $resolveReviewProposal,
  $splitReviewParagraph,
  $toggleReviewFormatting,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
} from "./index";
import {
  registerReviewSession,
  type ReviewIntentOutcome,
} from "./registerReviewSession";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function proposal(
  kind: "review-deletion" | "review-insertion",
  proposalId: string,
  value: string,
  format = 0,
) {
  return reviewNode(kind, proposalId, [text(value, format)]);
}

function createReviewEditor(): LexicalEditor {
  return createEditor({
    namespace: "review-composition",
    nodes: [
      ReviewFragmentNode,
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewBoundaryNode,
    ],
    onError: (error) => {
      throw error;
    },
    theme: {
      del: "review-deletion",
      ins: "review-insertion",
    },
  });
}

async function update(
  editor: LexicalEditor,
  callback: () => void,
): Promise<void> {
  editor.update(callback, { discrete: true });
  await Promise.resolve();
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function liveSelection() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return null;
  }
  return {
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
  };
}

function firstParagraph(): ElementNode {
  const paragraphNode = $getRoot().getFirstChild();
  if (!$isElementNode(paragraphNode)) {
    throw new Error("Expected a paragraph in the review document.");
  }
  return paragraphNode;
}

function firstText(node: ElementNode): TextNode {
  const textNode = node.getFirstChild();
  if (!$isTextNode(textNode)) {
    throw new Error("Expected a text node.");
  }
  return textNode;
}

function open(
  editor: LexicalEditor,
  input: unknown,
  outcomes: ReviewIntentOutcome[] = [],
  options: Parameters<typeof registerReviewSession>[2] = {},
) {
  const opened = openReviewSession(editor, input);
  expect(opened.status).toBe("valid");
  if (opened.status !== "valid") {
    throw new Error("Expected the node-backed review document to open.");
  }
  const unregister = registerReviewSession(editor, opened.value, {
    ...options,
    onOutcome: (outcome) => {
      outcomes.push(outcome);
      options.onOutcome?.(outcome);
    },
  });
  // Composition completion flows through Lexical's DOM-synced
  // $onCompositionEndImpl, which requires a root element window even though
  // the adapter discards the native commit via snapshot restore.
  const rootElement = document.createElement("div");
  document.body.append(rootElement);
  editor.setRootElement(rootElement);
  const unregisterAll = () => {
    unregister();
    editor.setRootElement(null);
    rootElement.remove();
  };
  return { opened: opened.value, unregister: unregisterAll };
}

async function startComposition(editor: LexicalEditor): Promise<void> {
  expect(
    editor.dispatchCommand(
      COMPOSITION_START_COMMAND,
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    ),
  ).toBe(true);
  await flush();
}

async function commitComposition(
  editor: LexicalEditor,
  data: string,
): Promise<void> {
  editor.dispatchCommand(
    COMPOSITION_END_COMMAND,
    new CompositionEvent("compositionend", {
      bubbles: true,
      cancelable: true,
      data,
    }),
  );
  await flush();
}

describe("composition normalization (#64)", () => {
  it("commits inline IME text as one insertion proposal", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { proposalIdFactory: () => "composition-a" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    await startComposition(editor);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(outcomes).toHaveLength(1);
    editor.getEditorState().read(() => {
      const children = firstParagraph().getChildren();
      expect(children.map((child) => child.getTextContent())).toEqual([
        "A",
        "あ",
        "B",
      ]);
      expect($isElementNode(children[1])).toBe(true);
      if ($isElementNode(children[1])) {
        expect((children[1] as ReviewInsertionNode).getProposalId()).toBe(
          "composition-a",
        );
      }
    });
    unregister();
  });

  it("commits non-BMP emoji text with UTF-16-safe offsets", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { proposalIdFactory: () => "composition-emoji" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).selectEnd();
    });
    await startComposition(editor);
    await commitComposition(editor, "😀");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    editor.getEditorState().read(() => {
      expect(firstParagraph().getTextContent()).toBe("AB😀");
    });
    unregister();
  });

  it("normalizes a commit over an accepted range into one replacement", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { proposalIdFactory: () => "composition-replacement" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(0, 2);
    });
    await startComposition(editor);
    await commitComposition(editor, "かん");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(outcomes).toHaveLength(1);
    editor.getEditorState().read(() => {
      const inspected = $inspectReviewProposal("composition-replacement");
      expect(inspected.status).toBe("unchanged");
      if (inspected.status !== "unchanged") return;
      expect(inspected.value).toMatchObject({
        kind: "replacement",
        proposal: {
          newText: "かん",
          oldText: "AB",
          proposalId: "composition-replacement",
        },
      });
    });
    unregister();
  });

  it("treats an empty collapsed completion as unchanged without mutation", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    await startComposition(editor);
    await commitComposition(editor, "");

    expect(outcomes).toMatchObject([{ status: "unchanged" }]);
    expect(outcomes).toHaveLength(1);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("normalizes an empty commit over a range into one deletion", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { proposalIdFactory: () => "composition-deletion" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(0, 1);
    });
    await startComposition(editor);
    await commitComposition(editor, "");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    editor.getEditorState().read(() => {
      const inspected = $inspectReviewProposal("composition-deletion");
      expect(inspected.status).toBe("unchanged");
      if (inspected.status !== "unchanged") return;
      expect(inspected.value).toMatchObject({ kind: "deletion" });
    });
    unregister();
  });

  it("refuses a trailing-newline commit without mutation", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph()).selectEnd();
    });
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    await startComposition(editor);
    await commitComposition(editor, "確定\n");

    expect(outcomes).toMatchObject([
      { code: "unsupported-input", status: "refused" },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    editor.getEditorState().read(() => {
      expect($getRoot().getChildren()).toHaveLength(1);
    });
    unregister();
  });

  it("continues a pending insertion under the same identity", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([proposal("review-insertion", "insertion-a", "BC")]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      const insertion = firstParagraph().getChildAtIndex(0);
      if (!$isElementNode(insertion)) {
        throw new Error("Expected an insertion wrapper.");
      }
      firstText(insertion).select(1, 1);
    });
    await startComposition(editor);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    editor.getEditorState().read(() => {
      const insertion = firstParagraph().getChildAtIndex(0);
      expect(insertion?.getTextContent()).toBe("BあC");
      expect($isElementNode(insertion)).toBe(true);
      if ($isElementNode(insertion)) {
        expect((insertion as ReviewInsertionNode).getProposalId()).toBe(
          "insertion-a",
        );
      }
    });
    unregister();
  });

  it("corrects a fragment under the same identity without nesting", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
      expect(
        $insertReviewFragment(
          [
            { runs: [{ text: "x", format: 0 }] },
            { runs: [{ text: "y", format: 0 }] },
          ],
          { proposalIdFactory: () => "fragment-a" },
        ).status,
      ).toBe("changed");
    });
    outcomes.length = 0;
    await update(editor, () => {
      const fragment = firstParagraph().getChildAtIndex(1);
      if (!$isElementNode(fragment)) {
        throw new Error("Expected a fragment component.");
      }
      firstText(fragment).selectEnd();
    });
    await startComposition(editor);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(outcomes).toHaveLength(1);
    editor.getEditorState().read(() => {
      const paragraphs = $getRoot().getChildren();
      expect(paragraphs).toHaveLength(2);
      expect(
        paragraphs[0]?.getChildren().map((child) => child.getTextContent()),
      ).toEqual(["A", "xあ"]);
      expect(
        paragraphs[1]?.getChildren().map((child) => child.getTextContent()),
      ).toEqual(["y", "B"]);
      for (const paragraphNode of paragraphs) {
        for (const child of paragraphNode?.getChildren() ?? []) {
          if (child.getType() === "review-fragment" && $isElementNode(child)) {
            expect((child as ReviewFragmentNode).getProposalId()).toBe(
              "fragment-a",
            );
          }
        }
      }
    });
    unregister();
  });

  it("refuses composition inside pending formatting without mutation", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(0, 2);
      expect($toggleReviewFormatting("italic").status).toBe("changed");
    });
    outcomes.length = 0;
    await update(editor, () => {
      const formatting = firstParagraph().getChildAtIndex(0);
      if (!$isElementNode(formatting)) {
        throw new Error("Expected a formatting wrapper.");
      }
      firstText(formatting).select(1, 1);
    });
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    await startComposition(editor);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([
      { code: "unsupported-proposal-edit", status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("refuses composition at an ambiguous proposal boundary", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          proposal("review-insertion", "insertion-a", "B"),
          text("C"),
        ]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      firstParagraph().select(1, 1);
    });
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    await startComposition(editor);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([
      { code: "ambiguous-boundary", status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("keeps intermediate controlled insertions as adapter state", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { proposalIdFactory: () => "composition-adapter" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    await startComposition(editor);
    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "x")).toBe(
      true,
    );
    expect(outcomes).toHaveLength(0);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(outcomes).toHaveLength(1);
    editor.getEditorState().read(() => {
      expect(firstParagraph().getTextContent()).toBe("AあB");
    });
    unregister();
  });

  it("claims Safari-style insertFromComposition plus compositionend once", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { proposalIdFactory: () => "composition-dedup" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    await startComposition(editor);
    expect(
      editor.dispatchCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        new InputEvent("beforeinput", {
          bubbles: true,
          data: "あ",
          inputType: "insertFromComposition",
        }),
      ),
    ).toBe(true);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(outcomes).toHaveLength(1);
    editor.getEditorState().read(() => {
      expect(firstParagraph().getTextContent()).toBe("AあB");
    });
    unregister();
  });

  it("leaves deletion routes unclaimed while composing", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    await startComposition(editor);
    const beforeDocument = editor.getEditorState().toJSON();
    expect(editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true)).toBe(false);
    expect(outcomes).toHaveLength(0);
    await commitComposition(editor, "");

    expect(outcomes).toMatchObject([{ status: "unchanged" }]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    unregister();
  });

  it("refuses factory failure without mutation", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      {
        proposalIdFactory: () => {
          throw new Error("factory failed");
        },
      },
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    const beforeDocument = editor.getEditorState().toJSON();
    await startComposition(editor);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([
      { code: "invalid-proposal-id", status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    unregister();
  });

  it("reports failed with snapshot recovery when the apply update throws", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { proposalIdFactory: () => "composition-failed" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    await startComposition(editor);
    const applyUpdate = vi
      .spyOn(editor, "update")
      .mockImplementationOnce(() => {
        throw new Error("apply failed");
      });
    await commitComposition(editor, "あ");
    applyUpdate.mockRestore();

    expect(outcomes).toMatchObject([
      {
        error: { code: "composition-normalization-failed" },
        status: "failed",
      },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    editor.getEditorState().read(() => {
      expect($inspectReviewProposal("composition-failed").status).not.toBe(
        "unchanged",
      );
    });
    unregister();
  });

  it("refuses resolution while composition is active", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([proposal("review-insertion", "insertion-a", "B")]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      const insertion = firstParagraph().getChildAtIndex(0);
      if (!$isElementNode(insertion)) {
        throw new Error("Expected an insertion wrapper.");
      }
      firstText(insertion).select(1, 1);
    });
    await startComposition(editor);
    expect(editor.isComposing()).toBe(true);
    await update(editor, () => {
      expect($resolveReviewProposal("insertion-a", "accept")).toMatchObject({
        code: "unsupported-input",
        status: "refused",
      });
    });
    expect(outcomes).toHaveLength(0);
    await commitComposition(editor, "");

    editor.getEditorState().read(() => {
      expect($inspectReviewProposal("insertion-a").status).toBe("unchanged");
    });
    unregister();
  });

  it("coexists with an independent split elsewhere", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")]), paragraph([text("CD")])]),
      outcomes,
      { proposalIdFactory: () => "composition-coexist" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).selectEnd();
      expect($splitReviewParagraph().status).toBe("changed");
    });
    outcomes.length = 0;
    await update(editor, () => {
      const last = $getRoot().getLastChild();
      if (!$isElementNode(last)) {
        throw new Error("Expected paragraphs after the split.");
      }
      const target = last.getFirstChild();
      if (!$isTextNode(target)) {
        throw new Error("Expected accepted text in the last paragraph.");
      }
      target.selectEnd();
    });
    await startComposition(editor);
    await commitComposition(editor, "あ");

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    editor.getEditorState().read(() => {
      expect($getRoot().getChildren()).toHaveLength(3);
      expect($getRoot().getTextContent()).toContain("あ");
    });
    unregister();
  });
});
