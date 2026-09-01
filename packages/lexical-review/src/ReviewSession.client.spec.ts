import {
  BEFORE_INPUT_COMMAND,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  CUT_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  REMOVE_TEXT_COMMAND,
  createEditor,
  type ElementNode,
} from "lexical";
import { ReviewTextNode } from "./ReviewTextNode";
import {
  openReviewSession,
  type ReviewOutcome,
  type ReviewStateView,
} from "./LegacyReviewSession";
import { registerReviewText } from "./registerReviewText";
import { registerReviewSession } from "./registerReviewSession";

function acceptedDocument(text: string, format = 0) {
  return {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format,
              mode: "normal",
              style: "",
              text,
              type: "text",
              version: 1,
            },
          ],
          direction: null,
          format: "",
          indent: 0,
          textFormat: 0,
          textStyle: "",
          type: "paragraph",
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
      $: { "lexical-review": { proposals: [], version: 3 } },
    },
  };
}

function documentWithInsertionProposal(
  acceptedText: string,
  proposalText: string,
  offset: number,
) {
  const input = acceptedDocument(acceptedText);
  return {
    root: {
      ...input.root,
      $: {
        "lexical-review": {
          proposals: [
            {
              id: "proposal-a",
              kind: "insertion",
              payload: { runs: [{ format: 0, text: proposalText }] },
              status: "pending",
              target: { offset, paragraph: 0 },
            },
          ],
          version: 3,
        },
      },
    },
  };
}

function documentWithDeletionProposal(
  acceptedText: string,
  start: number,
  end: number,
) {
  const input = acceptedDocument(acceptedText);
  return {
    root: {
      ...input.root,
      $: {
        "lexical-review": {
          proposals: [
            {
              id: "deletion-a",
              kind: "deletion",
              payload: {
                runs: [{ format: 0, text: acceptedText.slice(start, end) }],
              },
              status: "pending",
              target: {
                start: { offset: start, paragraph: 0 },
                end: { offset: end, paragraph: 0 },
              },
            },
          ],
          version: 3,
        },
      },
    },
  };
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

function selectElementBoundary(
  paragraph: ElementNode,
  anchorOffset: number,
  focusOffset = anchorOffset,
): void {
  const selection = paragraph.select();
  selection.anchor.set(paragraph.getKey(), anchorOffset, "element");
  selection.focus.set(paragraph.getKey(), focusOffset, "element");
  selection.dirty = true;
}

describe("version 3 client integration", () => {
  it("refuses an ambiguous element-point boundary without moving selection", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(
      editor,
      documentWithInsertionProposal("Alpha", "A", 0),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onInsertionOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        $getRoot().getFirstChild<ElementNode>()?.select(1, 1);
      },
      { discrete: true },
    );
    const beforeSelection = editor.getEditorState().read(liveSelection);

    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );

    expect(outcomes).toMatchObject([
      { reason: { code: "ambiguous-boundary" }, status: "refused" },
    ]);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    expect(opened.value.readState()).toMatchObject({
      draft: null,
      proposals: [{ id: "proposal-a", status: "pending" }],
    });

    unregister();
  });

  it.each([
    [0, 0],
    [1, 5],
  ])(
    "maps a paragraph element point at child offset %s to accepted offset %s",
    async (childOffset, expectedOffset) => {
      const editor = createEditor({
        nodes: [ReviewTextNode],
        onError: (error) => void error,
      });
      const opened = openReviewSession(editor, acceptedDocument("Alpha"));
      expect(opened.status).toBe("valid");
      if (opened.status !== "valid") {
        return;
      }
      const unregister = registerReviewSession(editor, opened.value);

      editor.update(
        () => {
          const paragraph = $getRoot().getFirstChild<ElementNode>();
          if (paragraph !== null) {
            selectElementBoundary(paragraph, childOffset);
          }
        },
        { discrete: true },
      );

      expect(
        editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X"),
      ).toBe(true);
      await Promise.resolve();

      expect(opened.value.readState()).toMatchObject({
        draft: {
          kind: "insertion",
          target: { offset: expectedOffset, paragraph: 0 },
        },
      });

      unregister();
    },
  );

  it("maps a paragraph element range to an accepted deletion range", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const unregister = registerReviewSession(editor, opened.value);

    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        if (paragraph !== null) {
          selectElementBoundary(paragraph, 0, 1);
        }
      },
      { discrete: true },
    );

    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    expect(opened.value.readState()).toMatchObject({
      draft: {
        kind: "deletion",
        payload: { runs: [{ text: "Alpha" }] },
        target: {
          start: { offset: 0, paragraph: 0 },
          end: { offset: 5, paragraph: 0 },
        },
      },
    });

    unregister();
  });

  it("refuses a finalized-proposal range intersection without mutation", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(
      editor,
      documentWithInsertionProposal("Alpha", "ABC", 2),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onInsertionOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const proposal = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "ABC",
          );
        if (proposal instanceof ReviewTextNode) {
          proposal.select(0, 2);
        }
      },
      { discrete: true },
    );
    const beforeState = opened.value.readState();
    const beforeProjection = opened.value.project("review");
    const beforeSelection = editor.getEditorState().read(liveSelection);

    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );

    expect(outcomes).toMatchObject([
      {
        reason: { code: "finalized-proposal-intersection" },
        status: "refused",
      },
    ]);
    expect(opened.value.readState()).toEqual(beforeState);
    expect(opened.value.project("review")).toEqual(beforeProjection);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );

    unregister();
  });

  it("claims direct deletion inside finalized proposal content", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(
      editor,
      documentWithInsertionProposal("Alpha", "ABC", 2),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregisterLegacy = registerReviewText(editor);
    const unregister = registerReviewSession(editor, opened.value, {
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const proposal = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "ABC",
          );
        if (proposal instanceof ReviewTextNode) {
          proposal.select(2, 2);
        }
      },
      { discrete: true },
    );
    const beforeState = opened.value.readState();
    const beforeProjection = opened.value.project("review");
    const beforeSelection = editor.getEditorState().read(liveSelection);

    expect(editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true)).toBe(true);

    expect(outcomes).toMatchObject([
      { reason: { code: "proposal-side-target" }, status: "refused" },
    ]);
    expect(opened.value.readState()).toEqual(beforeState);
    expect(opened.value.project("review")).toEqual(beforeProjection);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );

    unregister();
    unregisterLegacy();
  });

  it("routes explicit deletion ranges through the same root contract", async () => {
    const rootEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const rootOpened = openReviewSession(rootEditor, acceptedDocument("Alpha"));
    expect(rootOpened.status).toBe("valid");
    if (rootOpened.status !== "valid") {
      return;
    }
    expect(
      rootOpened.value.deleteText({
        target: {
          end: { offset: 3, paragraph: 0 },
          start: { offset: 1, paragraph: 0 },
        },
      }),
    ).toMatchObject({ status: "changed" });

    const clientEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const clientOpened = openReviewSession(
      clientEditor,
      acceptedDocument("Alpha"),
    );
    expect(clientOpened.status).toBe("valid");
    if (clientOpened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(clientEditor, clientOpened.value, {
      onDeletionOutcome: (outcome) => outcomes.push(outcome),
    });
    clientEditor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(1, 3);
        }
      },
      { discrete: true },
    );

    expect(clientEditor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      {
        status: "changed",
        value: {
          draft: {
            kind: "deletion",
            payload: { runs: [{ text: "lp" }] },
          },
        },
      },
    ]);
    expect(clientOpened.value.readState()).toEqual(
      rootOpened.value.readState(),
    );
    expect(clientOpened.value.project("review")).toEqual(
      rootOpened.value.project("review"),
    );

    unregister();
  });

  it("corrects insertion-draft content through a deletion command", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const deletionOutcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onDeletionOutcome: (outcome) => deletionOutcomes.push(outcome),
    });

    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(2, 2);
        }
      },
      { discrete: true },
    );
    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "XYZ"),
    ).toBe(true);
    await Promise.resolve();

    editor.update(
      () => {
        const draft = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "XYZ",
          );
        if ($isTextNode(draft)) {
          draft.select(1, 3);
        }
      },
      { discrete: true },
    );
    expect(editor.dispatchCommand(DELETE_CHARACTER_COMMAND, false)).toBe(true);
    await Promise.resolve();

    expect(deletionOutcomes).toMatchObject([
      {
        status: "changed",
        value: { draft: { payload: { runs: [{ text: "X" }] } } },
      },
    ]);
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Al", type: "accepted" },
      { format: 0, text: "X", type: "draft-insertion" },
      { format: 0, text: "pha", type: "accepted" },
    ]);

    unregister();
  });

  it("does not mutate when a deletion command points toward its own draft", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onDeletionOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(1, 3);
        }
      },
      { discrete: true },
    );
    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    const before = opened.value.readState();
    editor.update(
      () => {
        const accepted = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode && child.getTextContent() === "A",
          );
        if ($isTextNode(accepted)) {
          accepted.selectEnd();
        }
      },
      { discrete: true },
    );
    expect(editor.dispatchCommand(DELETE_CHARACTER_COMMAND, false)).toBe(true);
    await Promise.resolve();

    expect(outcomes.at(-1)).toEqual({ status: "unchanged", value: before });
    expect(opened.value.readState()).toEqual(before);

    unregister();
  });

  it("restores a deletion draft when a caret inside it is deleted", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onDeletionOutcome: (outcome) => outcomes.push(outcome),
    });

    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(1, 3);
        }
      },
      { discrete: true },
    );
    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    editor.update(
      () => {
        const draft = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "lp",
          );
        if ($isTextNode(draft)) {
          draft.select(1, 1);
        }
      },
      { discrete: true },
    );
    expect(editor.dispatchCommand(DELETE_CHARACTER_COMMAND, false)).toBe(true);
    await Promise.resolve();

    expect(outcomes.at(-1)).toMatchObject({
      status: "changed",
      value: { draft: null },
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha", type: "accepted" },
    ]);

    unregister();
  });

  it("corrects an insertion draft when the selection starts at its accepted boundary", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onDeletionOutcome: (outcome) => outcomes.push(outcome),
    });

    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(2, 2);
        }
      },
      { discrete: true },
    );
    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "XYZ"),
    ).toBe(true);
    await Promise.resolve();

    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const accepted = paragraph
          ?.getChildren()
          .find(
            (child) => $isTextNode(child) && child.getTextContent() === "Al",
          );
        const draft = paragraph
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "XYZ",
          );
        if ($isTextNode(accepted) && $isTextNode(draft)) {
          const selection = accepted.selectEnd();
          selection.focus.set(draft.getKey(), 1, "text");
          selection.dirty = true;
        }
      },
      { discrete: true },
    );
    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    expect(outcomes.at(-1)).toMatchObject({
      status: "changed",
      value: { draft: { payload: { runs: [{ text: "YZ" }] } } },
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Al", type: "accepted" },
      { format: 0, text: "YZ", type: "draft-insertion" },
      { format: 0, text: "pha", type: "accepted" },
    ]);

    unregister();
  });

  it("routes native forward beforeinput deletion into the review session", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onDeletionOutcome: (outcome) => outcomes.push(outcome),
    });

    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(0, 1);
        }
      },
      { discrete: true },
    );
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentForward",
    });
    expect(editor.dispatchCommand(BEFORE_INPUT_COMMAND, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    await Promise.resolve();

    expect(outcomes.at(-1)).toMatchObject({
      status: "changed",
      value: { draft: { kind: "deletion" } },
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "A", type: "draft-deletion" },
      { format: 0, text: "lpha", type: "accepted" },
    ]);

    unregister();
  });

  it("keeps the selected range when restoring a deletion draft", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const unregister = registerReviewSession(editor, opened.value);

    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(1, 3);
        }
      },
      { discrete: true },
    );
    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    editor.update(
      () => {
        const draft = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "lp",
          );
        if ($isTextNode(draft)) {
          draft.select(0, 1);
        }
      },
      { discrete: true },
    );

    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    expect(opened.value.project("review").paragraphs[0]?.runs).toEqual([
      { format: 0, text: "Alpha", type: "accepted" },
    ]);
    expect(
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return null;
        }
        return {
          anchorText: selection.anchor.getNode().getTextContent(),
          anchorOffset: selection.anchor.offset,
          collapsed: selection.isCollapsed(),
          focusOffset: selection.focus.offset,
        };
      }),
    ).toMatchObject({
      anchorText: "lp",
      anchorOffset: 0,
      collapsed: false,
      focusOffset: 1,
    });

    unregister();
  });

  it("routes character and word deletion commands into deletion drafts", async () => {
    const characterEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const characterOpened = openReviewSession(
      characterEditor,
      acceptedDocument("Alpha beta"),
    );
    expect(characterOpened.status).toBe("valid");
    if (characterOpened.status !== "valid") {
      return;
    }
    const characterOutcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregisterCharacter = registerReviewSession(
      characterEditor,
      characterOpened.value,
      { onDeletionOutcome: (outcome) => characterOutcomes.push(outcome) },
    );
    characterEditor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(4, 5);
        }
      },
      { discrete: true },
    );
    expect(
      characterEditor.dispatchCommand(DELETE_CHARACTER_COMMAND, true),
    ).toBe(true);
    await Promise.resolve();
    expect(characterOutcomes).toMatchObject([{ status: "changed" }]);
    expect(characterOpened.value.readState().draft).toMatchObject({
      kind: "deletion",
      target: {
        start: { offset: 4 },
        end: { offset: 5 },
      },
    });
    unregisterCharacter();

    const wordEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const wordOpened = openReviewSession(
      wordEditor,
      acceptedDocument("Alpha beta"),
    );
    expect(wordOpened.status).toBe("valid");
    if (wordOpened.status !== "valid") {
      return;
    }
    const wordOutcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregisterWord = registerReviewSession(wordEditor, wordOpened.value, {
      onDeletionOutcome: (outcome) => wordOutcomes.push(outcome),
    });
    wordEditor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(5, 10);
        }
      },
      { discrete: true },
    );
    expect(wordEditor.dispatchCommand(DELETE_WORD_COMMAND, true)).toBe(true);
    await Promise.resolve();
    expect(wordOutcomes).toMatchObject([{ status: "changed" }]);
    expect(wordOpened.value.readState().draft).toMatchObject({
      kind: "deletion",
      target: {
        start: { offset: 5 },
        end: { offset: 10 },
      },
    });
    unregisterWord();
  });

  it("claims Backspace and Delete before native text removal", async () => {
    const cases = [
      [KEY_BACKSPACE_COMMAND, true],
      [KEY_DELETE_COMMAND, false],
    ] as const;
    for (const [command, isBackward] of cases) {
      const editor = createEditor({
        nodes: [ReviewTextNode],
        onError: (error) => void error,
      });
      const opened = openReviewSession(editor, acceptedDocument("Alpha"));
      expect(opened.status).toBe("valid");
      if (opened.status !== "valid") {
        continue;
      }
      const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
      const unregister = registerReviewSession(editor, opened.value, {
        onDeletionOutcome: (outcome) => outcomes.push(outcome),
      });
      editor.update(
        () => {
          const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
          if ($isTextNode(text)) {
            text.select(1, 3);
          }
        },
        { discrete: true },
      );
      const event = new KeyboardEvent("keydown", { cancelable: true });
      expect(editor.dispatchCommand(command, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      await Promise.resolve();
      expect(outcomes).toMatchObject([{ status: "changed" }]);
      expect(opened.value.readState().draft).toMatchObject({
        kind: "deletion",
        target: {
          start: { offset: 1 },
          end: { offset: 3 },
        },
      });
      const draft = opened.value.readState().draft;
      expect(draft?.kind).toBe("deletion");
      if (draft?.kind === "deletion") {
        expect(draft.target.start.offset).toBe(1);
        expect(draft.target.end.offset).toBe(3);
      }
      expect(isBackward).toBe(command === KEY_BACKSPACE_COMMAND);
      unregister();
    }
  });

  it("refuses deletion ranges that intersect finalized deletion proposals", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(
      editor,
      documentWithDeletionProposal("Alpha", 1, 3),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onDeletionOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const proposal = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "lp",
          );
        if ($isTextNode(proposal)) {
          proposal.select(0, 1);
        }
      },
      { discrete: true },
    );
    const before = opened.value.readState();

    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, null)).toBe(true);
    expect(outcomes).toMatchObject([
      {
        reason: { code: "finalized-proposal-intersection" },
        status: "refused",
      },
    ]);
    expect(opened.value.readState()).toEqual(before);

    unregister();
  });

  it("refuses unsupported paragraph structure without mutation", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregisterLegacy = registerReviewText(editor);
    const unregister = registerReviewSession(editor, opened.value, {
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(2, 2);
        }
      },
      { discrete: true },
    );
    const beforeState = opened.value.readState();
    const beforeProjection = opened.value.project("review");
    const beforeSelection = editor.getEditorState().read(liveSelection);

    expect(editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined)).toBe(
      true,
    );

    expect(outcomes).toMatchObject([
      { reason: { code: "unsupported-structure" }, status: "refused" },
    ]);
    expect(opened.value.readState()).toEqual(beforeState);
    expect(opened.value.project("review")).toEqual(beforeProjection);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );

    unregister();
    unregisterLegacy();
  });

  it("authors from an explicit accepted side adjacent to finalized work", async () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(
      editor,
      documentWithInsertionProposal("Alpha", "A", 0),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const accepted = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getLastChild();
        if ($isTextNode(accepted)) {
          accepted.select(0, 0);
        }
      },
      { discrete: true },
    );

    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );
    await Promise.resolve();

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["changed"]);
    expect(opened.value.readState()).toMatchObject({
      draft: { payload: { runs: [{ text: "X" }] } },
      proposals: [{ id: "proposal-a", status: "pending" }],
    });

    unregister();
  });

  it("refuses an unsupported accepted range without mutation", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const accepted = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getFirstChild();
        if ($isTextNode(accepted)) {
          accepted.select(1, 4);
        }
      },
      { discrete: true },
    );
    const beforeState = opened.value.readState();
    const beforeSelection = editor.getEditorState().read(liveSelection);

    expect(editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X")).toBe(
      true,
    );

    expect(outcomes).toMatchObject([
      { reason: { code: "unsupported-target" }, status: "refused" },
    ]);
    expect(opened.value.readState()).toEqual(beforeState);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );

    unregister();
  });

  it("claims cut before finalized content or selection can change", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(
      editor,
      documentWithInsertionProposal("Alpha", "ABC", 2),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const proposal = $getRoot()
          .getFirstChild<ElementNode>()
          ?.getChildren()
          .find(
            (child) =>
              child instanceof ReviewTextNode &&
              child.getTextContent() === "ABC",
          );
        if (proposal instanceof ReviewTextNode) {
          proposal.select(0, 3);
        }
      },
      { discrete: true },
    );
    const beforeState = opened.value.readState();
    const beforeProjection = opened.value.project("review");
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const event = new Event("cut", { cancelable: true }) as ClipboardEvent;

    expect(editor.dispatchCommand(CUT_COMMAND, event)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(outcomes).toMatchObject([
      {
        reason: { code: "finalized-proposal-intersection" },
        status: "refused",
      },
    ]);
    expect(opened.value.readState()).toEqual(beforeState);
    expect(opened.value.project("review")).toEqual(beforeProjection);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );

    unregister();
  });

  it("reports line deletion as an unsupported accepted-side intention", () => {
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, acceptedDocument("Alpha"));
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregister = registerReviewSession(editor, opened.value, {
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    editor.update(
      () => {
        const text = $getRoot().getFirstChild<ElementNode>()?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(2, 2);
        }
      },
      { discrete: true },
    );

    expect(editor.dispatchCommand(DELETE_LINE_COMMAND, true)).toBe(true);

    expect(outcomes).toMatchObject([
      { reason: { code: "unsupported-deletion" }, status: "refused" },
    ]);
    expect(opened.value.readState()).toMatchObject({
      accepted: { paragraphs: [{ runs: [{ text: "Alpha" }] }] },
      draft: null,
      proposals: [],
    });

    unregister();
  });

  it("routes controlled typing through the root insertion contract", async () => {
    const rootEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const rootOpened = openReviewSession(
      rootEditor,
      acceptedDocument("Alpha", 1),
    );
    expect(rootOpened.status).toBe("valid");
    if (rootOpened.status !== "valid") {
      return;
    }
    const rootOutcome = rootOpened.value.insertText({
      format: 1,
      target: { offset: 2, paragraph: 0 },
      text: "XY",
    });
    expect(rootOutcome.status).toBe("changed");

    const clientEditor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
      theme: { ins: "review-insertion" },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    clientEditor.setRootElement(container);
    const clientOpened = openReviewSession(
      clientEditor,
      acceptedDocument("Alpha", 1),
    );
    expect(clientOpened.status).toBe("valid");
    if (clientOpened.status !== "valid") {
      return;
    }
    const outcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregisterLegacy = registerReviewText(clientEditor);
    const unregister = registerReviewSession(clientEditor, clientOpened.value, {
      onInsertionOutcome: (outcome) => outcomes.push(outcome),
    });

    clientEditor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const text = paragraph?.getFirstChild();
        if ($isTextNode(text)) {
          text.select(2, 2);
        }
      },
      { discrete: true },
    );
    expect(
      clientEditor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X"),
    ).toBe(true);
    await Promise.resolve();
    clientEditor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const accepted = paragraph?.getFirstChild();
        if ($isTextNode(accepted)) {
          accepted.select(0, 0);
        }
      },
      { discrete: true },
    );
    expect(
      clientOpened.value.project("all-accepted").paragraphs[0]?.runs,
    ).toMatchObject([{ text: "Al" }, { text: "X" }, { text: "pha" }]);
    expect(clientOpened.value.readState()).toMatchObject({
      draft: { payload: { runs: [{ text: "X" }] } },
      proposals: [],
    });
    clientEditor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const draft = paragraph
          ?.getChildren()
          .find((child) => child instanceof ReviewTextNode);
        if ($isTextNode(draft)) {
          draft.selectEnd();
        }
      },
      { discrete: true },
    );
    expect(
      clientEditor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "Y"),
    ).toBe(true);
    await Promise.resolve();

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "changed",
      "changed",
    ]);
    expect(clientOpened.value.readState()).toEqual(
      rootOpened.value.readState(),
    );
    expect(clientOpened.value.project("review")).toEqual(
      rootOpened.value.project("review"),
    );
    const insertion = container.querySelector("ins");
    expect(insertion?.classList.contains("review-insertion")).toBe(true);
    expect(insertion?.firstElementChild?.tagName).toBe("STRONG");
    expect(insertion?.textContent).toBe("XY");
    expect(window.getSelection()?.focusNode).toBe(
      insertion?.firstElementChild?.firstChild,
    );
    expect(window.getSelection()?.focusOffset).toBe(2);

    unregister();
    unregisterLegacy();
    clientEditor.setRootElement(null);
    document.body.removeChild(container);
  });

  it("keeps adjacent finalized proposal identities distinct during normalization", async () => {
    const input = acceptedDocument("Alpha");
    const documentWithProposals = {
      root: {
        ...input.root,
        $: {
          "lexical-review": {
            proposals: [
              {
                id: "proposal-a",
                kind: "insertion",
                payload: { runs: [{ format: 0, text: "A" }] },
                status: "pending",
                target: { offset: 0, paragraph: 0 },
              },
              {
                id: "proposal-b",
                kind: "insertion",
                payload: { runs: [{ format: 0, text: "B" }] },
                status: "pending",
                target: { offset: 0, paragraph: 0 },
              },
            ],
            version: 3,
          },
        },
      },
    };
    const editor = createEditor({
      nodes: [ReviewTextNode],
      onError: (error) => void error,
    });
    const opened = openReviewSession(editor, documentWithProposals);
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }

    const refusedOutcomes: Array<ReviewOutcome<ReviewStateView>> = [];
    const unregisterLegacy = registerReviewText(editor);
    const unregisterSession = registerReviewSession(editor, opened.value, {
      onInsertionOutcome: (outcome) => refusedOutcomes.push(outcome),
    });
    await Promise.resolve();

    expect(opened.value.project("review").paragraphs[0]?.runs).toMatchObject([
      { proposalId: "proposal-a", text: "A" },
      { proposalId: "proposal-b", text: "B" },
      { text: "Alpha", type: "accepted" },
    ]);
    const beforeFinalizedTyping = opened.value.readState();
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild<ElementNode>();
        const proposalB = paragraph?.getChildAtIndex(1);
        if ($isTextNode(proposalB)) {
          proposalB.select(1, 1);
        }
      },
      { discrete: true },
    );
    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "forbidden"),
    ).toBe(true);
    expect(refusedOutcomes).toMatchObject([
      {
        reason: { code: "proposal-side-target" },
        status: "refused",
      },
    ]);
    expect(opened.value.readState()).toEqual(beforeFinalizedTyping);

    expect(opened.value.acceptProposal("proposal-a")).toMatchObject({
      status: "changed",
    });
    expect(opened.value.project("review").paragraphs[0]?.runs).toMatchObject([
      { text: "A", type: "accepted" },
      { proposalId: "proposal-b", text: "B" },
      { text: "Alpha", type: "accepted" },
    ]);

    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("unchanged");
    if (exported.status === "unchanged") {
      const successorEditor = createEditor({
        nodes: [ReviewTextNode],
        onError: (error) => void error,
      });
      const successor = openReviewSession(successorEditor, exported.value);
      expect(successor.status).toBe("valid");
      if (successor.status === "valid") {
        expect(successor.value.project("review")).toEqual(
          opened.value.project("review"),
        );
      }
    }

    unregisterSession();
    unregisterLegacy();
  });
});
