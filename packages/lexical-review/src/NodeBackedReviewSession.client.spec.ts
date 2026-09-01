import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  REMOVE_TEXT_COMMAND,
  createEditor,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import {
  openReviewSession,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./index";
import { registerReviewSession } from "./registerReviewSession";
import type { ReviewNodeOutcome } from "./registerNodeBackedReviewSession";
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
    namespace: "node-backed-review-session",
    nodes: [ReviewInsertionNode, ReviewDeletionNode],
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
  outcomes: ReviewNodeOutcome[] = [],
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
  return { opened: opened.value, unregister };
}

describe("node-backed review session targeting", () => {
  it.each(["review-insertion", "review-deletion"] as const)(
    "merges adjacent %s wrappers sharing one proposal identity",
    async (kind) => {
      const editor = createReviewEditor();
      const { unregister } = open(
        editor,
        reviewDocument([
          paragraph([
            proposal(kind, "shared", "A"),
            proposal(kind, "shared", "B", 1),
          ]),
        ]),
      );
      await Promise.resolve();

      editor.getEditorState().read(() => {
        const children = firstParagraph().getChildren();
        expect(children).toHaveLength(1);
        const wrapper = children[0];
        expect($isElementNode(wrapper)).toBe(true);
        if (!$isElementNode(wrapper)) {
          return;
        }
        expect(wrapper.getTextContent()).toBe("AB");
        expect(
          wrapper
            .getChildren()
            .map((child) => ($isTextNode(child) ? child.getFormat() : null)),
        ).toEqual([0, 1]);
      });
      unregister();
    },
  );

  it.each([0, 2])(
    "continues an insertion at its proposal boundary offset %s",
    async (offset) => {
      const editor = createReviewEditor();
      const outcomes: ReviewNodeOutcome[] = [];
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
        firstText(insertion).select(offset, offset);
      });

      expect(
        editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X"),
      ).toBe(true);
      await Promise.resolve();

      editor.getEditorState().read(() => {
        expect(firstParagraph().getTextContent()).toBe(
          offset === 0 ? "XBC" : "BCX",
        );
      });
      expect(outcomes).toMatchObject([{ status: "changed" }]);
      unregister();
    },
  );

  it("continues a pending insertion on the proposal side", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { opened, unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          proposal("review-insertion", "insertion-a", "BC"),
          text("D"),
        ]),
      ]),
      outcomes,
    );

    await update(editor, () => {
      const insertion = firstParagraph().getChildAtIndex(1);
      if (!$isElementNode(insertion)) {
        throw new Error("Expected an insertion wrapper.");
      }
      firstText(insertion).select(1, 1);
    });

    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "😀"),
    ).toBe(true);
    await Promise.resolve();

    editor.getEditorState().read(() => {
      const insertion = firstParagraph().getChildAtIndex(1);
      expect($isElementNode(insertion)).toBe(true);
      if ($isElementNode(insertion)) {
        expect(insertion.getTextContent()).toBe("B😀C");
        expect((insertion as ReviewInsertionNode).getProposalId()).toBe(
          "insertion-a",
        );
      }
    });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(editor.getEditorState().read(liveSelection)).toMatchObject({
      anchor: { offset: 3 },
      focus: { offset: 3 },
    });

    const exported = opened.exportDocument();
    expect(exported).toMatchObject({ status: "valid" });
    unregister();
  });

  it("replaces a selected span inside one pending insertion identity", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([proposal("review-insertion", "insertion-a", "ABC")]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      const insertion = firstParagraph().getChildAtIndex(0);
      if (!$isElementNode(insertion)) {
        throw new Error("Expected an insertion wrapper.");
      }
      firstText(insertion).select(1, 2);
    });

    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "XY"),
    ).toBe(true);
    await Promise.resolve();

    editor.getEditorState().read(() => {
      const insertion = firstParagraph().getChildAtIndex(0);
      expect(insertion?.getTextContent()).toBe("AXYC");
      expect($isElementNode(insertion)).toBe(true);
      if ($isElementNode(insertion)) {
        expect((insertion as ReviewInsertionNode).getProposalId()).toBe(
          "insertion-a",
        );
      }
    });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it("removes a pending insertion when its whole proposal-side range is deleted", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { opened, unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          proposal("review-insertion", "insertion-a", "BC"),
          text("D"),
        ]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      const insertion = firstParagraph().getChildAtIndex(1);
      if (!$isElementNode(insertion)) {
        throw new Error("Expected an insertion wrapper.");
      }
      firstText(insertion).select(0, 2);
    });

    expect(
      editor.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent("keydown"),
      ),
    ).toBe(true);
    await Promise.resolve();

    editor.getEditorState().read(() => {
      expect(
        firstParagraph()
          .getChildren()
          .map((child) => child.getTextContent()),
      ).toEqual(["AD"]);
    });
    expect(opened.exportDocument()).toMatchObject({ status: "valid" });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it.each([
    ["backward", KEY_BACKSPACE_COMMAND, true],
    ["forward", KEY_DELETE_COMMAND, false],
  ] as const)(
    "edits pending deletion content in the %s direction without restoring it",
    async (_name, command, backward) => {
      const editor = createReviewEditor();
      const outcomes: ReviewNodeOutcome[] = [];
      const { unregister } = open(
        editor,
        reviewDocument([
          paragraph([
            text("A"),
            proposal("review-deletion", "deletion-a", "BC"),
            text("D"),
          ]),
        ]),
        outcomes,
      );

      await update(editor, () => {
        const deletion = firstParagraph().getChildAtIndex(1);
        if (!$isElementNode(deletion)) {
          throw new Error("Expected a deletion wrapper.");
        }
        firstText(deletion).select(backward ? 2 : 0, backward ? 2 : 0);
      });

      expect(
        editor.dispatchCommand(command, new KeyboardEvent("keydown")),
      ).toBe(true);
      await Promise.resolve();

      editor.getEditorState().read(() => {
        const deletion = firstParagraph().getChildAtIndex(1);
        expect($isElementNode(deletion)).toBe(true);
        if ($isElementNode(deletion)) {
          expect(deletion.getTextContent()).toBe(backward ? "B" : "C");
        }
        expect(firstParagraph().getTextContent()).toBe(
          backward ? "ABD" : "ACD",
        );
      });
      expect(outcomes).toMatchObject([{ status: "changed" }]);
      unregister();
    },
  );

  it.each([
    ["backward", KEY_BACKSPACE_COMMAND, "ACD", 1],
    ["forward", KEY_DELETE_COMMAND, "ABD", 2],
  ] as const)(
    "deletes the %s character at a formatted proposal element boundary",
    async (_direction, command, expectedText, expectedCaret) => {
      const editor = createReviewEditor();
      const outcomes: ReviewNodeOutcome[] = [];
      const { unregister } = open(
        editor,
        reviewDocument([
          paragraph([
            reviewNode("review-deletion", "deletion-formatted", [
              text("AB"),
              text("CD", 1),
            ]),
          ]),
        ]),
        outcomes,
      );
      await update(editor, () => {
        const deletion = firstParagraph().getFirstChild();
        if (!$isElementNode(deletion)) {
          throw new Error("Expected a deletion wrapper.");
        }
        deletion.select(1, 1);
      });

      expect(
        editor.dispatchCommand(command, new KeyboardEvent("keydown")),
      ).toBe(true);
      await Promise.resolve();

      editor.getEditorState().read(() => {
        expect(firstParagraph().getTextContent()).toBe(expectedText);
      });
      expect(editor.getEditorState().read(liveSelection)).toMatchObject({
        anchor: { offset: expectedCaret, type: "text" },
        focus: { offset: expectedCaret, type: "text" },
      });
      expect(outcomes).toMatchObject([{ status: "changed" }]);
      unregister();
    },
  );

  it("inserts at a formatted proposal element boundary and restores that caret", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "insertion-formatted", [
            text("AB"),
            text("CD", 1),
          ]),
        ]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      const insertion = firstParagraph().getFirstChild();
      if (!$isElementNode(insertion)) {
        throw new Error("Expected an insertion wrapper.");
      }
      insertion.select(1, 1);
    });

    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );
    await Promise.resolve();

    editor.getEditorState().read(() => {
      expect(firstParagraph().getTextContent()).toBe("ABXCD");
    });
    expect(editor.getEditorState().read(liveSelection)).toMatchObject({
      anchor: { offset: 3, type: "text" },
      focus: { offset: 3, type: "text" },
    });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it.each([
    ["before", 0, KEY_DELETE_COMMAND],
    ["after", 2, KEY_BACKSPACE_COMMAND],
  ] as const)(
    "refuses accepted-side deletion %s pending deletion content",
    async (_side, acceptedIndex, command) => {
      const editor = createReviewEditor();
      const outcomes: ReviewNodeOutcome[] = [];
      const { unregister } = open(
        editor,
        reviewDocument([
          paragraph([
            text("A"),
            proposal("review-deletion", "deletion-a", "BC"),
            text("D"),
          ]),
        ]),
        outcomes,
      );
      await update(editor, () => {
        const accepted = firstParagraph().getChildAtIndex(acceptedIndex);
        if (!$isTextNode(accepted)) {
          throw new Error("Expected accepted text beside the deletion.");
        }
        if (acceptedIndex === 0) {
          accepted.selectEnd();
        } else {
          accepted.selectStart();
        }
      });
      const beforeDocument = editor.getEditorState().toJSON();
      const beforeSelection = editor.getEditorState().read(liveSelection);

      expect(
        editor.dispatchCommand(command, new KeyboardEvent("keydown")),
      ).toBe(true);
      await Promise.resolve();

      expect(outcomes).toMatchObject([
        { reason: { code: "deletion-target-unavailable" }, status: "refused" },
      ]);
      expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
      expect(editor.getEditorState().read(liveSelection)).toEqual(
        beforeSelection,
      );
      unregister();
    },
  );

  it("refuses zero-length deletion adjacency without moving selection", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          proposal("review-deletion", "deletion-a", "BC"),
          text("D"),
        ]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      const deletion = firstParagraph().getChildAtIndex(1);
      if (!$isElementNode(deletion)) {
        throw new Error("Expected a deletion wrapper.");
      }
      firstText(deletion).select(0, 0);
    });
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const beforeDocument = editor.getEditorState().toJSON();

    expect(
      editor.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent("keydown"),
      ),
    ).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { reason: { code: "deletion-target-unavailable" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("refuses forward deletion at the end of a pending deletion", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          proposal("review-deletion", "deletion-a", "BC"),
          text("D"),
        ]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph().getChildAtIndex(1) as ElementNode).select(
        2,
        2,
      );
    });
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const beforeDocument = editor.getEditorState().toJSON();

    expect(
      editor.dispatchCommand(KEY_DELETE_COMMAND, new KeyboardEvent("keydown")),
    ).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { reason: { code: "deletion-target-unavailable" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it.each([
    ["before", 0, ["A", "X", "B", "C"], 1],
    ["after", 2, ["A", "B", "X", "C"], 2],
  ] as const)(
    "creates an insertion on the explicit accepted side %s a proposal",
    async (_side, acceptedIndex, expectedText, insertionIndex) => {
      const editor = createReviewEditor();
      const outcomes: ReviewNodeOutcome[] = [];
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
        { proposalIdFactory: () => "insertion-b" },
      );
      await update(editor, () => {
        const accepted = firstParagraph().getChildAtIndex(acceptedIndex);
        if (!$isTextNode(accepted)) {
          throw new Error("Expected accepted text.");
        }
        if (acceptedIndex === 0) {
          accepted.selectEnd();
        } else {
          accepted.selectStart();
        }
      });

      expect(
        editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X"),
      ).toBe(true);
      await Promise.resolve();

      editor.getEditorState().read(() => {
        const children = firstParagraph().getChildren();
        expect(children.map((child) => child.getTextContent())).toEqual(
          expectedText,
        );
        const insertion = children[insertionIndex];
        expect($isElementNode(insertion)).toBe(true);
        if ($isElementNode(insertion)) {
          expect((insertion as ReviewInsertionNode).getProposalId()).toBe(
            "insertion-b",
          );
        }
      });
      expect(outcomes).toMatchObject([{ status: "changed" }]);
      unregister();
    },
  );

  it("keeps a paragraph boundary away from proposals on the accepted side", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          proposal("review-insertion", "insertion-a", "B"),
          text("C"),
          text("D", 1),
        ]),
      ]),
      outcomes,
      { proposalIdFactory: () => "insertion-b" },
    );
    await update(editor, () => {
      firstParagraph().select(3, 3);
    });

    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );
    await Promise.resolve();

    editor.getEditorState().read(() => {
      const children = firstParagraph().getChildren();
      expect(children.map((child) => child.getTextContent())).toEqual([
        "A",
        "B",
        "C",
        "X",
        "D",
      ]);
      const insertion = children[3];
      expect($isElementNode(insertion)).toBe(true);
      if ($isElementNode(insertion)) {
        expect((insertion as ReviewInsertionNode).getProposalId()).toBe(
          "insertion-b",
        );
      }
    });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it("creates a formatted deletion with UTF-16-safe non-BMP boundaries", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("A😀B", 1)], 1)]),
      outcomes,
      { proposalIdFactory: () => "deletion-a" },
    );
    await update(editor, () => {
      const accepted = firstText(firstParagraph());
      accepted.select(3, 1);
    });

    expect(
      editor.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent("keydown"),
      ),
    ).toBe(true);
    await Promise.resolve();

    editor.getEditorState().read(() => {
      const [before, deletion, after] = firstParagraph().getChildren();
      expect(before?.getTextContent()).toBe("A");
      expect(deletion?.getTextContent()).toBe("😀");
      expect(after?.getTextContent()).toBe("B");
      expect($isElementNode(deletion)).toBe(true);
      if ($isElementNode(deletion)) {
        expect((deletion as ReviewDeletionNode).getProposalId()).toBe(
          "deletion-a",
        );
        expect($isTextNode(deletion.getFirstChild())).toBe(true);
        const deletionText = deletion.getFirstChild();
        if ($isTextNode(deletionText)) {
          expect(deletionText.getFormat()).toBe(1);
        }
      }
    });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it("deletes a selected accepted range across formatted text runs", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { opened, unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB"), text("CD", 1)])]),
      outcomes,
      { proposalIdFactory: () => "deletion-range" },
    );
    await update(editor, () => {
      const paragraphNode = firstParagraph();
      const first = paragraphNode.getChildAtIndex(0);
      const second = paragraphNode.getChildAtIndex(1);
      if (!$isTextNode(first) || !$isTextNode(second)) {
        throw new Error("Expected formatted accepted text runs.");
      }
      first.select(1, 1);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        throw new Error("Expected a range selection.");
      }
      selection.focus.set(second.getKey(), 1, "text");
      selection.dirty = true;
    });

    expect(
      editor.dispatchCommand(KEY_DELETE_COMMAND, new KeyboardEvent("keydown")),
    ).toBe(true);
    await Promise.resolve();

    editor.getEditorState().read(() => {
      const children = firstParagraph().getChildren();
      expect(children.map((child) => child.getTextContent())).toEqual([
        "A",
        "BC",
        "D",
      ]);
      expect($isElementNode(children[1])).toBe(true);
      if ($isElementNode(children[1])) {
        expect(children[1].getTextContent()).toBe("BC");
        const firstChild = children[1].getFirstChild();
        expect($isTextNode(firstChild)).toBe(true);
        if ($isTextNode(firstChild)) {
          expect(firstChild.getFormat()).toBe(0);
        }
        const secondChild = children[1].getChildAtIndex(1);
        expect($isTextNode(secondChild)).toBe(true);
        if ($isTextNode(secondChild)) {
          expect(secondChild.getFormat()).toBe(1);
        }
      }
    });
    expect(opened.exportDocument()).toMatchObject({ status: "valid" });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it.each([true, false])(
    "deletes from an accepted paragraph element boundary in the %s direction",
    async (backward) => {
      const editor = createReviewEditor();
      const outcomes: ReviewNodeOutcome[] = [];
      const { unregister } = open(
        editor,
        reviewDocument([paragraph([text("A"), text("B", 1)])]),
        outcomes,
        {
          proposalIdFactory: () =>
            backward ? "deletion-back" : "deletion-forward",
        },
      );
      await update(editor, () => {
        firstParagraph().select(1, 1);
      });

      expect(
        editor.dispatchCommand(
          backward ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND,
          new KeyboardEvent("keydown"),
        ),
      ).toBe(true);
      await Promise.resolve();

      editor.getEditorState().read(() => {
        const children = firstParagraph().getChildren();
        expect(children.map((child) => child.getTextContent())).toEqual(
          backward ? ["A", "B"] : ["A", "B"],
        );
        const deletion = children[backward ? 0 : 1];
        expect($isElementNode(deletion)).toBe(true);
        expect(deletion?.getTextContent()).toBe(backward ? "A" : "B");
      });
      expect(outcomes).toMatchObject([{ status: "changed" }]);
      unregister();
    },
  );

  it("allows a selection across formatted nodes sharing one proposal identity", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          proposal("review-insertion", "shared", "A"),
          proposal("review-insertion", "shared", "B", 1),
        ]),
      ]),
      outcomes,
    );
    await update(editor, () => {
      const paragraphNode = firstParagraph();
      const wrapper = paragraphNode.getChildAtIndex(0);
      if (!$isElementNode(wrapper)) {
        throw new Error("Expected one proposal wrapper.");
      }
      const firstNode = wrapper.getChildAtIndex(0);
      const secondNode = wrapper.getChildAtIndex(1);
      if (!$isTextNode(firstNode) || !$isTextNode(secondNode)) {
        throw new Error("Expected formatted proposal text nodes.");
      }
      firstNode.select(0, 0);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        throw new Error("Expected a range selection.");
      }
      selection.anchor.set(secondNode.getKey(), 1, "text");
      selection.focus.set(firstNode.getKey(), 0, "text");
      selection.dirty = true;
    });

    expect(
      editor.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent("keydown"),
      ),
    ).toBe(true);
    await Promise.resolve();

    editor.getEditorState().read(() => {
      expect(firstParagraph().getChildren()).toHaveLength(0);
    });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it("refuses ambiguous paragraph boundaries and mixed ranges without mutation", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
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
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const beforeDocument = editor.getEditorState().toJSON();
    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );
    await Promise.resolve();
    expect(outcomes).toMatchObject([
      { reason: { code: "ambiguous-boundary" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );

    outcomes.length = 0;
    await update(editor, () => {
      firstParagraph().select(2, 2);
    });
    const beforeOppositeBoundary = editor.getEditorState().toJSON();
    const beforeOppositeSelection = editor.getEditorState().read(liveSelection);
    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "Y")).toBe(
      true,
    );
    await Promise.resolve();
    expect(outcomes).toMatchObject([
      { reason: { code: "ambiguous-boundary" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeOppositeBoundary);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeOppositeSelection,
    );

    outcomes.length = 0;
    await update(editor, () => {
      const [accepted, insertion] = firstParagraph().getChildren();
      if (!$isTextNode(accepted) || !$isElementNode(insertion)) {
        throw new Error("Expected an accepted node and insertion wrapper.");
      }
      const insertionText = firstText(insertion);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        throw new Error("Expected a range selection.");
      }
      selection.anchor.set(accepted.getKey(), 0, "text");
      selection.focus.set(insertionText.getKey(), 1, "text");
      selection.dirty = true;
    });
    const beforeMixedRange = editor.getEditorState().toJSON();
    expect(
      editor.dispatchCommand(KEY_DELETE_COMMAND, new KeyboardEvent("keydown")),
    ).toBe(true);
    await Promise.resolve();
    expect(outcomes).toMatchObject([
      { reason: { code: "unsafe-proposal-intersection" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeMixedRange);
    unregister();
  });

  it("refuses controlled drop insertion without mutating the live selection", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
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
    const event = new InputEvent("beforeinput", {
      data: null,
      inputType: "insertFromDrop",
    });

    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, event),
    ).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { reason: { code: "unsupported-transfer" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("refuses controlled replacement insertion with data", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(1, 1);
    });
    const beforeDocument = editor.getEditorState().toJSON();
    const event = new InputEvent("beforeinput", {
      data: "X",
      inputType: "insertReplacementText",
    });

    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, event),
    ).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { reason: { code: "unsupported-transfer" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    unregister();
  });

  it("keeps collapsed generic text removal unchanged", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
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

    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([{ status: "unchanged" }]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("refuses cut-driven text removal without mutating the range", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    await update(editor, () => {
      firstText(firstParagraph()).select(0, 1);
    });
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const event = new InputEvent("beforeinput", {
      inputType: "deleteByCut",
    });

    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { reason: { code: "unsupported-transfer" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("reconciles formatted proposal wrappers as stable outer DOM shells", async () => {
    const editor = createReviewEditor();
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    editor.setRootElement(rootElement);
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          proposal("review-insertion", "insertion-a", "new", 1),
          proposal("review-deletion", "deletion-a", "old", 2),
        ]),
      ]),
    );
    const insertionElement = rootElement.querySelector("ins");
    const deletionElement = rootElement.querySelector("del");
    expect(insertionElement?.firstElementChild?.tagName).toBe("STRONG");
    expect(deletionElement?.firstElementChild?.tagName).toBe("EM");

    await update(editor, () => {
      const insertion = firstParagraph().getChildAtIndex(0);
      if (!$isElementNode(insertion)) {
        throw new Error("Expected an insertion wrapper.");
      }
      firstText(insertion).selectEnd();
    });
    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "!")).toBe(
      true,
    );
    await Promise.resolve();

    expect(rootElement.querySelector("ins")).toBe(insertionElement);
    expect(rootElement.querySelector("del")).toBe(deletionElement);
    expect(insertionElement?.textContent).toBe("new!");
    expect(deletionElement?.textContent).toBe("old");
    unregister();
    editor.setRootElement(null);
    rootElement.remove();
  });

  it("targets an empty paragraph on the accepted side", async () => {
    const editor = createReviewEditor();
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([])]),
      outcomes,
      { proposalIdFactory: () => "empty-paragraph-insertion" },
    );
    await update(editor, () => {
      firstParagraph().select(0, 0);
    });
    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "x")).toBe(
      true,
    );
    await Promise.resolve();
    editor.getEditorState().read(() => {
      expect(firstParagraph().getTextContent()).toBe("x");
    });
    expect(outcomes).toMatchObject([{ status: "changed" }]);
    unregister();
  });

  it("refuses accepted-side authoring when proposal node classes are not registered", async () => {
    const editor = createEditor({
      namespace: "node-backed-review-session-without-nodes",
      onError: (error) => {
        throw error;
      },
    });
    const outcomes: ReviewNodeOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("A")])]),
      outcomes,
      { proposalIdFactory: () => "missing-node" },
    );
    await update(editor, () => {
      firstText(firstParagraph()).selectEnd();
    });
    const beforeDocument = editor.getEditorState().toJSON();

    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { reason: { code: "invalid-structural-target" }, status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    unregister();
  });

  it("rejects registration against an editor outside the authoring session", () => {
    const sessionEditor = createReviewEditor();
    const otherEditor = createReviewEditor();
    const opened = openReviewSession(
      sessionEditor,
      reviewDocument([paragraph([text("A")])]),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      throw new Error("Expected the node-backed review document to open.");
    }

    expect(() => registerReviewSession(otherEditor, opened.value)).toThrow(
      "same Lexical editor",
    );
  });
});
