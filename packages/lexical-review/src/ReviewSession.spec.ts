import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ElementNode,
} from "lexical";
import { ReviewTextNode } from "./ReviewTextNode";
import type { ReviewDocumentV3 } from "./LegacyReviewDocument";
import { openReviewSession, type ReviewOutcome } from "./LegacyReviewSession";

function acceptedDocument(...paragraphs: Array<ReadonlyArray<string>>) {
  return {
    root: {
      children: paragraphs.map((runs) => ({
        children: runs.map((text, index) => ({
          detail: 0,
          format: index === 0 ? 0 : 1,
          mode: "normal",
          style: "",
          text,
          type: "text",
          version: 1,
        })),
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        type: "paragraph",
        version: 1,
      })),
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
      $: {
        "lexical-review": {
          proposals: [],
          version: 3,
        },
      },
    },
  };
}

function logicalCaretOffset(): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null;
  }
  const anchorNode = selection.anchor.getNode();
  const paragraph = anchorNode.getParent<ElementNode>();
  if (paragraph === null) {
    return selection.anchor.offset;
  }
  let offset = selection.anchor.offset;
  for (const child of paragraph.getChildren()) {
    if (child.getKey() === anchorNode.getKey()) {
      break;
    }
    offset += child.getTextContentSize();
  }
  return offset;
}

function logicalSelection() {
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

describe("version 3 ReviewSession lifecycle", () => {
  it.each([
    [
      "missing metadata",
      { root: { ...acceptedDocument(["Alpha"]).root, $: {} } },
    ],
    [
      "wrong review version",
      {
        ...acceptedDocument(["Alpha"]),
        root: {
          ...acceptedDocument(["Alpha"]).root,
          $: { "lexical-review": { proposals: [], version: 2 } },
        },
      },
    ],
    [
      "unknown root member",
      {
        ...acceptedDocument(["Alpha"]),
        root: { ...acceptedDocument(["Alpha"]).root, surprise: true },
      },
    ],
    [
      "unimplemented proposal content",
      {
        ...acceptedDocument(["Alpha"]),
        root: {
          ...acceptedDocument(["Alpha"]).root,
          $: {
            "lexical-review": {
              proposals: [{ id: "proposal-1" }],
              version: 3,
            },
          },
        },
      },
    ],
  ])("validates %s before installing state", (_name, input) => {
    const editor = createEditor({ onError: (error) => void error });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("existing")),
        );
      },
      { discrete: true },
    );
    const before = editor.getEditorState().toJSON();

    const result = openReviewSession(editor, input);

    expect(result.status).not.toBe("valid");
    expect(editor.getEditorState().toJSON()).toEqual(before);
  });

  it("derives accepted state and every projection from Lexical EditorState", () => {
    const editor = createEditor({ onError: (error) => void error });
    const input = acceptedDocument(["Alpha", " bold"], [], ["Beta 😀"]);
    const result = openReviewSession(editor, input);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") {
      return;
    }

    expect(result.value.readState()).toEqual({
      accepted: {
        paragraphs: [
          {
            runs: [
              { format: 0, text: "Alpha" },
              { format: 1, text: " bold" },
            ],
          },
          { runs: [] },
          { runs: [{ format: 0, text: "Beta 😀" }] },
        ],
      },
      draft: null,
      proposals: [],
    });
    expect(result.value.project("review").accepted).toEqual(
      result.value.project("accepted-state").accepted,
    );
    expect(result.value.project("all-accepted").accepted).toEqual(
      result.value.readState().accepted,
    );

    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("Gamma")));
      },
      { discrete: true },
    );

    expect(result.value.readState().accepted.paragraphs[0]).toEqual({
      runs: [{ format: 0, text: "Gamma" }],
    });
  });

  it("rejects a document when pending proposal installation fails", () => {
    const input = acceptedDocument(["Alpha"]);
    const errors: Error[] = [];
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => errors.push(error),
    });
    const previous = editor.getEditorState().toJSON();
    const result = openReviewSession(editor, {
      root: {
        ...input.root,
        $: {
          "lexical-review": {
            proposals: [
              {
                id: "proposal-a",
                kind: "deletion",
                payload: { runs: [{ format: 0, text: "lp" }] },
                status: "pending",
                target: {
                  start: { offset: 1, paragraph: 0 },
                  end: { offset: 3, paragraph: 0 },
                },
              },
              {
                id: "proposal-b",
                kind: "deletion",
                payload: { runs: [{ format: 0, text: "ph" }] },
                status: "pending",
                target: {
                  start: { offset: 2, paragraph: 0 },
                  end: { offset: 4, paragraph: 0 },
                },
              },
            ],
            version: 3,
          },
        },
      },
    });

    expect(result).toMatchObject({
      issues: [{ code: "invalid-document" }],
      status: "invalid",
    });
    expect(editor.getEditorState().toJSON()).toEqual(previous);
    expect(errors).toHaveLength(1);
  });

  it("round-trips normalized semantics without mutating the serialized source", () => {
    const editor = createEditor({ onError: (error) => void error });
    const input = acceptedDocument(["Alpha", " bold"], [], ["Beta 😀"]);
    const inputBefore = structuredClone(input);
    const opened = openReviewSession(editor, input);

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }

    const exported: ReviewOutcome<ReviewDocumentV3> =
      opened.value.exportDocument();
    expect(exported.status).toBe("unchanged");
    if (exported.status !== "unchanged") {
      return;
    }

    expect(input).toEqual(inputBefore);
    expect(exported.value).not.toBe(input);
    expect(Object.isFrozen(exported.value)).toBe(true);

    const successorEditor = createEditor({ onError: (error) => void error });
    const successor = openReviewSession(successorEditor, exported.value);
    expect(successor.status).toBe("valid");
    if (successor.status !== "valid") {
      return;
    }
    expect(successor.value.readState()).toEqual(opened.value.readState());
  });

  it("gives complete programmatic calls no implied selection", () => {
    const editor = createEditor({ onError: (error) => void error });
    const result = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(result.status).toBe("valid");
    editor.getEditorState().read(() => {
      expect($getSelection()).toBeNull();
    });
  });

  it("creates and continues one identityless insertion draft", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }

    expect(
      opened.value.insertText({
        target: { offset: 5, paragraph: 0 },
        text: " brave",
      }),
    ).toMatchObject({ status: "changed" });
    expect(
      opened.value.insertText({
        target: { offset: 5, paragraph: 0 },
        text: " world",
      }),
    ).toMatchObject({ status: "changed" });

    expect(opened.value.readState()).toEqual({
      accepted: {
        paragraphs: [{ runs: [{ format: 0, text: "Alpha" }] }],
      },
      draft: {
        kind: "insertion",
        payload: { runs: [{ format: 0, text: " brave world" }] },
        target: { offset: 5, paragraph: 0 },
      },
      proposals: [],
    });
    expect(opened.value.project("review").paragraphs).toEqual([
      {
        runs: [
          { format: 0, text: "Alpha", type: "accepted" },
          { format: 0, text: " brave world", type: "draft-insertion" },
        ],
      },
    ]);
    editor.getEditorState().read(() => {
      expect($getSelection()).toBeNull();
    });
  });

  it("creates one identityless deletion draft from a complete range intention", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }

    expect(
      opened.value.deleteText({
        target: {
          start: { offset: 1, paragraph: 0 },
          end: { offset: 3, paragraph: 0 },
        },
      }),
    ).toMatchObject({ status: "changed" });

    expect(opened.value.readState()).toEqual({
      accepted: {
        paragraphs: [{ runs: [{ format: 0, text: "Alpha" }] }],
      },
      draft: {
        kind: "deletion",
        payload: { runs: [{ format: 0, text: "lp" }] },
        target: {
          start: { offset: 1, paragraph: 0 },
          end: { offset: 3, paragraph: 0 },
        },
      },
      proposals: [],
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "A", type: "accepted" },
      { format: 0, text: "lp", type: "draft-deletion" },
      { format: 0, text: "ha", type: "accepted" },
    ]);
    expect(opened.value.project("accepted-state").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "A", type: "accepted" },
      { format: 0, text: "lp", type: "accepted" },
      { format: 0, text: "ha", type: "accepted" },
    ]);
    expect(opened.value.project("all-accepted").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Aha", type: "accepted" },
    ]);
  });

  it("finalizes, exports, reopens, and resolves one deletion proposal", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory: () => "deletion-1",
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.deleteText({
      target: {
        start: { offset: 1, paragraph: 0 },
        end: { offset: 3, paragraph: 0 },
      },
    });

    expect(opened.value.finalizeDraft()).toEqual({
      status: "changed",
      value: {
        id: "deletion-1",
        kind: "deletion",
        payload: { runs: [{ format: 0, text: "lp" }] },
        status: "pending",
        target: {
          start: { offset: 1, paragraph: 0 },
          end: { offset: 3, paragraph: 0 },
        },
      },
    });

    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("unchanged");
    if (exported.status !== "unchanged") {
      return;
    }
    expect(exported.value).toMatchObject({
      root: {
        children: [{ children: [{ text: "Alpha", type: "text" }] }],
        $: {
          "lexical-review": {
            proposals: [
              {
                id: "deletion-1",
                kind: "deletion",
                payload: { runs: [{ format: 0, text: "lp" }] },
                status: "pending",
                target: {
                  start: { offset: 1, paragraph: 0 },
                  end: { offset: 3, paragraph: 0 },
                },
              },
            ],
            version: 3,
          },
        },
      },
    });

    const successorEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const successor = openReviewSession(successorEditor, exported.value);
    expect(successor.status).toBe("valid");
    if (successor.status !== "valid") {
      return;
    }
    expect(successor.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "A", type: "accepted" },
      {
        format: 0,
        proposalId: "deletion-1",
        text: "lp",
        type: "proposal-deletion",
      },
      { format: 0, text: "ha", type: "accepted" },
    ]);
    expect(successor.value.rejectProposal("deletion-1")).toMatchObject({
      status: "changed",
      value: { kind: "deletion", status: "rejected" },
    });
    expect(successor.value.readState().accepted.paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha" },
    ]);
    expect(successor.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha", type: "accepted" },
    ]);
  });

  it.each([
    ["backward", 4, 5, 3, 4, "ha"],
    ["forward", 0, 1, 1, 2, "Al"],
  ] as const)(
    "extends one %s deletion intention into the same draft",
    (direction, firstStart, firstEnd, nextStart, nextEnd, text) => {
      const identityFactory = vitest.fn(() => "unused");
      const editor = createEditor({
        nodes: [ReviewTextNode],
        onError: (error) => void error,
      });
      const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
        identityFactory,
      });

      expect(opened.status).toBe("valid");
      if (opened.status !== "valid") {
        return;
      }
      expect(
        opened.value.deleteText({
          direction,
          target: {
            end: { offset: firstEnd, paragraph: 0 },
            start: { offset: firstStart, paragraph: 0 },
          },
        }),
      ).toMatchObject({ status: "changed" });
      expect(
        opened.value.deleteText({
          direction,
          target: {
            end: { offset: nextEnd, paragraph: 0 },
            start: { offset: nextStart, paragraph: 0 },
          },
        }),
      ).toMatchObject({ status: "changed" });

      expect(identityFactory).not.toHaveBeenCalled();
      expect(opened.value.readState()).toMatchObject({
        draft: {
          kind: "deletion",
          payload: { runs: [{ text }] },
          target: {
            start: { offset: direction === "backward" ? 3 : 0 },
            end: { offset: direction === "backward" ? 5 : 2 },
          },
        },
        proposals: [],
      });
      expect(opened.value.project("review").paragraphs[0]?.runs).toEqual(
        direction === "backward"
          ? [
              { format: 0, text: "Alp", type: "accepted" },
              { format: 0, text: "ha", type: "draft-deletion" },
            ]
          : [
              { format: 0, text: "Al", type: "draft-deletion" },
              { format: 0, text: "pha", type: "accepted" },
            ],
      );
    },
  );

  it("corrects insertion drafts and treats zero-length deletion as unchanged", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 2, paragraph: 0 },
      text: "XYZ",
    });

    expect(
      opened.value.deleteText({
        draftSelection: { end: 3, kind: "insertion", start: 1 },
        target: {
          start: { offset: 2, paragraph: 0 },
          end: { offset: 2, paragraph: 0 },
        },
      }),
    ).toMatchObject({ status: "changed" });
    expect(opened.value.readState().draft).toMatchObject({
      kind: "insertion",
      payload: { runs: [{ text: "X" }] },
    });

    const before = opened.value.readState();
    expect(
      opened.value.deleteText({
        target: {
          start: { offset: 2, paragraph: 0 },
          end: { offset: 2, paragraph: 0 },
        },
      }),
    ).toEqual({ status: "unchanged", value: before });
    expect(opened.value.readState()).toEqual(before);
  });

  it("restores a deletion draft when a nonempty part is deleted", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.deleteText({
      target: {
        start: { offset: 1, paragraph: 0 },
        end: { offset: 3, paragraph: 0 },
      },
    });

    const beforeUnavailableTarget = opened.value.readState();
    expect(
      opened.value.deleteText({
        target: {
          start: { offset: 1, paragraph: 0 },
          end: { offset: 100, paragraph: 0 },
        },
      }),
    ).toMatchObject({
      reason: { code: "deletion-target-unavailable" },
      status: "refused",
    });
    expect(opened.value.readState()).toEqual(beforeUnavailableTarget);

    expect(
      opened.value.deleteText({
        target: {
          start: { offset: 1, paragraph: 0 },
          end: { offset: 2, paragraph: 0 },
        },
      }),
    ).toMatchObject({ status: "changed" });
    expect(opened.value.readState()).toMatchObject({
      draft: null,
      accepted: { paragraphs: [{ runs: [{ text: "Alpha" }] }] },
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha", type: "accepted" },
    ]);
  });

  it("exports and reopens after accepting a deletion proposal", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory: () => "deletion-accepted",
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.deleteText({
      target: {
        start: { offset: 1, paragraph: 0 },
        end: { offset: 4, paragraph: 0 },
      },
    });
    expect(opened.value.finalizeDraft()).toMatchObject({ status: "changed" });
    expect(opened.value.acceptProposal("deletion-accepted")).toMatchObject({
      status: "changed",
      value: { kind: "deletion", status: "accepted" },
    });
    expect(opened.value.project("all-accepted").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Aa", type: "accepted" },
    ]);

    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("unchanged");
    if (exported.status !== "unchanged") {
      return;
    }
    const successorEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const successor = openReviewSession(successorEditor, exported.value);
    expect(successor.status).toBe("valid");
    if (successor.status === "valid") {
      expect(
        successor.value.project("all-accepted").paragraphs[0]?.runs,
      ).toEqual([{ format: 0, text: "Aa", type: "accepted" }]);
    }
  });

  it("continues the live draft after temporary navigation and correction", () => {
    const identityFactory = vitest.fn(() => "unused");
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory,
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 5, paragraph: 0 },
      text: " draft",
    });
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const accepted = paragraph?.getFirstChild();
        const draft = paragraph
          ?.getChildren()
          .find((child) => child instanceof ReviewTextNode);
        accepted?.selectStart();
        draft?.setTextContent(" corrected");
        draft?.selectEnd();
      },
      { discrete: true },
    );

    expect(opened.value.project("accepted-state").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha", type: "accepted" },
    ]);
    expect(identityFactory).not.toHaveBeenCalled();
    expect(
      opened.value.insertText({
        target: { offset: 5, paragraph: 0 },
        text: " text",
      }),
    ).toMatchObject({ status: "changed" });
    expect(opened.value.readState().draft).toMatchObject({
      payload: { runs: [{ text: " corrected text" }] },
    });
    expect(identityFactory).not.toHaveBeenCalled();
  });

  it("atomically settles a draft before incompatible insertion authoring", () => {
    const identityFactory = vitest.fn(() => "proposal-a");
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory,
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 0, paragraph: 0 },
      text: "A",
    });

    expect(
      opened.value.insertText({
        target: { offset: 5, paragraph: 0 },
        text: "B",
      }),
    ).toMatchObject({ status: "changed" });
    expect(identityFactory).toHaveBeenCalledTimes(1);
    expect(opened.value.readState()).toMatchObject({
      draft: {
        payload: { runs: [{ text: "B" }] },
        target: { offset: 5, paragraph: 0 },
      },
      proposals: [
        {
          id: "proposal-a",
          payload: { runs: [{ text: "A" }] },
          status: "pending",
        },
      ],
    });
  });

  it("clears an empty draft before incompatible insertion authoring", () => {
    const identityFactory = vitest.fn(() => "unused");
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory,
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 0, paragraph: 0 },
      text: "discarded",
    });
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const draft = paragraph
          ?.getChildren()
          .find((child) => child instanceof ReviewTextNode);
        draft?.setTextContent("");
      },
      { discrete: true },
    );

    expect(
      opened.value.insertText({
        target: { offset: 5, paragraph: 0 },
        text: "B",
      }),
    ).toMatchObject({ status: "changed" });
    expect(identityFactory).not.toHaveBeenCalled();
    expect(opened.value.readState()).toMatchObject({
      draft: {
        payload: { runs: [{ text: "B" }] },
        target: { offset: 5, paragraph: 0 },
      },
      proposals: [],
    });
  });

  it("preserves the draft when an incompatible insertion target is unavailable", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory: () => "proposal-a",
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 0, paragraph: 0 },
      text: "A",
    });
    const before = opened.value.readState();

    expect(
      opened.value.insertText({
        target: { offset: 99, paragraph: 0 },
        text: "B",
      }),
    ).toMatchObject({
      reason: { code: "insertion-target-unavailable" },
      status: "refused",
    });
    expect(opened.value.readState()).toEqual(before);
    expect(opened.value.project("review").paragraphs[0]?.runs).toMatchObject([
      { text: "A", type: "draft-insertion" },
      { text: "Alpha", type: "accepted" },
    ]);
  });

  it("refuses fractional insertion targets", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }

    expect(
      opened.value.insertText({
        target: { offset: 1.5, paragraph: 0 },
        text: "X",
      }),
    ).toMatchObject({
      reason: { code: "insertion-target-unavailable" },
      status: "refused",
    });
    expect(opened.value.readState().draft).toBeNull();
  });

  it("finalizes an insertion draft with one injected proposal identity", () => {
    const identityFactory = vitest.fn(() => "proposal-50");
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory,
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 0, paragraph: 0 },
      text: "New ",
    });

    expect(opened.value.finalizeDraft()).toEqual({
      status: "changed",
      value: {
        id: "proposal-50",
        kind: "insertion",
        payload: { runs: [{ format: 0, text: "New " }] },
        status: "pending",
        target: { offset: 0, paragraph: 0 },
      },
    });
    expect(identityFactory).toHaveBeenCalledTimes(1);
    expect(opened.value.readState()).toMatchObject({
      draft: null,
      proposals: [{ id: "proposal-50", status: "pending" }],
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      {
        format: 0,
        proposalId: "proposal-50",
        text: "New ",
        type: "proposal-insertion",
      },
      { format: 0, text: "Alpha", type: "accepted" },
    ]);
  });

  it("generates immutable proposal identity by default", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 5, paragraph: 0 },
      text: "!",
    });
    const finalized = opened.value.finalizeDraft();

    expect(finalized.status).toBe("changed");
    if (finalized.status !== "changed" || finalized.value === null) {
      return;
    }
    expect(finalized.value.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(Object.isFrozen(finalized.value)).toBe(true);
    expect(Object.isFrozen(finalized.value.payload.runs)).toBe(true);
  });

  it("preserves the draft when identity generation fails", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory: () => {
        throw new Error("offline identity source");
      },
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 5, paragraph: 0 },
      text: "!",
    });
    const before = opened.value.readState();

    expect(opened.value.finalizeDraft()).toMatchObject({
      error: { code: "identity-generation-failed" },
      status: "failed",
    });
    expect(opened.value.readState()).toEqual(before);
  });

  it("preserves state and selection when a nonempty draft cannot finalize", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory: () => "proposal-a",
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 5, paragraph: 0 },
      text: " draft",
    });
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const accepted = paragraph?.getFirstChild();
        const draft = paragraph
          ?.getChildren()
          .find((child) => child instanceof ReviewTextNode);
        accepted?.selectEnd();
        draft?.remove();
      },
      { discrete: true },
    );
    const beforeState = opened.value.readState();
    const beforeProjection = opened.value.project("review");
    const beforeSelection = editor.getEditorState().read(logicalSelection);

    expect(opened.value.finalizeDraft()).toMatchObject({
      error: { code: "finalization-failed" },
      status: "failed",
    });
    expect(opened.value.readState()).toEqual(beforeState);
    expect(opened.value.project("review")).toEqual(beforeProjection);
    expect(editor.getEditorState().read(logicalSelection)).toEqual(
      beforeSelection,
    );
  });

  it("clears an empty draft without assigning proposal identity", () => {
    const identityFactory = vitest.fn(() => "unused");
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory,
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 2, paragraph: 0 },
      text: "draft",
    });
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const draft = paragraph
          ?.getChildren()
          .find((child) => child instanceof ReviewTextNode);
        draft?.setTextContent("");
      },
      { discrete: true },
    );

    expect(opened.value.finalizeDraft()).toEqual({
      status: "changed",
      value: null,
    });
    expect(identityFactory).not.toHaveBeenCalled();
    expect(opened.value.readState()).toEqual({
      accepted: {
        paragraphs: [{ runs: [{ format: 0, text: "Alpha" }] }],
      },
      draft: null,
      proposals: [],
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha", type: "accepted" },
    ]);
  });

  it("discards insertion authoring without creating a proposal record", () => {
    const identityFactory = vitest.fn(() => "unused");
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory,
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 2, paragraph: 0 },
      text: "draft",
    });

    expect(opened.value.discardDraft()).toEqual({
      status: "changed",
      value: undefined,
    });
    expect(identityFactory).not.toHaveBeenCalled();
    expect(opened.value.readState()).toEqual({
      accepted: {
        paragraphs: [{ runs: [{ format: 0, text: "Alpha" }] }],
      },
      draft: null,
      proposals: [],
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha", type: "accepted" },
    ]);
  });

  it("reports a failure when the draft projection is unavailable", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]));

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 2, paragraph: 0 },
      text: "draft",
    });
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const draft = paragraph
          ?.getChildren()
          .find((child) => child instanceof ReviewTextNode);
        draft?.remove();
      },
      { discrete: true },
    );

    expect(opened.value.discardDraft()).toMatchObject({
      error: { code: "discard-failed" },
      status: "failed",
    });
  });

  it.each([
    ["accepts", "accepted", "AlXpha", 3],
    ["rejects", "rejected", "Alpha", 2],
  ] as const)(
    "%s one insertion proposal and recovers the proposal-local caret",
    (_name, resolution, acceptedText, caretOffset) => {
      const editor = createEditor({
        nodes: [ReviewTextNode],
        onError: (error) => void error,
      });
      const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
        identityFactory: () => "proposal-50",
      });

      expect(opened.status).toBe("valid");
      if (opened.status !== "valid") {
        return;
      }
      opened.value.insertText({
        target: { offset: 2, paragraph: 0 },
        text: "X",
      });
      opened.value.finalizeDraft();
      editor.update(
        () => {
          const paragraph = $getRoot().getFirstChild<ElementNode>();
          const proposalNode = paragraph?.getChildAtIndex(1);
          if (proposalNode instanceof ReviewTextNode) {
            proposalNode.select(1, 1);
          }
        },
        { discrete: true },
      );

      const outcome =
        resolution === "accepted"
          ? opened.value.acceptProposal("proposal-50")
          : opened.value.rejectProposal("proposal-50");

      expect(outcome).toMatchObject({
        status: "changed",
        value: { id: "proposal-50", status: resolution },
      });
      expect(
        opened.value
          .readState()
          .accepted.paragraphs[0]?.runs.map((run) => run.text)
          .join(""),
      ).toBe(acceptedText);
      expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
        { format: 0, text: acceptedText, type: "accepted" },
      ]);
      expect(opened.value.readState().proposals).toMatchObject([
        { id: "proposal-50", status: resolution },
      ]);
      editor.getEditorState().read(() => {
        expect(logicalCaretOffset()).toBe(caretOffset);
      });
    },
  );

  it("atomically settles an active draft before proposal resolution", () => {
    const identities = ["proposal-a", "proposal-b"];
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory: () => identities.shift() ?? "unexpected",
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 0, paragraph: 0 },
      text: "A",
    });
    opened.value.finalizeDraft();
    opened.value.insertText({
      target: { offset: 5, paragraph: 0 },
      text: "B",
    });

    expect(opened.value.acceptProposal("proposal-a")).toMatchObject({
      status: "changed",
      value: { id: "proposal-a", status: "accepted" },
    });
    expect(opened.value.readState()).toMatchObject({
      draft: null,
      proposals: [
        { id: "proposal-a", status: "accepted" },
        { id: "proposal-b", status: "pending" },
      ],
    });
    expect(
      opened.value
        .readState()
        .accepted.paragraphs[0]?.runs.map((run) => run.text)
        .join(""),
    ).toBe("AAlpha");
  });

  it("rolls back draft settlement and selection when resolution fails", () => {
    const identities = ["proposal-a", "proposal-b"];
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument(["Alpha"]), {
      identityFactory: () => identities.shift() ?? "unexpected",
    });

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      target: { offset: 0, paragraph: 0 },
      text: "A",
    });
    opened.value.finalizeDraft();
    opened.value.insertText({
      target: { offset: 5, paragraph: 0 },
      text: "B",
    });
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const proposal = paragraph
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode && child.getTextContent() === "A",
          );
        const draft = paragraph
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode && child.getTextContent() === "B",
          );
        proposal?.remove();
        draft?.selectEnd();
      },
      { discrete: true },
    );
    const beforeState = opened.value.readState();
    const beforeProjection = opened.value.project("review");
    const beforeSelection = editor.getEditorState().read(logicalSelection);

    expect(opened.value.acceptProposal("proposal-a")).toMatchObject({
      error: { code: "resolution-failed" },
      status: "failed",
    });
    expect(opened.value.readState()).toEqual(beforeState);
    expect(opened.value.project("review")).toEqual(beforeProjection);
    expect(editor.getEditorState().read(logicalSelection)).toEqual(
      beforeSelection,
    );
  });

  it("refuses draft export and round-trips a finalized insertion proposal", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(
      editor,
      acceptedDocument(["Alpha"], ["Beta"]),
      { identityFactory: () => "proposal-50" },
    );

    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    opened.value.insertText({
      format: 2,
      target: { offset: 2, paragraph: 0 },
      text: "😀",
    });
    expect(opened.value.exportDocument()).toMatchObject({
      reason: { code: "active-draft" },
      status: "refused",
    });
    opened.value.finalizeDraft();

    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("unchanged");
    if (exported.status !== "unchanged") {
      return;
    }
    expect(Object.isFrozen(exported.value)).toBe(true);
    expect(exported.value).toMatchObject({
      root: {
        children: [
          { children: [{ text: "Alpha", type: "text" }] },
          { children: [{ text: "Beta", type: "text" }] },
        ],
        $: {
          "lexical-review": {
            proposals: [
              {
                id: "proposal-50",
                kind: "insertion",
                payload: { runs: [{ format: 2, text: "😀" }] },
                status: "pending",
                target: { offset: 2, paragraph: 0 },
              },
            ],
            version: 3,
          },
        },
      },
    });

    const successorEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const successor = openReviewSession(successorEditor, exported.value);
    expect(successor.status).toBe("valid");
    if (successor.status !== "valid") {
      return;
    }
    expect(successor.value.readState()).toEqual(opened.value.readState());
    expect(successor.value.project("review")).toEqual(
      opened.value.project("review"),
    );
  });
});
