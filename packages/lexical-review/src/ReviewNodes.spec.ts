import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  createEditor,
  type LexicalEditor,
} from "lexical";
import {
  $canReviewElementNodesBeMerged,
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $isReviewDeletionNode,
  $isReviewInsertionNode,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./ReviewNodes";

function createReviewEditor(): LexicalEditor {
  return createEditor({
    namespace: "review-nodes",
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

function update(editor: LexicalEditor, fn: () => void): Promise<void> {
  editor.update(fn);
  return Promise.resolve().then();
}

describe("review proposal element nodes", () => {
  it("exposes the inline, non-empty proposal wrapper contract", async () => {
    const editor = createReviewEditor();

    await update(editor, () => {
      const insertion = $createReviewInsertionNode("proposal-a");
      const deletion = $createReviewDeletionNode("proposal-b");

      expect(insertion.isInline()).toBe(true);
      expect(insertion.canBeEmpty()).toBe(false);
      expect(insertion.canInsertTextBefore()).toBe(false);
      expect(insertion.canInsertTextAfter()).toBe(false);
      expect($isReviewInsertionNode(insertion)).toBe(true);
      expect($isReviewDeletionNode(insertion)).toBe(false);

      expect(deletion.isInline()).toBe(true);
      expect(deletion.canBeEmpty()).toBe(false);
      expect(deletion.canInsertTextBefore()).toBe(false);
      expect(deletion.canInsertTextAfter()).toBe(false);
      expect($isReviewDeletionNode(deletion)).toBe(true);
      expect($isReviewInsertionNode(deletion)).toBe(false);

      expect(insertion.getProposalId()).toBe("proposal-a");
      expect(deletion.getProposalId()).toBe("proposal-b");
    });
  });

  it("rejects malformed identities and non-text children at creation", async () => {
    const editor = createReviewEditor();

    await update(editor, () => {
      expect(() => $createReviewInsertionNode(" ")).toThrow(
        "Proposal identity must be nonempty text",
      );
      const insertion = $createReviewInsertionNode("proposal-a");
      expect(() => insertion.append($createParagraphNode())).toThrow(
        "support text children only",
      );
      expect(() =>
        insertion.updateFromJSON({
          ...insertion.exportJSON(),
          proposalId: "\u0000",
        }),
      ).toThrow("Proposal identity must be nonempty text");
    });
  });

  it("keeps concrete types, inherited element JSON, and proposal IDs on roundtrip", async () => {
    const editor = createReviewEditor();

    await update(editor, () => {
      const insertion = $createReviewInsertionNode("proposal-insertion");
      insertion.setFormat("center").setIndent(2).setDirection("rtl");
      const insertionText = $createTextNode("inserted");
      insertionText.toggleFormat("bold");
      insertion.append(insertionText);

      const deletion = $createReviewDeletionNode("proposal-deletion");
      deletion.setFormat("right").setIndent(1).setDirection("ltr");
      const deletionText = $createTextNode("deleted");
      deletionText.toggleFormat("italic");
      deletion.append(deletionText);

      $getRoot().append($createParagraphNode().append(insertion, deletion));
    });

    const serialized = editor.getEditorState().toJSON();
    expect(serialized.root.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              extensions: [],
              proposalId: "proposal-insertion",
              type: "review-insertion",
            }),
            expect.objectContaining({
              extensions: [],
              proposalId: "proposal-deletion",
              type: "review-deletion",
            }),
          ]),
        }),
      ]),
    );

    const parsed = editor.parseEditorState(serialized);
    parsed.read(() => {
      const parsedParagraph = $getRoot().getFirstChild();
      expect($isElementNode(parsedParagraph)).toBe(true);
      if (!$isElementNode(parsedParagraph)) {
        return;
      }
      const parsedInsertion = parsedParagraph?.getChildAtIndex(0);
      const parsedDeletion = parsedParagraph?.getChildAtIndex(1);

      expect($isReviewInsertionNode(parsedInsertion)).toBe(true);
      expect($isReviewDeletionNode(parsedDeletion)).toBe(true);
      if (
        !$isReviewInsertionNode(parsedInsertion) ||
        !$isReviewDeletionNode(parsedDeletion)
      ) {
        return;
      }
      const parsedInsertionText = parsedInsertion.getFirstChild();
      const parsedDeletionText = parsedDeletion.getFirstChild();
      expect($isTextNode(parsedInsertionText)).toBe(true);
      expect($isTextNode(parsedDeletionText)).toBe(true);
      if (
        !$isTextNode(parsedInsertionText) ||
        !$isTextNode(parsedDeletionText)
      ) {
        return;
      }
      expect(parsedInsertion.getProposalId()).toBe("proposal-insertion");
      expect(parsedDeletion.getProposalId()).toBe("proposal-deletion");
      expect(parsedInsertion.getFormatType()).toBe("center");
      expect(parsedInsertion.getIndent()).toBe(2);
      expect(parsedInsertion.getDirection()).toBe("rtl");
      expect(parsedDeletion.getFormatType()).toBe("right");
      expect(parsedDeletion.getIndent()).toBe(1);
      expect(parsedDeletion.getDirection()).toBe("ltr");
      expect(parsedInsertionText.getType()).toBe("text");
      expect(parsedInsertionText.getTextContent()).toBe("inserted");
      expect(parsedInsertionText.getFormat()).toBe(1);
      expect(parsedDeletionText.getType()).toBe("text");
      expect(parsedDeletionText.getTextContent()).toBe("deleted");
      expect(parsedDeletionText.getFormat()).toBe(2);
    });
  });

  it("allows shared proposal IDs while retaining distinct Lexical keys", async () => {
    const editor = createReviewEditor();

    await update(editor, () => {
      const insertion = $createReviewInsertionNode("shared-proposal");
      const secondInsertion = $createReviewInsertionNode("shared-proposal");

      expect(insertion.getKey()).not.toBe(secondInsertion.getKey());
      expect(insertion.getProposalId()).toBe(secondInsertion.getProposalId());
    });
  });

  it("identifies review element nodes sharing type and identity", async () => {
    const editor = createReviewEditor();

    await update(editor, () => {
      const first = $createReviewDeletionNode("shared-proposal");
      const second = $createReviewDeletionNode("shared-proposal");
      const otherProposal = $createReviewDeletionNode("other-proposal");
      const otherKind = $createReviewInsertionNode("shared-proposal");
      const otherWrapperState = $createReviewDeletionNode("shared-proposal");
      otherWrapperState.setDirection("rtl");

      expect($canReviewElementNodesBeMerged(first, second)).toBe(true);
      expect($canReviewElementNodesBeMerged(first, otherProposal)).toBe(false);
      expect($canReviewElementNodesBeMerged(first, otherKind)).toBe(false);
      expect($canReviewElementNodesBeMerged(first, otherWrapperState)).toBe(
        true,
      );
    });
  });

  it("keeps the DOM shell stable when proposal content changes", async () => {
    const editor = createReviewEditor();
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    editor.setRootElement(rootElement);

    let insertion: ReviewInsertionNode | undefined;
    let textKey: string | undefined;
    await update(editor, () => {
      const node = $createReviewInsertionNode("proposal-a");
      insertion = node;
      const text = $createTextNode("inserted");
      textKey = text.getKey();
      text.toggleFormat("bold");
      node.append(text);
      $getRoot().append($createParagraphNode().append(node));
    });

    const insertionElement = rootElement.querySelector("ins");
    expect(insertionElement?.classList.contains("review-insertion")).toBe(true);
    expect(insertionElement?.hasAttribute("data-proposal-id")).toBe(false);
    expect(insertionElement?.firstElementChild?.tagName).toBe("STRONG");
    expect(insertionElement?.textContent).toBe("inserted");

    await update(editor, () => {
      const text = insertion?.getFirstChild();
      expect(text?.getKey()).toBe(textKey);
      if ($isTextNode(text)) {
        text.setTextContent("updated");
      }
    });

    expect(rootElement.querySelector("ins")).toBe(insertionElement);
    expect(insertionElement?.textContent).toBe("updated");
    editor.getEditorState().read(() => {
      expect(insertion?.getProposalId()).toBe("proposal-a");
    });

    editor.setRootElement(null);
    rootElement.remove();
  });

  it("renders deletion wrappers around ordinary formatted text", async () => {
    const editor = createReviewEditor();
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    editor.setRootElement(rootElement);

    await update(editor, () => {
      const deletion = $createReviewDeletionNode("proposal-a");
      const text = $createTextNode("deleted");
      text.toggleFormat("italic");
      deletion.append(text);
      $getRoot().append($createParagraphNode().append(deletion));
    });

    const deletionElement = rootElement.querySelector("del");
    expect(deletionElement?.classList.contains("review-deletion")).toBe(true);
    expect(deletionElement?.hasAttribute("data-proposal-id")).toBe(false);
    expect(deletionElement?.firstElementChild?.tagName).toBe("EM");
    expect(deletionElement?.textContent).toBe("deleted");

    editor.setRootElement(null);
    rootElement.remove();
  });

  it("removes an empty wrapper after its only child is removed", async () => {
    const editor = createReviewEditor();
    let insertion: ReviewInsertionNode | undefined;

    await update(editor, () => {
      const node = $createReviewInsertionNode("proposal-a");
      insertion = node;
      node.append($createTextNode("inserted"));
      $getRoot().append($createParagraphNode().append(node));
    });

    await update(editor, () => {
      insertion?.getFirstChild()?.remove();
    });

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      expect($isElementNode(paragraph)).toBe(true);
      if (!$isElementNode(paragraph)) {
        return;
      }
      expect(paragraph?.getChildrenSize()).toBe(0);
    });
  });
});
