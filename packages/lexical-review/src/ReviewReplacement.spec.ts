import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  DELETE_CHARACTER_COMMAND,
  createEditor,
} from "lexical";
import {
  $acceptReviewDeletion,
  $acceptReviewInsertion,
  $acceptReviewReplacement,
  $createReviewInsertionNode,
  $deleteReviewText,
  $inspectReviewReplacement,
  $insertReviewText,
  $rejectReviewDeletion,
  $rejectReviewInsertion,
  $rejectReviewReplacement,
  $removeReviewReplacement,
  $replaceReviewText,
  $resolveReviewProposals,
  openReviewSession,
  ReviewDeletionNode,
  ReviewInsertionNode,
  validateReviewDocument,
} from "./index";
import { registerReviewSession } from "./client";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

const oldSide = (value = "old", id = "p", format = 0) =>
  reviewNode("review-deletion", id, [text(value, format)]);
const newSide = (value = "new", id = "p", format = 0) =>
  reviewNode("review-insertion", id, [text(value, format)]);
function setup(children: unknown[] = [oldSide(), newSide()]) {
  const editor = createEditor({
    namespace: "replacement",
    nodes: [ReviewInsertionNode, ReviewDeletionNode],
    onError: (error) => {
      throw error;
    },
  });
  const input = reviewDocument([paragraph(children)]);
  const original = structuredClone(input);
  const opened = openReviewSession(editor, input);
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  const read = <T>(fn: () => T) => editor.getEditorState().read(fn);
  const snapshot = () =>
    read(() => {
      const selection = $getSelection();
      return {
        document: editor.getEditorState().toJSON(),
        selection: $isRangeSelection(selection)
          ? [
              selection.anchor.key,
              selection.anchor.offset,
              selection.anchor.type,
              selection.focus.key,
              selection.focus.offset,
              selection.focus.type,
              selection.format,
              selection.style,
            ]
          : null,
      };
    });
  return {
    editor,
    input,
    original,
    session: opened.value,
    update,
    read,
    snapshot,
  };
}

it.each(["semantic", "string", "input-event"])(
  "creates and corrects one replacement via %s, saves without mutating input",
  (route) => {
    const { editor, input, original, session, update, read } = setup([
      text("before old after"),
    ]);
    const factory = vi.fn(() => "p");
    const unregister = registerReviewSession(editor, session, {
      proposalIdFactory: factory,
    });
    update(() => $getRoot().getAllTextNodes()[0]!.select(10, 7));
    update(() => {
      if (route === "semantic")
        expect(
          $insertReviewText("new", { proposalIdFactory: factory }).status,
        ).toBe("changed");
      else
        editor.dispatchCommand(
          CONTROLLED_TEXT_INSERTION_COMMAND,
          route === "string"
            ? "new"
            : new InputEvent("beforeinput", {
                inputType: "insertReplacementText",
                data: "new",
              }),
        );
    });
    expect(read(() => $inspectReviewReplacement("p"))).toMatchObject({
      value: { proposalId: "p", oldText: "old", newText: "new" },
    });
    update(() => {
      expect($insertReviewText("!").status).toBe("changed");
    });
    update(() => {
      $getRoot().getAllTextNodes()[2]!.select(0, 3);
      expect($insertReviewText("corrected").status).toBe("changed");
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(read(() => $inspectReviewReplacement("p"))).toMatchObject({
      value: { oldText: "old", newText: "corrected!" },
    });
    expect(
      read(() => {
        const s = $getSelection();
        return $isRangeSelection(s) ? s.anchor.offset : null;
      }),
    ).toBe(9);
    const saved = session.exportDocument();
    expect(saved.status).toBe("valid");
    if (saved.status === "valid") {
      const reopened = setup([]);
      expect(openReviewSession(reopened.editor, saved.value).status).toBe(
        "valid",
      );
      expect(reopened.read(() => $inspectReviewReplacement("p"))).toEqual(
        read(() => $inspectReviewReplacement("p")),
      );
      expect(Object.isFrozen(saved.value.root.children)).toBe(true);
    }
    expect(input).toEqual(original);
    unregister();
  },
);

it.each([
  [$acceptReviewReplacement, "new"],
  [$acceptReviewInsertion, "new"],
  [$acceptReviewDeletion, "new"],
  [$rejectReviewReplacement, "old"],
  [$rejectReviewInsertion, "old"],
  [$rejectReviewDeletion, "old"],
  [$removeReviewReplacement, "old"],
] as const)("resolves both sides atomically via %s", (resolve, expected) => {
  const { update, read, session } = setup();
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(1, 2);
    expect(resolve("p").status).toBe("changed");
  });
  expect(read(() => $getRoot().getTextContent())).toBe(expected);
  expect(
    read(() =>
      $getRoot()
        .getAllTextNodes()
        .every((node) => node.getParent()?.getType() === "paragraph"),
    ),
  ).toBe(true);
  expect(read(() => $inspectReviewReplacement("p").status)).toBe("refused");
  expect(session.exportDocument().status).toBe("valid");
});

it.each([
  "old-range",
  "old-backspace",
  "old-delete",
  "new-range",
  "new-backspace",
  "new-delete",
  "empty-correction",
  "accepted-boundary",
])("cancels the entire replacement on %s", (route) => {
  const { update, read, editor, session } = setup([
    text("A"),
    oldSide(),
    newSide("x"),
  ]);
  const unregister = registerReviewSession(editor, session);
  update(() => {
    const nodes = $getRoot().getAllTextNodes();
    if (route === "accepted-boundary") nodes[0]!.selectEnd();
    else if (route.startsWith("old"))
      nodes[1]!.select(
        route === "old-delete" ? 0 : 1,
        route === "old-range" ? 2 : route === "old-delete" ? 0 : 1,
      );
    else
      nodes[2]!.select(
        route === "new-backspace" ? 1 : 0,
        route === "new-range" || route === "empty-correction"
          ? 1
          : route === "new-backspace"
            ? 1
            : 0,
      );
    if (route === "empty-correction")
      expect($replaceReviewText("").status).toBe("changed");
    else
      editor.dispatchCommand(
        DELETE_CHARACTER_COMMAND,
        route.endsWith("backspace"),
      );
  });
  expect(read(() => $getRoot().getTextContent())).toBe("Aold");
  expect(read(() => $inspectReviewReplacement("p").status)).toBe("refused");
  expect(session.exportDocument().status).toBe("valid");
  unregister();
});

it("corrects split formatted sides, retaining replacement kind until all new content is removed", () => {
  const { update, read } = setup([
    oldSide("o"),
    oldSide("ld", "p", 1),
    newSide("n"),
    newSide("ew", "p", 1),
  ]);
  update(() => {
    $getRoot().getAllTextNodes()[2]!.select(0, 1);
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(read(() => $inspectReviewReplacement("p"))).toMatchObject({
    value: { oldText: "old", newText: "ew" },
  });
  update(() => {
    $getRoot().getAllTextNodes().at(-1)!.select(0, 2);
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(read(() => $getRoot().getTextContent())).toBe("old");
});

it.each([
  "old-typing",
  "old-replace",
  "both-sides",
  "other-proposal",
  "cross-paragraph",
  "fragment",
  "ambiguous",
])("refuses %s without document or selection mutation", (route) => {
  const { update, snapshot } = setup([
    text("A"),
    oldSide(),
    newSide(),
    newSide("other", "q"),
  ]);
  update(() => {
    const nodes = $getRoot().getAllTextNodes();
    const selection = nodes[1]!.select(1, route === "old-typing" ? 1 : 2);
    if (route === "both-sides")
      selection.focus.set(nodes[2]!.getKey(), 2, "text");
    if (route === "other-proposal") {
      selection.anchor.set(nodes[2]!.getKey(), 0, "text");
      selection.focus.set(nodes[3]!.getKey(), 1, "text");
    }
    if (route === "cross-paragraph") {
      const next = $createTextNode("next");
      $getRoot().append($createParagraphNode().append(next));
      selection.anchor.set(nodes[0]!.getKey(), 0, "text");
      selection.focus.set(next.getKey(), 2, "text");
    }
    if (route === "ambiguous") {
      const paragraph = $getRoot().getFirstChildOrThrow();
      if (!$isElementNode(paragraph)) throw new Error("Expected a paragraph");
      paragraph.select(1, 1);
    }
    if (route === "fragment") nodes[2]!.select(1, 1);
  });
  const before = snapshot();
  update(() => {
    expect($insertReviewText(route === "fragment" ? "x\ny" : "x").status).toBe(
      "refused",
    );
  });
  expect(snapshot()).toEqual(before);
});

it.each(
  [
    [newSide(), oldSide()],
    [oldSide(), text("accepted"), newSide()],
    [oldSide(), newSide(), oldSide()],
    [oldSide(), newSide("other", "q"), newSide()],
    [oldSide(), reviewNode("review-insertion", "p", [])],
    [oldSide(), reviewNode("review-insertion", "p", [newSide()])],
  ].map((children) => ({ children })),
)("rejects invalid serialized group %#", ({ children }) => {
  expect(
    validateReviewDocument(reviewDocument([paragraph(children)])).status,
  ).toBe("invalid");
});
it("rejects cross-paragraph shared identity", () => {
  expect(
    validateReviewDocument(
      reviewDocument([paragraph([oldSide()]), paragraph([newSide()])]),
    ).status,
  ).toBe("invalid");
});

it("refuses editing, resolution, and batch resolution of an ambiguous live group without mutation", () => {
  const { update, snapshot } = setup();
  update(() => {
    $getRoot().append(
      $createParagraphNode().append(
        $createReviewInsertionNode("p").append($createTextNode("duplicate")),
      ),
    );
    $getRoot().getAllTextNodes()[1]!.select(1, 1);
  });
  const before = snapshot();
  update(() => {
    expect($insertReviewText("x").status).toBe("refused");
    expect($deleteReviewText(true).status).toBe("refused");
    expect($acceptReviewReplacement("p").status).toBe("refused");
    expect($resolveReviewProposals(["p"], "accept").status).toBe("refused");
  });
  expect(snapshot()).toEqual(before);
});

it.each(["accept", "reject", "remove"] as const)(
  "batch %s resolves shared IDs once alongside independent proposals",
  (action) => {
    const { update, read, snapshot } = setup([
      oldSide(),
      newSide(),
      newSide("!", "q"),
    ]);
    const before = snapshot();
    update(() => {
      expect($resolveReviewProposals(["p", "missing"], action).status).toBe(
        "refused",
      );
    });
    expect(snapshot()).toEqual(before);
    update(() => {
      expect($resolveReviewProposals(["p", "q", "p"], action).status).toBe(
        "changed",
      );
    });
    expect(read(() => $getRoot().getTextContent())).toBe(
      action === "accept" ? "new!" : "old",
    );
  },
);

it("reconciles formatted replacement wrappers and atomic acceptance in the DOM", () => {
  const { editor, update, session } = setup([
    oldSide("old", "p", 1),
    newSide("new", "p", 2),
  ]);
  const root = document.createElement("div");
  document.body.append(root);
  editor.setRootElement(root);
  expect(root.querySelector("p > del strong")?.textContent).toBe("old");
  expect(root.querySelector("p > ins em")?.textContent).toBe("new");
  update(() => {
    $getRoot().getAllTextNodes()[1]!.selectEnd();
    expect($insertReviewText("!").status).toBe("changed");
  });
  expect(root.querySelector("p > ins em")?.textContent).toBe("new!");
  update(() => {
    expect($acceptReviewReplacement("p").status).toBe("changed");
  });
  expect(root.querySelectorAll("ins,del")).toHaveLength(0);
  expect(root.querySelector("em")?.textContent).toBe("new!");
  expect(session.exportDocument().status).toBe("valid");
  editor.setRootElement(null);
  root.remove();
});

it("empty controlled replacement input cancels a replacement and uses deletion semantics for accepted text", () => {
  const { editor, session, update, read } = setup();
  const unregister = registerReviewSession(editor, session, {
    proposalIdFactory: () => "deletion",
  });
  const empty = () =>
    editor.dispatchCommand(
      CONTROLLED_TEXT_INSERTION_COMMAND,
      new InputEvent("beforeinput", {
        inputType: "insertReplacementText",
        data: "",
      }),
    );
  update(() => {
    $getRoot().getAllTextNodes()[1]!.select(0, 3);
    empty();
  });
  expect(read(() => $getRoot().getTextContent())).toBe("old");
  expect(read(() => $inspectReviewReplacement("p").status)).toBe("refused");
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 3);
    empty();
  });
  expect(
    read(() => $getRoot().getAllTextNodes()[0]!.getParent()?.getType()),
  ).toBe("review-deletion");
  expect(session.exportDocument().status).toBe("valid");
  unregister();
});
