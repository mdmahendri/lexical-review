import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  createEditor,
  type TextNode,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $inspectReviewProposal,
  $insertReviewFragment,
  $splitReviewParagraph,
  $setReviewFormatting,
  $isReviewInsertionNode,
  $isReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewBoundaryNode,
  openReviewSession,
} from "./index";
import { registerReviewSession } from "./client";
import {
  paragraph,
  reviewDocument,
  text,
} from "./ReviewDocument.test-fixtures";

/**
 * Precedence pins for the intent-dispatch collapse.
 *
 * Each test arranges review state through public intents, then probes a
 * position where two or more kind modules could claim the selection. The
 * asserted winner documents today's implicit call order, so the refactor
 * can make that order explicit without changing it. These tests must pass
 * unchanged before and after.
 */
function setup(values = ["AB"]) {
  const editor = createEditor({
    namespace: "intent-dispatch",
    nodes: [
      ReviewFragmentNode,
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewBoundaryNode,
    ],
    onError(error) {
      throw error;
    },
  });
  const opened = openReviewSession(
    editor,
    reviewDocument(values.map((value) => paragraph([text(value)]))),
  );
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  return { editor, session: opened.value, update };
}

const id = (value: string) => ({ proposalIdFactory: () => value });

function acceptedText(index = 0) {
  return $getRoot().getAllTextNodes()[index]!;
}

function childWrappers() {
  return $getRoot()
    .getChildren()
    .filter($isElementNode)
    .flatMap((p) => p.getChildren());
}

function insertionText() {
  const wrapper = childWrappers().find($isReviewInsertionNode)!;
  return wrapper.getChildren()[0] as TextNode;
}

function deletionText() {
  const wrapper = childWrappers().find((n) => n instanceof ReviewDeletionNode)!;
  return wrapper.getChildren()[0] as TextNode;
}

function formattingText() {
  const wrapper = childWrappers().find($isReviewFormattingNode)!;
  return wrapper.getChildren()[0] as TextNode;
}

function fragmentWrappers() {
  return childWrappers().filter((n) => n instanceof ReviewFragmentNode);
}

function fragmentText(wrapperIndex = 0, childIndex = 0) {
  const wrapper = fragmentWrappers()[wrapperIndex]!;
  return wrapper.getChildren()[childIndex] as TextNode;
}

const twoParaFragment = () =>
  $insertReviewFragment(
    [
      { runs: [{ text: "X", format: 0 }] },
      { runs: [{ text: "Y", format: 0 }] },
    ],
    id("frag"),
  );

it("deletion inside a pending insertion shrinks the insertion", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    insertionText().select(1, 1);
    expect($deleteReviewText(true).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "y" } },
  });
});

it("backward deletion at the start of a pending insertion is terminal", () => {
  const { update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", id("ins")).status).toBe("changed");
    insertionText().select(0, 0);
    const outcome = $deleteReviewText(true);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("deletion-target-unavailable");
  });
});

it("deletion inside a pending deletion resolves it instead of nesting", () => {
  const { editor, update } = setup(["ABC"]);
  update(() => {
    acceptedText().select(3, 3);
    expect($deleteReviewText(true, id("del")).status).toBe("changed");
    deletionText().select(1, 1);
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    "ABC",
  );
});

it("deletion of accepted text continues an adjacent deletion under one identity", () => {
  const { editor, update } = setup(["ABC"]);
  const factory = vi.fn(() => "del");
  update(() => {
    acceptedText().select(3, 3);
    expect($deleteReviewText(true, { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    // The caret lands at the end of the surviving accepted text.
    expect($deleteReviewText(true, { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  expect(factory).toHaveBeenCalledTimes(1);
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("del"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "deletion", proposal: { proposalId: "del", text: "BC" } },
  });
});

it("backward deletion at a paragraph start proposes a merge", () => {
  const { editor, update } = setup(["AB", "CD"]);
  update(() => {
    $getRoot().getAllTextNodes()[1]!.select(0, 0);
    expect($deleteReviewText(true, id("merge")).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("merge"));
  expect(inspected.status).toBe("unchanged");
  if (inspected.status === "unchanged")
    expect(inspected.value.kind).toBe("structure");
});

it("word deletion at a paragraph start skips the structural claim", () => {
  const { update } = setup(["AB", "CD"]);
  update(() => {
    $getRoot().getAllTextNodes()[1]!.select(0, 0);
    const outcome = $deleteReviewText(true, { granularity: "word" });
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("deletion-target-unavailable");
  });
});

it("deletion inside a fragment edits the fragment without a new identity", () => {
  const { editor, update } = setup(["AB"]);
  const factory = vi.fn(() => "frag");
  update(() => {
    acceptedText().select(1, 1);
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "X", format: 0 }] },
          { runs: [{ text: "Y", format: 0 }] },
        ],
        { proposalIdFactory: factory },
      ).status,
    ).toBe("changed");
    expect(factory).toHaveBeenCalledTimes(1);
    fragmentText(0).select(1, 1);
    expect($deleteReviewText(true, { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("frag"));
  expect(inspected.status).toBe("unchanged");
  if (inspected.status === "unchanged")
    expect(inspected.value.kind).toBe("fragment");
});

it("backward deletion at a fragment edge is terminal", () => {
  const { update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    fragmentText(0).select(0, 0);
    const outcome = $deleteReviewText(true, id("other"));
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("deletion-target-unavailable");
  });
});

it("deletion inside a formatting target is refused", () => {
  const { update } = setup(["ABC"]);
  update(() => {
    acceptedText().select(0, 3);
    expect($setReviewFormatting({ bold: true }, id("fmt")).status).toBe(
      "changed",
    );
    formattingText().select(1, 1);
    const outcome = $deleteReviewText(true);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsupported-proposal-edit");
  });
});

it("forward deletion at the end of a pending insertion is terminal", () => {
  const { update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    insertionText().select(2, 2);
    const outcome = $deleteReviewText(false);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("deletion-target-unavailable");
  });
});

it("a range from fragment content into accepted text is refused up front", () => {
  const { update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    const inside = fragmentText(0);
    const outside = $getRoot()
      .getAllTextNodes()
      .find((n) => n.getTextContent() === "B")!;
    inside.select(1, 1);
    const selection = $getSelection();
    if ($isRangeSelection(selection))
      selection.focus.set(outside.getKey(), 0, "text");
    const outcome = $deleteReviewText(true);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsafe-proposal-intersection");
  });
});

it("typing inside a pending insertion extends it under one identity", () => {
  const { editor, update } = setup();
  const factory = vi.fn(() => "ins");
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    insertionText().select(1, 1);
    expect($insertReviewText("y", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  expect(factory).toHaveBeenCalledTimes(1);
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "xy" } },
  });
});

it("typing inside a pending deletion is refused", () => {
  const { update } = setup(["ABC"]);
  update(() => {
    acceptedText().select(3, 3);
    expect($deleteReviewText(true, id("del")).status).toBe("changed");
    deletionText().select(0, 0);
    const outcome = $insertReviewText("Z");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsupported-proposal-edit");
  });
});

it("typing inside a fragment edits the fragment without a new identity", () => {
  const { update } = setup(["AB"]);
  const factory = vi.fn(() => "other");
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    fragmentText(0).select(1, 1);
    expect($insertReviewText("Z", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    expect(factory).not.toHaveBeenCalled();
  });
});

it("typing in accepted text continues an adjacent insertion", () => {
  const { editor, update } = setup();
  const factory = vi.fn(() => "ins");
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    // Caret back to the accepted side, directly after the insertion.
    // Live text order is A, x (insertion), B: index 2 is the accepted B.
    acceptedText(2).select(0, 0);
    expect($insertReviewText("y", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  expect(factory).toHaveBeenCalledTimes(1);
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "xy" } },
  });
});

it("enter inside a fragment splits the fragment, not the paragraph", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    fragmentText(0).select(1, 1);
    expect($splitReviewParagraph(id("other")).status).toBe("changed");
  });
  const markers = editor
    .getEditorState()
    .read(() =>
      childWrappers().filter(
        (n) =>
          typeof (n as { getType?: () => string }).getType === "function" &&
          (n as { getType: () => string }).getType() === "review-boundary",
      ),
    );
  expect(markers).toHaveLength(0);
  expect(editor.getEditorState().read(() => fragmentWrappers().length)).toBe(3);
});

it("enter at an accepted caret proposes a paragraph split", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect($splitReviewParagraph(id("split")).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("split"));
  expect(inspected.status).toBe("unchanged");
  if (inspected.status === "unchanged")
    expect(inspected.value.kind).toBe("structure");
});

it("arrow keys enter a fragment from accepted text", () => {
  const { editor, session, update } = setup(["AB"]);
  const unregister = registerReviewSession(editor, session);
  const arrow = (backward: boolean) =>
    editor.dispatchCommand(
      backward ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND,
      {
        preventDefault() {},
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      } as unknown as KeyboardEvent,
    );
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    // Accepted caret directly before the fragment: right arrow enters it.
    const head = $getRoot()
      .getAllTextNodes()
      .find((n) => n.getTextContent() === "A")!;
    head.select(1, 1);
    expect(arrow(false)).toBe(true);
  });
  unregister();
});

it("arrow keys ignore plain accepted text and range selections", () => {
  const { editor, session, update } = setup(["AB"]);
  const unregister = registerReviewSession(editor, session);
  const arrow = (backward: boolean) =>
    editor.dispatchCommand(
      backward ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND,
      {
        preventDefault() {},
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      } as unknown as KeyboardEvent,
    );
  update(() => {
    const head = $getRoot()
      .getAllTextNodes()
      .find((n) => n.getTextContent() === "AB")!;
    head.select(0, 0);
    expect(arrow(true)).toBe(false);
    head.select(0, 1);
    expect(arrow(false)).toBe(false);
  });
  unregister();
});

it("arrow keys cross a merge marker", () => {
  const { editor, session, update } = setup(["AB", "CD"]);
  const unregister = registerReviewSession(editor, session);
  const arrow = (backward: boolean) =>
    editor.dispatchCommand(
      backward ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND,
      {
        preventDefault() {},
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      } as unknown as KeyboardEvent,
    );
  update(() => {
    $getRoot().getAllTextNodes()[1]!.select(0, 0);
    expect($deleteReviewText(true, id("merge")).status).toBe("changed");
    // The merge leaves the caret after the marker: left arrow crosses it.
    expect(arrow(true)).toBe(true);
  });
  unregister();
});

it("multiline insertion is refused without touching fragment ownership", () => {
  const { update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    const outcome = $insertReviewText("x\ny");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsupported-input");
  });
});
