import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $isTextNode,
  createEditor,
  DELETE_WORD_COMMAND,
  BEFORE_INPUT_COMMAND,
  REMOVE_TEXT_COMMAND,
} from "lexical";
import {
  $deleteReviewText,
  $inspectReviewDeletion,
  $acceptReviewDeletion,
  $rejectReviewDeletion,
  $removeReviewDeletion,
  ReviewDeletionNode,
  ReviewInsertionNode,
  openReviewSession,
} from "./index";
import { registerReviewSession } from "./client";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function setup(children: unknown[] = [text("one two three")]) {
  const editor = createEditor({
    namespace: "deletion",
    nodes: [ReviewDeletionNode, ReviewInsertionNode],
    onError: (error) => {
      throw error;
    },
  });
  const input = reviewDocument([
    paragraph(
      children,
      typeof (children[0] as { format?: unknown })?.format === "number"
        ? (children[0] as { format: number }).format
        : 0,
    ),
  ]);
  const opened = openReviewSession(editor, input);
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  const factory = vi.fn(() => "deletion-1");
  const unregister = registerReviewSession(editor, opened.value, {
    proposalIdFactory: factory,
  });
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  const inspect = () =>
    editor.getEditorState().read(() => $inspectReviewDeletion("deletion-1"));
  return {
    editor,
    input,
    session: opened.value,
    factory,
    unregister,
    update,
    inspect,
  };
}

it.each([false, true])(
  "continues character, word, and range deletion in document order (backward=%s)",
  (backward) => {
    const { update, inspect, factory, unregister } = setup([text("abcdef")]);
    update(() => {
      $getRoot()
        .getAllTextNodes()[0]!
        .select(backward ? 6 : 0, backward ? 6 : 0);
      expect(
        $deleteReviewText(backward, { proposalIdFactory: factory }).status,
      ).toBe("changed");
    });
    update(() =>
      expect(
        $deleteReviewText(backward, { proposalIdFactory: factory }).status,
      ).toBe("changed"),
    );
    expect(inspect()).toMatchObject({
      value: { text: backward ? "ef" : "ab" },
    });
    update(() => {
      const accepted = $getRoot()
        .getAllTextNodes()
        .find(
          (node) =>
            $isElementNode(node.getParent()) &&
            node.getParent()!.getType() === "paragraph",
        )!;
      accepted.select(backward ? 2 : 0, backward ? 4 : 2);
      expect(
        $deleteReviewText(backward, { proposalIdFactory: factory }).status,
      ).toBe("changed");
    });
    expect(inspect()).toMatchObject({
      value: { text: backward ? "cdef" : "abcd" },
    });
    update(() =>
      expect(
        $deleteReviewText(backward, {
          granularity: "word",
          proposalIdFactory: factory,
        }).status,
      ).toBe("changed"),
    );
    expect(inspect()).toMatchObject({ value: { text: "abcdef" } });
    expect(factory).toHaveBeenCalledTimes(1);
    unregister();
  },
);

it.each([false, true])(
  "deletes words across formatting without crossing a proposal (backward=%s)",
  (backward) => {
    const { update, inspect, editor, unregister } = setup([
      text("one "),
      text("two", 1),
      text(" three"),
    ]);
    update(() => {
      const nodes = $getRoot().getAllTextNodes();
      if (backward) nodes.at(-1)!.selectEnd();
      else nodes[0]!.selectStart();
      editor.dispatchCommand(DELETE_WORD_COMMAND, backward);
    });
    expect(inspect()).toMatchObject({
      value: { text: backward ? "three" : "one" },
    });
    update(() => editor.dispatchCommand(DELETE_WORD_COMMAND, backward));
    expect(inspect()).toMatchObject({
      value: { text: backward ? "two three" : "one two" },
    });
    unregister();
  },
);

it.each(["accept", "reject", "remove"] as const)(
  "%s operates on current nodes and round-trips without terminal records",
  (action) => {
    const { update, session, input, inspect, factory, unregister } = setup([
      text("AB", 1),
    ]);
    const original = JSON.stringify(input);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 2);
      $deleteReviewText(false, { proposalIdFactory: factory });
    });
    const saved = session.exportDocument();
    const reopenedEditor = createEditor({
      nodes: [ReviewDeletionNode, ReviewInsertionNode],
      onError: (error) => {
        throw error;
      },
    });
    expect(
      openReviewSession(
        reopenedEditor,
        saved.status === "valid" ? saved.value : null,
      ).status,
    ).toBe("valid");
    expect(
      reopenedEditor
        .getEditorState()
        .read(() => $inspectReviewDeletion("deletion-1")),
    ).toEqual(inspect());
    update(() => {
      const operation = {
        accept: $acceptReviewDeletion,
        reject: $rejectReviewDeletion,
        remove: $removeReviewDeletion,
      }[action];
      expect(operation("deletion-1").status).toBe("changed");
      expect($getRoot().getTextContent()).toBe(action === "accept" ? "" : "AB");
      expect(
        $getRoot()
          .getAllTextNodes()
          .every((node) => $isTextNode(node) && node.getFormat() === 1),
      ).toBe(true);
    });
    expect(JSON.stringify(session.exportDocument())).not.toContain(
      "deletion-1",
    );
    expect(JSON.stringify(input)).toBe(original);
    unregister();
  },
);

it("restores the whole deletion from a nonempty local range without deleting accepted text", () => {
  const { update, inspect, editor, unregister } = setup([
    reviewNode("review-deletion", "deletion-1", [text("AB", 1), text("CD", 2)]),
  ]);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 1);
    editor.dispatchCommand(REMOVE_TEXT_COMMAND, null);
    expect($getRoot().getTextContent()).toBe("ABCD");
    expect(
      $getRoot()
        .getAllTextNodes()
        .map((node) => node.getFormat()),
    ).toEqual([1, 2]);
  });
  expect(inspect().status).toBe("refused");
  unregister();
});

it("refuses cross-paragraph ranges with exact selection and document preservation", () => {
  const { update, editor, session, unregister } = setup();
  const other = editor.parseEditorState(
    JSON.stringify(
      reviewDocument([paragraph([text("A")]), paragraph([text("B")])]),
    ),
  );
  editor.setEditorState(other);
  update(() => {
    const [first, last] = $getRoot().getAllTextNodes();
    const selection = first!.select(0, 0);
    selection.focus.set(last!.getKey(), 1, "text");
  });
  const before = session.exportDocument();
  const selectionBefore = editor
    .getEditorState()
    .read(() => $getSelection()?.clone());
  update(() => expect($deleteReviewText(false).status).toBe("refused"));
  expect(session.exportDocument()).toEqual(before);
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    expect($isRangeSelection(selection)).toBe(true);
    expect(selection?.is(selectionBefore ?? null)).toBe(true);
  });
  unregister();
});

it("handles each native event once while allowing separate word events to continue", () => {
  const { update, editor, inspect, unregister } = setup();
  update(() => $getRoot().getAllTextNodes()[0]!.selectStart());
  const event = new InputEvent("beforeinput", {
    inputType: "deleteWordForward",
    cancelable: true,
  });
  update(() => {
    editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
    editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(inspect()).toMatchObject({ value: { text: "one" } });
  update(() =>
    editor.dispatchCommand(
      BEFORE_INPUT_COMMAND,
      new InputEvent("beforeinput", {
        inputType: "deleteWordForward",
        cancelable: true,
      }),
    ),
  );
  expect(inspect()).toMatchObject({ value: { text: "one two" } });
  unregister();
});
