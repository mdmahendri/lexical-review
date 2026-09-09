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
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./index";

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
  // Framework wrapper contract (isInline/canBeEmpty/canInsertTextBefore and
  // inherited element JSON getters) is covered indirectly by every behavior
  // spec that authors through these nodes; asserting it here would couple the
  // test to the Lexical base class instead of review behavior.
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
