import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
} from "lexical";
import {
  openReviewSession,
  ReviewDeletionNode,
  ReviewInsertionNode,
  validateReviewDocument,
} from "./index";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function createReviewEditor() {
  return createEditor({
    namespace: "node-backed-review-document",
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

describe("node-backed ReviewDocumentV3", () => {
  it.each([
    ["accepted-only", reviewDocument([paragraph([text("Alpha")])])],
    [
      "pending insertion and deletion",
      reviewDocument([
        paragraph([
          text("A"),
          reviewNode("review-insertion", "proposal-a", [text("bold", 1)]),
          reviewNode("review-deletion", "proposal-b", [text("gone", 2)]),
        ]),
      ]),
    ],
  ])("imports and purely round-trips %s native state", (_name, input) => {
    const source = structuredClone(input);
    const editor = createReviewEditor();
    const opened = openReviewSession(editor, input);

    expect(opened.status).toBe("valid");
    expect(input).toEqual(source);
    if (opened.status !== "valid") {
      return;
    }
    expect(opened.value.getEditorState()).toBe(editor.getEditorState());

    const exported = opened.value.exportDocument();
    expect(exported).toEqual(expect.objectContaining({ status: "valid" }));
    if (exported.status !== "valid") {
      return;
    }
    expect(exported.value).toEqual(source);
    expect(exported.value).not.toBe(input);
    expect(Object.isFrozen(exported.value)).toBe(true);
    expect(JSON.stringify(exported.value)).not.toMatch(
      /"proposals"|"status":"accepted"|"status":"rejected"/u,
    );

    const successorEditor = createReviewEditor();
    const successor = openReviewSession(successorEditor, exported.value);
    expect(successor.status).toBe("valid");
    if (successor.status === "valid") {
      expect(successor.value.exportDocument()).toEqual(exported);
    }
  });

  it("opens accepted-only input without registering proposal nodes", () => {
    const editor = createEditor({ onError: (error) => void error });
    const opened = openReviewSession(
      editor,
      reviewDocument([paragraph([text("accepted")])]),
    );

    expect(opened.status).toBe("valid");
  });

  it("preserves one shared identity across same-kind nodes", () => {
    const input = reviewDocument([
      paragraph([
        reviewNode("review-insertion", "shared", [text("one")]),
        reviewNode("review-insertion", "shared", [text("two")]),
      ]),
    ]);
    const editor = createReviewEditor();
    const opened = openReviewSession(editor, input);

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    editor.getEditorState().read(() => {
      const paragraphNode = $getRoot().getFirstChild();
      expect($isElementNode(paragraphNode)).toBe(true);
      if (!$isElementNode(paragraphNode)) {
        return;
      }
      const [first, second] = paragraphNode.getChildren();
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (first === undefined || second === undefined) {
        return;
      }
      expect(first.getKey()).not.toBe(second.getKey());
      expect((first as ReviewInsertionNode).getProposalId()).toBe("shared");
      expect((second as ReviewInsertionNode).getProposalId()).toBe("shared");
    });
  });

  it("round-trips formatted accepted text with non-BMP content", () => {
    const input = reviewDocument([paragraph([text("A😀B", 1)], 1)]);
    const editor = createReviewEditor();
    const opened = openReviewSession(editor, input);

    expect(opened.status).toBe("valid");
    if (opened.status === "valid") {
      expect(opened.value.exportDocument()).toMatchObject({
        status: "valid",
        value: input,
      });
    }
  });

  it.each([
    [
      "empty wrapper",
      reviewDocument([
        paragraph([reviewNode("review-insertion", "proposal-a", [])]),
      ]),
      "$.root.children[0].children[0].children",
    ],
    [
      "malformed identity",
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", " proposal-a ", [text("pending")]),
        ]),
      ]),
      "$.root.children[0].children[0].proposalId",
    ],
    [
      "identity reused by another kind",
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "proposal-a", [text("new")]),
          reviewNode("review-deletion", "proposal-a", [text("old")]),
        ]),
      ]),
      "$.root.children[0].children[1].proposalId",
    ],
    [
      "unsupported wrapper child",
      reviewDocument([
        paragraph([
          reviewNode("review-deletion", "proposal-a", [
            paragraph([text("nested")]),
          ]),
        ]),
      ]),
      "$.root.children[0].children[0].children[0]",
    ],
  ])("refuses %s before installation", (_name, input, path) => {
    const editor = createReviewEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("existing")),
        );
      },
      { discrete: true },
    );
    const before = editor.getEditorState().toJSON();

    const opened = openReviewSession(editor, input);

    expect(opened).toMatchObject({
      issues: [{ code: "invalid-document", path }],
      status: "invalid",
    });
    expect(editor.getEditorState().toJSON()).toEqual(before);
  });

  it("requires every proposal node class used by pending input", () => {
    const editor = createEditor({
      nodes: [ReviewInsertionNode],
      onError: (error) => void error,
    });
    const before = editor.getEditorState();
    const opened = openReviewSession(
      editor,
      reviewDocument([
        paragraph([
          reviewNode("review-deletion", "proposal-a", [text("pending")]),
        ]),
      ]),
    );

    expect(opened).toMatchObject({
      issues: [{ code: "invalid-document" }],
      status: "invalid",
    });
    expect(editor.getEditorState()).toBe(before);

    const insertionOnlyEditor = createEditor({
      nodes: [ReviewInsertionNode],
      onError: (error) => void error,
    });
    expect(
      openReviewSession(
        insertionOnlyEditor,
        reviewDocument([
          paragraph([
            reviewNode("review-insertion", "proposal-b", [text("pending")]),
          ]),
        ]),
      ).status,
    ).toBe("valid");
  });

  it("does not install a silently failed Lexical parse", () => {
    const editor = createReviewEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("existing")),
        );
      },
      { discrete: true },
    );
    const before = editor.getEditorState();
    vitest
      .spyOn(editor, "parseEditorState")
      .mockReturnValue(createReviewEditor().getEditorState());

    const opened = openReviewSession(
      editor,
      reviewDocument([paragraph([text("replacement")])]),
    );

    expect(opened).toMatchObject({
      issues: [{ code: "invalid-document", path: "$" }],
      status: "invalid",
    });
    expect(editor.getEditorState()).toBe(before);
  });

  it("reconciles review wrappers as outer DOM around Lexical formatting", () => {
    const editor = createReviewEditor();
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    editor.setRootElement(rootElement);

    const opened = openReviewSession(
      editor,
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "proposal-a", [text("new", 1)]),
          reviewNode("review-deletion", "proposal-b", [text("old", 2)]),
        ]),
      ]),
    );

    expect(opened.status).toBe("valid");
    const insertion = rootElement.querySelector("ins");
    const deletion = rootElement.querySelector("del");
    expect(insertion?.firstElementChild?.tagName).toBe("STRONG");
    expect(deletion?.firstElementChild?.tagName).toBe("EM");
    expect(insertion?.textContent).toBe("new");
    expect(deletion?.textContent).toBe("old");

    editor.setRootElement(null);
    rootElement.remove();
  });

  it("classifies nonempty extension placeholders as unsupported", () => {
    const input = reviewDocument([paragraph([text("Alpha")])]);
    const extensions: unknown[] = input.root.$["lexical-review"].extensions;
    extensions.push({});

    expect(validateReviewDocument(input)).toMatchObject({
      reason: {
        code: "unsupported-document",
        path: "$.root.$.lexical-review.extensions",
      },
      status: "unsupported",
    });
  });
});
