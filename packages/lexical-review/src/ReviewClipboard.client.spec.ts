/**
 * Public client coverage for #65: ordinary copy/cut export content-only
 * clipboard projections without portable proposal identity.
 *
 * Every case dispatches through `registerReviewSession` against a real
 * editor. No direct-semantic-only proof: route outcomes must equal the
 * shared semantics with one physical action claimed once.
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COPY_COMMAND,
  CUT_COMMAND,
  REMOVE_TEXT_COMMAND,
  createEditor,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";
import {
  openReviewSession,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewInsertionNode,
} from "./index";
import {
  registerReviewSession,
  type ReviewIntentOutcome,
} from "./registerReviewSession";
import {
  formattingNode,
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function createClipboardEditor(
  nodes: Array<Klass<LexicalNode>> = [
    ReviewInsertionNode,
    ReviewDeletionNode,
    ReviewFormattingNode,
  ],
): LexicalEditor {
  return createEditor({
    namespace: "review-clipboard",
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
  return { unregister };
}

type ClipboardStore = {
  event: ClipboardEvent;
  preventDefault: ReturnType<typeof vi.fn>;
  setData: ReturnType<typeof vi.fn>;
  store: Map<string, string>;
};

function mockClipboard(throwOnWrite = false): ClipboardStore {
  const store = new Map<string, string>();
  const setData = vi.fn((type: string, data: string) => {
    if (throwOnWrite) throw new Error("OS clipboard denied.");
    store.set(type, data);
  });
  const preventDefault = vi.fn();
  const event = {
    preventDefault,
    clipboardData: {
      setData,
      getData: (type: string) => store.get(type) ?? "",
    },
  } as unknown as ClipboardEvent;
  return { event, preventDefault, setData, store };
}

function textNodes(editor: LexicalEditor): TextNode[] {
  return editor.getEditorState().read(() => $getRoot().getAllTextNodes());
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

function insertion(id: string, value: string, format = 0) {
  return reviewNode("review-insertion", id, [text(value, format)]);
}

function deletion(id: string, value: string, format = 0) {
  return reviewNode("review-deletion", id, [text(value, format)]);
}

describe("review clipboard projections", () => {
  it("copies accepted content identically in both modes without identity", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 2));
    const { event, store } = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      {
        status: "changed",
        value: { mode: "all-accepted", projectedLength: 2 },
      },
    ]);
    expect(store.get("text/plain")).toBe("AB");
    expect(store.get("text/html")).toBe("<p>AB</p>");
    unregister();
  });

  it("copies accepted content identically under the accepted-state mode", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      { copyProjection: "accepted-state" },
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 2));
    const { store } = mockClipboard();
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      {
        status: "changed",
        value: { mode: "accepted-state", projectedLength: 2 },
      },
    ]);
    expect(clipboard.store.get("text/plain")).toBe("AB");
    expect(store.size).toBe(0);
    unregister();
  });

  it("copies insertion content only in all-accepted mode", async () => {
    const editor = createClipboardEditor();
    const acceptedOutcomes: ReviewIntentOutcome[] = [];
    const openAccepted = open(
      editor,
      reviewDocument([paragraph([insertion("ins-a", "X")])]),
      acceptedOutcomes,
      { copyProjection: "accepted-state" },
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 1));
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(acceptedOutcomes).toMatchObject([
      { code: "empty-projection", status: "refused" },
    ]);
    expect(clipboard.setData).not.toHaveBeenCalled();
    openAccepted.unregister();

    const editor2 = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor2,
      reviewDocument([paragraph([insertion("ins-a", "X")])]),
      outcomes,
    );
    const [node2] = textNodes(editor2);
    await update(editor2, () => node2!.select(0, 1));
    const clipboard2 = mockClipboard();

    expect(editor2.dispatchCommand(COPY_COMMAND, clipboard2.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { status: "changed", value: { mode: "all-accepted" } },
    ]);
    expect(clipboard2.store.get("text/plain")).toBe("X");
    expect(clipboard2.store.get("text/html")).not.toMatch(
      /data-review|proposalId|<ins|<del/,
    );
    unregister();
  });

  it("copies deletion content only in accepted-state mode", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([deletion("del-a", "O")])]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 1));
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { code: "empty-projection", status: "refused" },
    ]);
    expect(clipboard.setData).not.toHaveBeenCalled();
    unregister();

    const editor2 = createClipboardEditor();
    const outcomes2: ReviewIntentOutcome[] = [];
    const { unregister: unregister2 } = open(
      editor2,
      reviewDocument([paragraph([deletion("del-a", "O")])]),
      outcomes2,
      { copyProjection: "accepted-state" },
    );
    const [node2] = textNodes(editor2);
    await update(editor2, () => node2!.select(0, 1));
    const clipboard2 = mockClipboard();

    expect(editor2.dispatchCommand(COPY_COMMAND, clipboard2.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes2).toMatchObject([{ status: "changed" }]);
    expect(clipboard2.store.get("text/plain")).toBe("O");
    unregister2();
  });

  it("copies replacement sides per mode", async () => {
    const doc = () =>
      reviewDocument([
        paragraph([deletion("rep-a", "old"), insertion("rep-a", "new")]),
      ]);
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(editor, doc(), outcomes);
    // New side first in document order is index 1.
    await selectAcross(editor, 1, 0, 1, 3);
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(clipboard.store.get("text/plain")).toBe("new");
    unregister();

    const editor2 = createClipboardEditor();
    const outcomes2: ReviewIntentOutcome[] = [];
    const { unregister: unregister2 } = open(editor2, doc(), outcomes2, {
      copyProjection: "accepted-state",
    });
    await selectAcross(editor2, 0, 0, 0, 3);
    const clipboard2 = mockClipboard();

    expect(editor2.dispatchCommand(COPY_COMMAND, clipboard2.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes2).toMatchObject([{ status: "changed" }]);
    expect(clipboard2.store.get("text/plain")).toBe("old");
    unregister2();
  });

  it("copies formatting text while stripping proposal wrapping", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          formattingNode("fmt-a", [text("AB", 1)], [{ format: 0, text: "AB" }]),
        ]),
      ]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 2));
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(clipboard.store.get("text/plain")).toBe("AB");
    expect(clipboard.store.get("text/html")).toBe("<p><strong>AB</strong></p>");
    expect(clipboard.store.get("text/html")).not.toMatch(
      /data-review|proposalId|review-formatting|<span/,
    );
    unregister();
  });

  it("copies mixed accepted and insertion content as one projection", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([text("A"), insertion("ins-a", "X"), text("B")]),
      ]),
      outcomes,
    );
    await selectAcross(editor, 0, 0, 2, 1);
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(clipboard.store.get("text/plain")).toBe("AXB");
    unregister();
  });

  it("refuses mixed-identity cut without touching the clipboard", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          insertion("ins-a", "X"),
          text(" "),
          insertion("ins-b", "Y"),
        ]),
      ]),
      outcomes,
    );
    await selectAcross(editor, 0, 0, 2, 1);
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { code: "unsafe-proposal-intersection", status: "refused" },
    ]);
    expect(clipboard.setData).not.toHaveBeenCalled();
    expect(clipboard.preventDefault).toHaveBeenCalled();
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("refuses cross-paragraph cut while allowing cross-paragraph copy", async () => {
    const doc = () =>
      reviewDocument([paragraph([text("A")]), paragraph([text("B")])]);
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(editor, doc(), outcomes);
    await selectAcross(editor, 0, 0, 1, 1);
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { code: "unsupported-target", status: "refused" },
    ]);
    expect(clipboard.setData).not.toHaveBeenCalled();
    unregister();

    const editor2 = createClipboardEditor();
    const outcomes2: ReviewIntentOutcome[] = [];
    const { unregister: unregister2 } = open(editor2, doc(), outcomes2);
    await selectAcross(editor2, 0, 0, 1, 1);
    const clipboard2 = mockClipboard();

    expect(editor2.dispatchCommand(COPY_COMMAND, clipboard2.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes2).toMatchObject([{ status: "changed" }]);
    expect(clipboard2.store.get("text/plain")).toBe("A\nB");
    unregister2();
  });

  it("reports empty-projection for collapsed selections without clipboard writes", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(1, 1));
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      {
        code: "empty-projection",
        mode: "all-accepted",
        projectedLength: 0,
        status: "refused",
      },
    ]);
    expect(clipboard.setData).not.toHaveBeenCalled();
    expect(clipboard.preventDefault).toHaveBeenCalled();
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("refuses copy and cut without writable clipboard data", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 1));
    const beforeDocument = editor.getEditorState().toJSON();

    expect(editor.dispatchCommand(COPY_COMMAND, null)).toBe(true);
    expect(editor.dispatchCommand(CUT_COMMAND, null)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { code: "unsupported-transfer", status: "refused" },
      { code: "unsupported-transfer", status: "refused" },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    unregister();
  });

  it("reports clipboard-write failure with state and selection preserved", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 1));
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const clipboard = mockClipboard(true);

    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { status: "failed", error: { code: "clipboard-write-failed" } },
    ]);
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });

  it("admits a dirty clipboard when the follow-up deletion cannot apply", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
      {
        proposalIdFactory: () => {
          throw new Error("Identity unavailable.");
        },
      },
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 1));
    const beforeDocument = editor.getEditorState().toJSON();
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { status: "failed", error: { code: "cut-mutation-failed-after-copy" } },
    ]);
    expect(clipboard.store.get("text/plain")).toBe("A");
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    unregister();
  });

  it("cuts accepted content and claims the gesture once across routes", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([text("AB")])]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 1));
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();
    // The deletion half of the same physical gesture claims silently.
    const dragEvent = new InputEvent("beforeinput", {
      inputType: "deleteByCut",
    });
    expect(editor.dispatchCommand(REMOVE_TEXT_COMMAND, dragEvent)).toBe(true);
    // Redispatching the claimed cut event is also silent.
    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toHaveLength(1);
    expect(outcomes).toMatchObject([
      { status: "changed", value: { mode: "all-accepted" } },
    ]);
    expect(clipboard.store.get("text/plain")).toBe("A");
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe("AB");
      const paragraphNode = $getRoot().getFirstChild();
      expect(paragraphNode?.getTextContent()).toBe("AB");
    });
    unregister();
  });

  it("cuts insertion content by correcting the proposal in place", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([paragraph([insertion("ins-a", "XY")])]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 1));
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([{ status: "changed" }]);
    expect(clipboard.store.get("text/plain")).toBe("X");
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe("Y");
    });
    unregister();
  });

  it("refuses cut over a formatting proposal without touching the clipboard", async () => {
    const editor = createClipboardEditor();
    const outcomes: ReviewIntentOutcome[] = [];
    const { unregister } = open(
      editor,
      reviewDocument([
        paragraph([
          formattingNode("fmt-a", [text("AB", 1)], [{ format: 0, text: "AB" }]),
        ]),
      ]),
      outcomes,
    );
    const [node] = textNodes(editor);
    await update(editor, () => node!.select(0, 2));
    const beforeDocument = editor.getEditorState().toJSON();
    const beforeSelection = editor.getEditorState().read(liveSelection);
    const clipboard = mockClipboard();

    expect(editor.dispatchCommand(CUT_COMMAND, clipboard.event)).toBe(true);
    await Promise.resolve();

    expect(outcomes).toMatchObject([
      { code: "unsupported-proposal-edit", status: "refused" },
    ]);
    expect(clipboard.setData).not.toHaveBeenCalled();
    expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
    expect(editor.getEditorState().read(liveSelection)).toEqual(
      beforeSelection,
    );
    unregister();
  });
});
