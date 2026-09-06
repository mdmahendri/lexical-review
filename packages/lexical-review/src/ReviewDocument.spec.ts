import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
} from "lexical";
import {
  $resolveReviewProposal,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  validateReviewDocument,
} from "./index";
import {
  boundaryNode,
  formattingNode,
  fragmentNode,
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

function createFullReviewEditor() {
  return createEditor({
    namespace: "node-backed-review-document-full",
    nodes: [
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewFragmentNode,
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

  it.each([
    [
      "Del-then-Ins replacement",
      reviewDocument([
        paragraph([
          reviewNode("review-deletion", "rep-a", [text("old")]),
          reviewNode("review-insertion", "rep-a", [text("new")]),
        ]),
      ]),
    ],
    [
      "split-side replacement",
      reviewDocument([
        paragraph([
          reviewNode("review-deletion", "rep-b", [text("o")]),
          reviewNode("review-deletion", "rep-b", [text("ld")]),
          reviewNode("review-insertion", "rep-b", [text("new")]),
        ]),
      ]),
    ],
    [
      "formatting with accepted runs",
      reviewDocument([
        paragraph([
          formattingNode("fmt-a", [text("new", 1)], [{ format: 0, text: "new" }]),
        ]),
      ]),
    ],
    [
      "split marker",
      reviewDocument([
        paragraph([text("AB")]),
        paragraph([boundaryNode("spl-a", "split"), text("CD")]),
      ]),
    ],
    [
      "merge marker at any child index",
      reviewDocument([
        paragraph([text("A"), boundaryNode("mrg-a", "merge"), text("B")]),
      ]),
    ],
    [
      "multi-paragraph fragment",
      reviewDocument([
        paragraph([text("A"), fragmentNode("frg-a", [text("x")], false)]),
        paragraph([fragmentNode("frg-a", [text("y")], true), text("B")]),
      ]),
    ],
    [
      "fragment with empty first component",
      reviewDocument([
        paragraph([fragmentNode("frg-b", [], false)]),
        paragraph([fragmentNode("frg-b", [text("y")], true)]),
      ]),
    ],
  ])("round-trips %s through a full editor", (_name, input) => {
    const source = structuredClone(input);
    const editor = createFullReviewEditor();
    const opened = openReviewSession(editor, input);

    expect(opened.status).toBe("valid");
    expect(input).toEqual(source);
    if (opened.status !== "valid") {
      return;
    }
    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status !== "valid") {
      return;
    }
    expect(exported.value).toEqual(source);
    expect(exported.value).not.toBe(input);
    expect(Object.isFrozen(exported.value)).toBe(true);
  });

  it.each([
    [
      "split not first child",
      reviewDocument([
        paragraph([text("AB")]),
        paragraph([text("CD"), boundaryNode("spl-a", "split")]),
      ]),
      "$.root.children[1]",
      "[ambiguous-boundary]",
    ],
    [
      "two boundaries in one paragraph",
      reviewDocument([
        paragraph([
          text("A"),
          boundaryNode("mrg-a", "merge"),
          boundaryNode("mrg-b", "merge"),
        ]),
      ]),
      "$.root.children[0]",
      "[ambiguous-boundary]",
    ],
    [
      "split in first paragraph",
      reviewDocument([
        paragraph([boundaryNode("spl-a", "split"), text("AB")]),
      ]),
      "$.root.children[0]",
      "[invalid-structural-target]",
    ],
    [
      "Ins-then-Del on one ID",
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "proposal-a", [text("new")]),
          reviewNode("review-deletion", "proposal-a", [text("old")]),
        ]),
      ]),
      "$.root.children[0].children[1].proposalId",
      "[unsafe-proposal-intersection]",
    ],
    [
      "cross-paragraph shared ID",
      reviewDocument([
        paragraph([reviewNode("review-insertion", "shared", [text("one")])]),
        paragraph([reviewNode("review-insertion", "shared", [text("two")])]),
      ]),
      "$.root.children[1].children[0].proposalId",
      "[unsafe-proposal-intersection]",
    ],
    [
      "text ID equal to boundary ID",
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "shared", [text("new")]),
          boundaryNode("shared", "merge"),
        ]),
      ]),
      "$.root.children[0].children[1]",
      "[unsafe-proposal-intersection]",
    ],
    [
      "fragment ID equal to insertion ID",
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "shared", [text("new")]),
          fragmentNode("shared", [text("x")], false),
        ]),
      ]),
      "$.root.children[0].children[1].proposalId",
      "[unsafe-proposal-intersection]",
    ],
    [
      "single-component fragment",
      reviewDocument([paragraph([fragmentNode("lone", [text("x")], false)])]),
      "$.root.children",
      "[unsafe-proposal-intersection]",
    ],
  ])(
    "refuses %s with the matrix-mapped code",
    (_name, input, path, code) => {
      expect(validateReviewDocument(input)).toMatchObject({
        issues: [{ code: "invalid-document", path }],
        status: "invalid",
      });
      const result = validateReviewDocument(input);
      expect(result.status).toBe("invalid");
      if (result.status !== "invalid") {
        return;
      }
      expect(result.issues[0]?.message).toContain(code);
    },
  );

  it.each([
    [
      "equal-sided replacement",
      reviewDocument([
        paragraph([
          reviewNode("review-deletion", "rep-a", [text("same")]),
          reviewNode("review-insertion", "rep-a", [text("same")]),
        ]),
      ]),
    ],
    [
      "accepted-equal formatting",
      reviewDocument([
        paragraph([
          formattingNode("fmt-a", [text("same", 1)], [{ format: 1, text: "same" }]),
        ]),
      ]),
    ],
    [
      "emptied fragment",
      reviewDocument([
        paragraph([fragmentNode("frg-a", [], false)]),
        paragraph([fragmentNode("frg-a", [], true)]),
      ]),
    ],
  ])("refuses no-op %s without silently cleaning", (_name, input) => {
    const source = structuredClone(input);
    const result = validateReviewDocument(input);
    expect(result).toMatchObject({ status: "invalid" });
    expect(input).toEqual(source);
  });

  it("rejects accepted text mismatch in formatting proposals", () => {
    const input = reviewDocument([
      paragraph([
        formattingNode("fmt-a", [text("new", 1)], [{ format: 0, text: "old" }]),
      ]),
    ]);
    expect(validateReviewDocument(input)).toMatchObject({
      issues: [{ code: "invalid-document", path: "$.root.children[0].children[0].accepted" }],
      status: "invalid",
    });
  });

  it.each([
    ["text format", () => reviewDocument([paragraph([text("x", 16)])])],
    [
      "paragraph textFormat",
      () => reviewDocument([paragraph([text("x")], 16)]),
    ],
    [
      "boundary leftFormat",
      () =>
        reviewDocument([
          paragraph([text("A"), boundaryNode("mrg-a", "merge", 16)]),
        ]),
    ],
    [
      "fragment emptyFormat",
      () =>
        reviewDocument([
          paragraph([fragmentNode("frg-a", [text("x")], false, 16)]),
          paragraph([fragmentNode("frg-a", [text("y")], true, 0)]),
        ]),
    ],
    [
      "accepted-run format",
      () =>
        reviewDocument([
          paragraph([
            formattingNode("fmt-a", [text("new", 1)], [
              { format: 16, text: "new" },
            ]),
          ]),
        ]),
    ],
  ])("classifies out-of-mask %s as unsupported", (_name, build) => {
    const result = validateReviewDocument(build());
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") {
      return;
    }
    expect(result.reason.code).toBe("unsupported-document");
  });

  it.each([
    ["wrong Lexical node version", "$.root", "invalid-document"] as const,
    ["wrong native doc version", "$.root.$.lexical-review.version", "unsupported-document"] as const,
    ["missing review metadata", "$.root.$", "invalid-document"] as const,
    ["non-array extensions", "$.root.$.lexical-review.extensions", "invalid-document"] as const,
  ])("splits %s taxonomy correctly", (_name, path, code) => {
    const input = reviewDocument([paragraph([text("Alpha")])]);
    if (_name === "wrong Lexical node version") {
      input.root.version = 2;
    }
    if (_name === "wrong native doc version") {
      input.root.$["lexical-review"].version = 4;
    }
    if (_name === "missing review metadata") {
      input.root.$ = {};
    }
    if (_name === "non-array extensions") {
      input.root.$["lexical-review"].extensions = {};
    }
    const result = validateReviewDocument(input);
    if (code === "invalid-document") {
      expect(result).toMatchObject({ issues: [{ code, path }], status: "invalid" });
    } else {
      expect(result).toMatchObject({
        reason: { code, path },
        status: "unsupported",
      });
    }
  });

  it("rolls back when installing state throws", () => {
    const editor = createFullReviewEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("existing")),
        );
      },
      { discrete: true },
    );
    const before = editor.getEditorState();
    const beforeJson = before.toJSON();
    const input = reviewDocument([paragraph([text("next")])]);
    vitest.spyOn(editor, "setEditorState").mockImplementationOnce(() => {
      throw new Error("install failed");
    });

    const opened = openReviewSession(editor, input);

    expect(opened).toMatchObject({
      issues: [{ code: "invalid-document", path: "$" }],
      status: "invalid",
    });
    // The failed install never mutates live content: the JSON snapshot is
    // preserved. (Lexical clones on setEditorState, so reference identity
    // cannot survive an actual restore commit; content equality is the
    // rollback guarantee.)
    expect(editor.getEditorState().toJSON()).toEqual(beforeJson);
  });

  it("leaves input and live state untouched on every refusal path", () => {
    const editor = createFullReviewEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("existing")),
        );
      },
      { discrete: true },
    );
    const beforeState = editor.getEditorState();
    const beforeJson = beforeState.toJSON();
    const input = reviewDocument([
      paragraph([
        reviewNode("review-insertion", "proposal-a", [text("new")]),
        reviewNode("review-deletion", "proposal-a", [text("old")]),
      ]),
    ]);
    const source = structuredClone(input);

    const opened = openReviewSession(editor, input);

    expect(opened.status).toBe("invalid");
    expect(input).toEqual(source);
    expect(editor.getEditorState()).toBe(beforeState);
    expect(editor.getEditorState().toJSON()).toEqual(beforeJson);
  });

  it("exports a pending-only successor after resolving one proposal", () => {
    const editor = createFullReviewEditor();
    const opened = openReviewSession(
      editor,
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "keep-a", [text("new")]),
          reviewNode("review-insertion", "drop-b", [text("gone")]),
        ]),
      ]),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const before = opened.value.exportDocument();
    expect(before.status).toBe("valid");

    let outcome: unknown;
    editor.update(
      () => {
        outcome = $resolveReviewProposal("drop-b", "accept");
      },
      { discrete: true },
    );
    expect(outcome).toMatchObject({ status: "changed" });

    const after = opened.value.exportDocument();
    expect(after.status).toBe("valid");
    if (after.status !== "valid") {
      return;
    }
    const serialized = JSON.stringify(after.value);
    expect(serialized).toContain("keep-a");
    expect(serialized).not.toContain("drop-b");
    expect(validateReviewDocument(after.value).status).toBe("valid");
    expect(serialized).not.toMatch(/"proposals"/u);
  });
});
