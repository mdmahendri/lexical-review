/**
 * Public client coverage for #66: untrusted single-paragraph paste and
 * copy-style drop intake without trusting foreign review markup.
 *
 * Every route case dispatches through `registerReviewSession` against a real
 * editor. No direct-semantic-only proof: route outcomes must equal the shared
 * semantics with one physical action claimed once. WER mapping and
 * conformance belong to `lexical-review-wer` (#74/#82); the only WER-adjacent
 * case here proves literal WER-looking bytes paste as literal text.
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  BEFORE_INPUT_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  DROP_COMMAND,
  PASTE_COMMAND,
  createEditor,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import {
  $insertReviewFragment,
  $listReviewProposals,
  $pasteReviewSelection,
  $previewAcceptedState,
  $previewAllAccepted,
  normalizeUntrustedClipboardContent,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  type ReviewPasteOutcome,
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

function createPasteEditor(
  nodes: Array<Klass<LexicalNode>> = [
    ReviewInsertionNode,
    ReviewDeletionNode,
    ReviewFormattingNode,
    ReviewFragmentNode,
    ReviewBoundaryNode,
  ],
): LexicalEditor {
  return createEditor({
    namespace: "review-paste",
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
  return { unregister };
}

function pasteEvent(html: string, plain: string, throwHtml = false) {
  const preventDefault = vi.fn();
  const event = {
    preventDefault,
    clipboardData: {
      getData: (type: string) => {
        if (type === "text/html") {
          if (throwHtml) throw new Error("OS clipboard denied.");
          return html;
        }
        return plain;
      },
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

function contentOf(editor: LexicalEditor): string {
  return editor.read(() => $getRoot().getTextContent());
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

function acceptedDoc(value: string) {
  return reviewDocument([paragraph([text(value)])]);
}

describe("review paste normalization", () => {
  it("prefers usable html and falls back to plain text when rich data is malformed", () => {
    const html = normalizeUntrustedClipboardContent("<p>hi</p>", "plain");
    expect(html.status).toBe("ready");
    if (html.status !== "ready") throw new Error("Expected ready.");
    expect(html.value.normalization.source).toBe("text/html");
    expect(html.value.runs.map((run) => run.text).join("")).toBe("hi");

    const fallback = normalizeUntrustedClipboardContent("<p>hi</p>", "plain");
    expect(fallback.status).toBe("ready");

    const malformed = normalizeUntrustedClipboardContent("", "plain");
    expect(malformed.status).toBe("ready");
    if (malformed.status !== "ready") throw new Error("Expected ready.");
    expect(malformed.value.normalization.source).toBe("text/plain");
  });

  it("refuses multiline plain text and html paragraph pairs without mutation", () => {
    for (const [html, plain] of [
      ["", "x\ny"],
      ["", "x\r\ny"],
      ["<p>x</p><p>y</p>", "x\ny"],
      ["<p>x<br>y</p>", "x\ny"],
    ] as const) {
      const prepared = normalizeUntrustedClipboardContent(html, plain);
      expect(prepared.status).toBe("refused");
      if (prepared.status !== "refused") throw new Error("Expected refusal.");
      expect(prepared.code).toBe("unsupported-target");
    }
  });

  it("treats foreign review markup as ordinary content", () => {
    const prepared = normalizeUntrustedClipboardContent(
      '<p><ins data-proposal="a">new</ins><del data-proposal="b">old</del></p>',
      "ignored",
    );
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") throw new Error("Expected ready.");
    expect(prepared.value.runs.map((run) => run.text).join("")).toBe("newold");
  });

  it("keeps literal WER-looking text as literal content", () => {
    const literal = '{"kind":"insertion","proposalId":"abc"}';
    const prepared = normalizeUntrustedClipboardContent("", literal);
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") throw new Error("Expected ready.");
    expect(prepared.value.runs).toEqual([{ text: literal, format: 0 }]);
  });
});

describe("review single-paragraph paste", () => {
  it("inserts plain text as one fresh insertion with proposal-side caret", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event } = pasteEvent("", "x");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["AxB"]);
    expect(proposalsOf(editor)).toHaveLength(1);

    // Subsequent typing continues the pasted proposal (proposal-side caret).
    await update(editor, () => {
      const nodes = $getRoot().getAllTextNodes();
      const pasted = nodes.find((node) => node.getTextContent() === "x");
      if (!pasted) throw new Error("Pasted node missing.");
      pasted.selectEnd();
    });
    const { event: second } = pasteEvent("", "y");
    expect(editor.dispatchCommand(PASTE_COMMAND, second)).toBe(true);
    expect(allAcceptedOf(editor)).toEqual(["AxyB"]);
    expect(proposalsOf(editor)).toHaveLength(1);
  });

  it("preserves supported inline formatting from single-paragraph html", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event } = pasteEvent(
      "<p>hi <strong>there</strong></p>",
      "hi there",
    );
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["Ahi thereB"]);
    const formats = editor.read(() =>
      $getRoot()
        .getAllTextNodes()
        .map((node) => node.getFormat()),
    );
    expect(formats).toContain(1);
    expect(proposalsOf(editor)).toHaveLength(1);
  });

  it("falls back to plain text when rich data access throws", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event } = pasteEvent("<p>rich</p>", "plain", true);
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["AplainB"]);
  });

  it("sanitizes links and scripts while reporting loss", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 2);
    const { event } = pasteEvent(
      '<p><a href="https://example.invalid">link</a><script>evil()</script><strong>bold</strong></p>',
      "linkbold",
    );
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    const outcome = outcomes.at(-1);
    expect(outcome).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["ABlinkbold"]);
    expect(contentOf(editor)).not.toContain("evil()");
    const formats = editor.read(() =>
      $getRoot()
        .getAllTextNodes()
        .filter((node) => node.getTextContent() === "bold")
        .map((node) => node.getFormat()),
    );
    expect(formats).toEqual([1]);
  });

  it("pastes literal WER JSON as text with a fresh native identity", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const literal = '{"kind":"insertion","proposalId":"foreign"}';
    const { event } = pasteEvent("", literal);
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual([`A${literal}B`]);
    const ids = proposalsOf(editor);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe("foreign");
  });

  it("creates one atomic replacement for a non-collapsed accepted range", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectAcross(editor, 0, 1, 0, 2);
    const { event } = pasteEvent("", "x");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["Ax"]);
    const accepted = editor.read(() => {
      const preview = $previewAcceptedState();
      if (preview.status !== "ready") throw new Error("Preview blocked.");
      return preview.value.paragraphs;
    });
    expect(accepted).toEqual(["AB"]);
    expect(proposalsOf(editor)).toHaveLength(1);
  });

  it("corrects a wholly selected insertion under the same identity", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          reviewNode("review-insertion", "paste-x", [text("x")]),
          text("B"),
        ]),
      ]),
      outcomes,
    );
    await selectCaret(editor, 1, 1);
    const { event } = pasteEvent("", "yz");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["AxyzB"]);
    expect(proposalsOf(editor)).toEqual(["paste-x"]);
  });

  it("routes multiline paste to one atomic fragment instead of refusing (#67)", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const { event, preventDefault } = pasteEvent("", "x\ny");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["Ax", "yB"]);
    expect(proposalsOf(editor)).toHaveLength(1);
  });

  it("reports empty paste as unchanged without mutation", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const before = contentOf(editor);
    const { event } = pasteEvent("", "");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "unchanged" });
    expect(contentOf(editor)).toBe(before);
    expect(proposalsOf(editor)).toHaveLength(0);
  });

  it("refuses malformed paste events without mutation", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const before = contentOf(editor);
    expect(
      editor.dispatchCommand(PASTE_COMMAND, {
        preventDefault: () => {},
      } as unknown as ClipboardEvent),
    ).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({
      status: "refused",
      code: "unsupported-transfer",
    });
    expect(contentOf(editor)).toBe(before);
  });

  it("refuses mixed-identity selections without mutation", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(
      editor,
      reviewDocument([
        paragraph([
          reviewNode("review-insertion", "paste-a", [text("X")]),
          reviewNode("review-insertion", "paste-b", [text("Y")]),
        ]),
      ]),
      outcomes,
    );
    await selectAcross(editor, 0, 0, 1, 1);
    const before = contentOf(editor);
    const { event } = pasteEvent("", "z");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)?.status).toBe("refused");
    expect(contentOf(editor)).toBe(before);
    expect(proposalsOf(editor)).toEqual(["paste-a", "paste-b"]);
  });

  it("corrects fragment-owned text under the same fragment identity", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    await update(editor, () => {
      const outcome = $insertReviewFragment(
        [{ runs: [{ text: "xy", format: 0 }] }],
        {},
      );
      expect(outcome.status).toBe("changed");
    });
    const fragmentId = proposalsOf(editor)[0];
    if (!fragmentId) throw new Error("Fragment proposal missing.");
    const { event } = pasteEvent("", "Z");
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(proposalsOf(editor)).toEqual([fragmentId]);
    expect(allAcceptedOf(editor)).toEqual(["AxyZB"]);
  });

  it("matches the direct semantic outcome for the same paste", async () => {
    const input = acceptedDoc("AB");
    const routed = createPasteEditor();
    const routedOutcomes: ReviewIntentOutcome[] = [];
    open(routed, input, routedOutcomes);
    await selectCaret(routed, 0, 1);

    const direct = createPasteEditor();
    const directOutcomes: ReviewPasteOutcome[] = [];
    open(direct, input);
    await selectCaret(direct, 0, 1);

    const routedEvent = pasteEvent("", "x");
    expect(routed.dispatchCommand(PASTE_COMMAND, routedEvent.event)).toBe(true);
    await update(direct, () => {
      directOutcomes.push($pasteReviewSelection(pasteEvent("", "x").event, {}));
    });
    expect(routedOutcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(directOutcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(contentOf(routed)).toBe(contentOf(direct));
  });
});

describe("review copy-style drop", () => {
  it("applies copy-style drop at the live selection", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 2);
    const { event, preventDefault } = dropEvent("", "x", "copy");
    expect(editor.dispatchCommand(DROP_COMMAND, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(outcomes.at(-1)).toMatchObject({ status: "changed" });
    expect(allAcceptedOf(editor)).toEqual(["ABx"]);
    expect(proposalsOf(editor)).toHaveLength(1);
  });

  it("refuses move-style drop with zero mutation", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const before = contentOf(editor);
    const { event, preventDefault } = dropEvent("", "x", "move");
    expect(editor.dispatchCommand(DROP_COMMAND, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(outcomes.at(-1)).toMatchObject({
      status: "refused",
      code: "unsupported-transfer",
    });
    expect(contentOf(editor)).toBe(before);
    expect(proposalsOf(editor)).toHaveLength(0);
  });

  it("claims the beforeinput paste bridge and drop insertion halves once", async () => {
    const editor = createPasteEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    open(editor, acceptedDoc("AB"), outcomes);
    await selectCaret(editor, 0, 1);
    const before = contentOf(editor);
    const pasteBridge = {
      preventDefault: vi.fn(),
      dataTransfer: { getData: () => "x" },
      inputType: "insertFromPaste",
    } as unknown as InputEvent;
    expect(editor.dispatchCommand(BEFORE_INPUT_COMMAND, pasteBridge)).toBe(
      true,
    );
    const dropInsertion = {
      preventDefault: vi.fn(),
      data: "x",
      dataTransfer: { getData: () => "x" },
      inputType: "insertFromDrop",
    } as unknown as InputEvent;
    expect(
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, dropInsertion),
    ).toBe(true);
    expect(outcomes).toHaveLength(0);
    expect(contentOf(editor)).toBe(before);
  });
});
