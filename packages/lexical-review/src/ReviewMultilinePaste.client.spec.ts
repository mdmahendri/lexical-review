/**
 * Public client coverage for #67: multiline paste preserved as one atomic
 * pending fragment or refused without mutation.
 *
 * Every route case dispatches through `registerReviewSession` against a real
 * editor. Native fragment ownership, correction, normalization, and resolution
 * belong to #57; this suite proves clipboard interpretation, targeting, caret
 * association, and route claiming. WER mapping belongs to
 * `lexical-review-wer` (#74/#82); nothing here imports it.
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  BEFORE_INPUT_COMMAND,
  DROP_COMMAND,
  PASTE_COMMAND,
  createEditor,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $inspectReviewProposal,
  $listReviewProposals,
  $previewAcceptedState,
  $previewAllAccepted,
  $resolveReviewProposals,
  normalizeUntrustedMultilineClipboardContent,
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

function createMultilineEditor(
  nodes: Array<Klass<LexicalNode>> = [
    ReviewInsertionNode,
    ReviewDeletionNode,
    ReviewFormattingNode,
    ReviewFragmentNode,
    ReviewBoundaryNode,
  ],
): LexicalEditor {
  return createEditor({
    namespace: "review-multiline-paste",
    nodes,
    onError: (error) => {
      throw error;
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
  if (!$isRangeSelection(selection)) return null;
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

function open(
  editor: LexicalEditor,
  input: unknown,
  outcomes: ReviewIntentOutcome[] = [],
  options: Parameters<typeof registerReviewSession>[2] = {},
) {
  const opened = openReviewSession(editor, input);
  expect(opened.status).toBe("valid");
  if (opened.status !== "valid")
    throw new Error("Expected the review document to open.");
  const unregister = registerReviewSession(editor, opened.value, {
    ...options,
    onOutcome: (outcome) => {
      outcomes.push(outcome);
      options.onOutcome?.(outcome);
    },
  });
  return { session: opened.value, unregister };
}

function pasteEvent(html: string, plain: string) {
  const preventDefault = vi.fn();
  const event = {
    preventDefault,
    clipboardData: {
      getData: (type: string) => (type === "text/html" ? html : plain),
    },
  } as unknown as ClipboardEvent;
  return { event, preventDefault };
}

function dropEvent(html: string, plain: string, dropEffect: string) {
  const preventDefault = vi.fn();
  const event = {
    preventDefault,
    clientX: 0,
    clientY: 0,
    dataTransfer: {
      getData: (type: string) => (type === "text/html" ? html : plain),
    },
    dropEffect,
  } as unknown as DragEvent;
  return { event, preventDefault };
}

function contentsOf(editor: LexicalEditor): string[] {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((paragraph) => paragraph.getTextContent()),
  );
}

function allAcceptedOf(editor: LexicalEditor): readonly string[] {
  return editor.read(() => $previewAllAccepted().paragraphs);
}

function proposalsOf(editor: LexicalEditor): string[] {
  return editor.read(() => $listReviewProposals());
}

async function selectCaret(
  editor: LexicalEditor,
  nodeIndex: number,
  offset: number,
): Promise<void> {
  await update(editor, () => {
    const nodes = $getRoot().getAllTextNodes();
    const target = nodes[nodeIndex];
    if (target === undefined) throw new Error("Caret fixture node missing.");
    target.select(offset, offset);
  });
}

async function selectAcross(
  editor: LexicalEditor,
  anchorIndex: number,
  anchorOffset: number,
  focusIndex: number,
  focusOffset: number,
): Promise<void> {
  await update(editor, () => {
    const nodes = $getRoot().getAllTextNodes();
    const anchorNode = nodes[anchorIndex];
    const focusNode = nodes[focusIndex];
    if (anchorNode === undefined || focusNode === undefined)
      throw new Error("Selection fixture node missing.");
    anchorNode.select(anchorOffset, anchorOffset);
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error("No range selection.");
    selection.focus.set(focusNode.getKey(), focusOffset, "text");
  });
}

function acceptedDoc(...values: string[]) {
  return reviewDocument(
    values.map((value) => paragraph(value ? [text(value)] : [])),
  );
}

function componentTexts(
  value: ReturnType<typeof normalizeUntrustedMultilineClipboardContent>,
): string[] {
  expect(value.status).toBe("ready");
  if (value.status !== "ready") throw new Error("Expected ready.");
  return value.value.fragment.map((component) =>
    component.runs.map((run) => run.text).join(""),
  );
}

describe("review multiline normalization", () => {
  it("produces one component per boundary for the required fixtures", () => {
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "x\ny")),
    ).toEqual(["x", "y"]);
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "x\r\ny")),
    ).toEqual(["x", "y"]);
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "x\ry")),
    ).toEqual(["x", "y"]);
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent(
          "<p>x</p><p>y</p>",
          "ignored",
        ),
      ),
    ).toEqual(["x", "y"]);
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "\nx\n")),
    ).toEqual(["", "x", ""]);
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "x\n\ny")),
    ).toEqual(["x", "", "y"]);
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent(
          "<p>x</p><p></p><p>y</p>",
          "ignored",
        ),
      ),
    ).toEqual(["x", "", "y"]);
  });

  it("reports soft-break conversion without claiming preservation", () => {
    const single = normalizeUntrustedMultilineClipboardContent(
      "<p>x<br>y</p>",
      "ignored",
    );
    expect(componentTexts(single)).toEqual(["x", "y"]);
    if (single.status !== "ready") throw new Error("Expected ready.");
    expect(single.value.normalization.source).toBe("text/html");
    expect(single.value.normalization.softBreakConverted).toBe(true);

    const doubled = normalizeUntrustedMultilineClipboardContent(
      "<p>x<br><br>y</p>",
      "ignored",
    );
    expect(componentTexts(doubled)).toEqual(["x", "", "y"]);
    if (doubled.status !== "ready") throw new Error("Expected ready.");
    expect(doubled.value.normalization.softBreakConverted).toBe(true);

    const plain = normalizeUntrustedMultilineClipboardContent("", "x\ny");
    if (plain.status !== "ready") throw new Error("Expected ready.");
    expect(plain.value.normalization.softBreakConverted).toBe(false);
  });

  it("preserves leading, trailing, and repeated boundaries without trimming", () => {
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent("<p>x<br></p>", "ignored"),
      ),
    ).toEqual(["x", ""]);
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent(
          "<p>x</p><br><p>y</p>",
          "ignored",
        ),
      ),
    ).toEqual(["x", "", "y"]);
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "\n")),
    ).toEqual(["", ""]);
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "\n\n")),
    ).toEqual(["", "", ""]);
  });

  it("preserves whitespace, non-BMP text, and supported formatting exactly", () => {
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent("", "  x  \n  y  "),
      ),
    ).toEqual(["  x  ", "  y  "]);
    expect(
      componentTexts(normalizeUntrustedMultilineClipboardContent("", "😀\n🎉")),
    ).toEqual(["😀", "🎉"]);
    const formatted = normalizeUntrustedMultilineClipboardContent(
      "<p>hi <strong>there</strong></p><p><em>you</em></p>",
      "ignored",
    );
    expect(formatted.status).toBe("ready");
    if (formatted.status !== "ready") throw new Error("Expected ready.");
    expect(formatted.value.fragment[0]!.runs).toEqual([
      { text: "hi ", format: 0 },
      { text: "there", format: 1 },
    ]);
    expect(formatted.value.fragment[1]!.runs).toEqual([
      { text: "you", format: 2 },
    ]);
  });

  it("prefers html but falls back to plain when rich data is unusable", () => {
    const fallback = normalizeUntrustedMultilineClipboardContent(
      "<p></p>",
      "x\ny",
    );
    expect(fallback.status).toBe("ready");
    if (fallback.status !== "ready") throw new Error("Expected ready.");
    expect(fallback.value.normalization.source).toBe("text/plain");
    expect(componentTexts(fallback)).toEqual(["x", "y"]);
  });

  it("treats foreign review markup as ordinary content and keeps WER bytes literal", () => {
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent(
          '<p><ins data-proposal="a">new</ins></p><p><del data-proposal="b">old</del></p>',
          "ignored",
        ),
      ),
    ).toEqual(["new", "old"]);
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent(
          "",
          '{"kind":"insertion"}\n{"kind":"deletion"}',
        ),
      ),
    ).toEqual(['{"kind":"insertion"}', '{"kind":"deletion"}']);
  });

  it("refuses content with neither text nor boundaries", () => {
    const refused = normalizeUntrustedMultilineClipboardContent(
      '<p><img src="x"></p>',
      "",
    );
    expect(refused.status).toBe("refused");
    if (refused.status !== "refused") throw new Error("Expected refusal.");
    expect(refused.code).toBe("unsafe-normalization");
  });

  it("maps empty input to one empty component for the unchanged path", () => {
    const empty = normalizeUntrustedMultilineClipboardContent("", "");
    expect(componentTexts(empty)).toEqual([""]);
    if (empty.status !== "ready") throw new Error("Expected ready.");
    expect(empty.value.normalization.source).toBe("text/plain");
  });

  it("collapses nested single-text blocks to one piece", () => {
    const nested = normalizeUntrustedMultilineClipboardContent(
      "<div><p>x</p></div>",
      "",
    );
    expect(componentTexts(nested)).toEqual(["x"]);
    if (nested.status !== "ready") throw new Error("Expected ready.");
    expect(nested.value.normalization.source).toBe("text/html");
    expect(nested.value.normalization.flattened).toEqual(["div", "p"]);
    expect(nested.value.normalization.softBreakConverted).toBe(false);
  });

  it("refuses a lone break with no usable text or pieces", () => {
    const refused = normalizeUntrustedMultilineClipboardContent("<br>", "");
    expect(refused.status).toBe("refused");
    if (refused.status !== "refused") throw new Error("Expected refusal.");
    expect(refused.code).toBe("unsafe-normalization");
  });

  it("strips carriage returns inside html text", () => {
    expect(
      componentTexts(
        normalizeUntrustedMultilineClipboardContent("<p>x\r\ny</p>", "ignored"),
      ),
    ).toEqual(["xy"]);
  });

  it("reports source and structure for paragraph pairs", () => {
    const paired = normalizeUntrustedMultilineClipboardContent(
      "<p>x</p><p>y</p>",
      "ignored",
    );
    expect(componentTexts(paired)).toEqual(["x", "y"]);
    if (paired.status !== "ready") throw new Error("Expected ready.");
    expect(paired.value.normalization.source).toBe("text/html");
    expect(paired.value.normalization.flattened).toEqual(["p"]);
    expect(paired.value.normalization.lost).toEqual([]);
    expect(paired.value.normalization.softBreakConverted).toBe(false);
  });

  it("falls back to plain pieces when rich data holds only discarded content", () => {
    const fallback = normalizeUntrustedMultilineClipboardContent(
      '<p><img src="x"></p>',
      "a\nb",
    );
    expect(componentTexts(fallback)).toEqual(["a", "b"]);
    if (fallback.status !== "ready") throw new Error("Expected ready.");
    expect(fallback.value.normalization.source).toBe("text/plain");
  });
});

describe("review multiline paste placement", () => {
  it("pastes into the middle of an accepted paragraph as Ax/yB", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event, preventDefault } = pasteEvent("", "x\ny");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(contentsOf(editor)).toEqual(["Ax", "yB"]);
    expect(allAcceptedOf(editor)).toEqual(["Ax", "yB"]);
    expect(proposalsOf(editor)).toHaveLength(1);
  });

  it("pastes at the end of a paragraph without merging into the next one", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("A", "B"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event } = pasteEvent("", "x\ny");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(contentsOf(editor)).toEqual(["Ax", "y", "B"]);
    expect(proposalsOf(editor)).toHaveLength(1);
  });

  it("pastes at a paragraph start and into an empty paragraph", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 0);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    expect(contentsOf(editor)).toEqual(["x", "yAB"]);

    const empty = createMultilineEditor();
    const emptyOutcomes: ReviewIntentOutcome[] = [];
    open(empty, acceptedDoc(""), emptyOutcomes);
    await update(empty, () => {
      $getRoot().getFirstChildOrThrow().select(0, 0);
    });
    expect(
      empty.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    expect(emptyOutcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(contentsOf(empty)).toEqual(["x", "y"]);
  });

  it("resolves the whole fragment atomically and round trips through save/reload", async () => {
    for (const action of ["accept", "reject"] as const) {
      const editor = createMultilineEditor();
      const outcomes: ReviewIntentOutcome[] = [];
      const { session } = open(editor, acceptedDoc("AB"), outcomes);
      await selectCaret(editor, 0, 1);
      expect(
        editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
      ).toBe(true);
      const [id] = proposalsOf(editor);
      if (!id) throw new Error("Fragment proposal missing.");
      const saved = session.exportDocument();
      expect(saved.status).toBe("valid");
      if (saved.status !== "valid") throw new Error("Export failed.");
      expect(openReviewSession(editor, saved.value).status).toBe("valid");
      await update(editor, () => {
        expect($resolveReviewProposals([id], action).status).toBe("changed");
      });
      expect(contentsOf(editor)).toEqual(
        action === "accept" ? ["Ax", "yB"] : ["AB"],
      );
      expect(proposalsOf(editor)).toHaveLength(0);
    }
  });

  it("classifies a lone boundary as a split and keeps multiple boundaries atomic", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "\n").event),
    ).toBe(true);
    const [splitId] = proposalsOf(editor);
    if (!splitId) throw new Error("Split proposal missing.");
    expect(contentsOf(editor)).toEqual(["A", "B"]);
    expect(editor.read(() => $inspectReviewProposal(splitId))).toMatchObject({
      value: { kind: "structure" },
    });

    const multi = createMultilineEditor();
    const multiOutcomes: ReviewIntentOutcome[] = [];
    open(multi, acceptedDoc("AB"), multiOutcomes);
    await selectCaret(multi, 0, 1);
    expect(
      multi.dispatchCommand(PASTE_COMMAND, pasteEvent("", "\n\n").event),
    ).toBe(true);
    const [fragmentId] = proposalsOf(multi);
    if (!fragmentId) throw new Error("Fragment proposal missing.");
    expect(multi.read(() => $inspectReviewProposal(fragmentId))).toMatchObject({
      value: { kind: "fragment" },
    });
  });
});

describe("review multiline paste ownership", () => {
  it("corrects a fragment in place under the same identity", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    const [id] = proposalsOf(editor);
    if (!id) throw new Error("Fragment proposal missing.");
    await update(editor, () => {
      const nodes = $getRoot().getAllTextNodes();
      const first = nodes.find((node) => node.getTextContent() === "x");
      if (!first) throw new Error("Fragment text missing.");
      first.selectEnd();
    });
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "p\nq").event),
    ).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(proposalsOf(editor)).toEqual([id]);
  });

  it("replaces a range wholly owned by one fragment under the same identity", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    const [id] = proposalsOf(editor);
    if (!id) throw new Error("Fragment proposal missing.");
    await update(editor, () => {
      const nodes = $getRoot().getAllTextNodes();
      const first = nodes.find((node) => node.getTextContent() === "x");
      if (!first) throw new Error("Fragment text missing.");
      first.select(0, 1);
    });
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "p\nq").event),
    ).toBe(true);
    expect(proposalsOf(editor)).toEqual([id]);
  });

  it("refuses mixed-ownership ranges without mutation", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    const [id] = proposalsOf(editor);
    if (!id) throw new Error("Fragment proposal missing.");
    await selectAcross(editor, 0, 0, 1, 1);
    // Captured after the selection update so the first paste has committed.
    const before = editor.getEditorState().toJSON();
    const selection = editor.read(liveSelection);
    const { event, preventDefault } = pasteEvent("", "p\nq");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(outcomes.at(-1)?.status).toBe("refused");
    expect(editor.getEditorState().toJSON()).toEqual(before);
    expect(editor.read(liveSelection)).toEqual(selection);
  });

  it("refuses non-collapsed replacement outside one fragment", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectAcross(editor, 0, 0, 0, 2);
    const before = editor.getEditorState().toJSON();
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    expect(outcomes.at(-1)?.status).toBe("refused");
    expect(editor.getEditorState().toJSON()).toEqual(before);
    expect(proposalsOf(editor)).toHaveLength(0);
  });

  it("refuses multiline paste inside other pending proposal kinds", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(
      editor,
      reviewDocument([
        paragraph([reviewNode("review-insertion", "ins-a", [text("X")])]),
      ]),
      outcomes,
    );
    await selectCaret(editor, 0, 1);
    const before = editor.getEditorState().toJSON();
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    // Insertion interiors only support single-paragraph correction (#66); a
    // multiline payload must refuse rather than invent a kind transition.
    expect(outcomes.at(-1)?.status).toBe("refused");
    expect(editor.getEditorState().toJSON()).toEqual(before);
  });

  it("treats empty paste over a selection as a no-op without deletion", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    await update(editor, () => {
      const nodes = $getRoot().getAllTextNodes();
      const first = nodes.find((node) => node.getTextContent() === "x");
      if (!first) throw new Error("Fragment text missing.");
      first.select(0, 1);
    });
    const before = editor.getEditorState().toJSON();
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "").event),
    ).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "unchanged" });
    expect(editor.getEditorState().toJSON()).toEqual(before);
  });

  it("refuses malformed paste events without mutation", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const before = editor.getEditorState().toJSON();
    expect(
      editor.dispatchCommand(PASTE_COMMAND, {
        preventDefault: () => {},
      } as unknown as ClipboardEvent),
    ).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({
      status: "refused",
      code: "unsupported-transfer",
    });
    expect(editor.getEditorState().toJSON()).toEqual(before);
  });
});

describe("review multiline paste caret and routes", () => {
  it("continues the fragment on proposal-side typing and separates accepted-side deletion", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    const [id] = proposalsOf(editor);
    if (!id) throw new Error("Fragment proposal missing.");
    await update(editor, () => {
      expect($insertReviewText("z").status).toBe("changed");
    });
    expect(proposalsOf(editor)).toEqual([id]);
    expect(allAcceptedOf(editor)).toEqual(["Ax", "yzB"]);
    await update(editor, () => {
      $getRoot().getAllTextNodes()[0]!.selectEnd();
      expect($deleteReviewText(true).status).toBe("changed");
    });
    // Deleting accepted text adjacent to the fragment creates a separate
    // proposal instead of expanding fragment ownership.
    expect(proposalsOf(editor)).toHaveLength(2);
    expect(proposalsOf(editor)).toContain(id);
  });

  it("applies copy-style drop through the same fragment path and refuses move", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event, preventDefault } = dropEvent("", "x\ny", "copy");
    expect(editor.dispatchCommand(DROP_COMMAND, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(contentsOf(editor)).toEqual(["Ax", "yB"]);

    const mover = createMultilineEditor();
    const moverOutcomes: ReviewIntentOutcome[] = [];
    open(mover, acceptedDoc("AB"), moverOutcomes);
    await selectCaret(mover, 0, 1);
    const before = mover.getEditorState().toJSON();
    const refused = dropEvent("", "x\ny", "move");
    expect(mover.dispatchCommand(DROP_COMMAND, refused.event)).toBe(true);
    expect(moverOutcomes.at(-1)).toMatchObject({
      status: "refused",
      code: "unsupported-transfer",
    });
    expect(mover.getEditorState().toJSON()).toEqual(before);
  });

  it("claims each physical paste once across paste and beforeinput routes", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    expect(outcomes).toHaveLength(1);
    const bridge = {
      preventDefault: vi.fn(),
      dataTransfer: { getData: () => "x\ny" },
      inputType: "insertFromPaste",
    } as unknown as InputEvent;
    expect(editor.dispatchCommand(BEFORE_INPUT_COMMAND, bridge)).toBe(true);
    expect(outcomes).toHaveLength(1);
    expect(contentsOf(editor)).toEqual(["Ax", "yB"]);
  });

  it("pastes foreign review markup with one fresh native identity", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event } = pasteEvent(
      '<p><ins data-proposal="foreign-a">x</ins></p><p><del data-proposal="foreign-b">y</del></p>',
      "x\ny",
    );
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    const ids = proposalsOf(editor);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe("foreign-a");
    expect(ids[0]).not.toBe("foreign-b");
    expect(contentsOf(editor)).toEqual(["Ax", "yB"]);
  });

  it("keeps accepted-state preview free of the fragment without resolving it", async () => {
    const editor = createMultilineEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, pasteEvent("", "x\ny").event),
    ).toBe(true);
    const accepted = editor.read(() => {
      const preview = $previewAcceptedState();
      if (preview.status !== "ready") throw new Error("Preview blocked.");
      return preview.value.paragraphs;
    });
    expect(accepted).toEqual(["AB"]);
    expect(proposalsOf(editor)).toHaveLength(1);
  });
});
