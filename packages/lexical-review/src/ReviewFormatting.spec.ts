import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  BEFORE_INPUT_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  FORMAT_TEXT_COMMAND,
  SET_TEXT_FORMAT_COMMAND,
  createEditor,
  type TextFormatType,
} from "lexical";
import {
  $acceptReviewFormatting,
  $rejectReviewFormatting,
  $removeReviewFormatting,
  $inspectReviewFormatting,
  $setReviewFormatting,
  $toggleReviewFormatting,
  $deleteReviewText,
  $insertReviewText,
  $resolveReviewProposals,
  ReviewFormattingNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  openReviewSession,
  validateReviewDocument,
} from "./index";
import { registerReviewSession } from "./client";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function setup(children: unknown[] = [text("before target after")]) {
  const editor = createEditor({
    namespace: "formatting",
    theme: {
      text: {
        italic: "italic",
        underline: "underline",
        bold: "bold",
        strikethrough: "strikethrough",
      },
    },
    nodes: [ReviewFormattingNode, ReviewInsertionNode, ReviewDeletionNode],
    onError(error) {
      throw error;
    },
  });
  const input = reviewDocument([
    paragraph(
      children,
      (
        children.find(
          (child) => (child as { type: string }).type === "text",
        ) as { format: number } | undefined
      )?.format ?? 0,
    ),
  ]);
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
          ? {
              anchor: [
                selection.anchor.key,
                selection.anchor.offset,
                selection.anchor.type,
              ],
              focus: [
                selection.focus.key,
                selection.focus.offset,
                selection.focus.type,
              ],
              format: selection.format,
              style: selection.style,
            }
          : null,
      };
    });
  return { editor, input, session: opened.value, update, read, snapshot };
}
const factory = () => "format-p";
const properties = ["bold", "italic", "underline", "strikethrough"] as const;

it.each(properties)(
  "authors %s through semantic, command, set, and native routes with identical saved outcomes",
  (property) => {
    const documents = [];
    for (const route of ["semantic", "command", "set", "beforeinput"]) {
      const { editor, session, input, update, read } = setup();
      const original = structuredClone(input);
      const id = vi.fn(factory);
      const unregister = registerReviewSession(editor, session, {
        proposalIdFactory: id,
      });
      update(() => $getRoot().getAllTextNodes()[0]!.select(13, 7));
      update(() => {
        if (route === "semantic")
          expect(
            $toggleReviewFormatting(property, { proposalIdFactory: id }).status,
          ).toBe("changed");
        if (route === "command")
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, property);
        if (route === "set")
          editor.dispatchCommand(SET_TEXT_FORMAT_COMMAND, { [property]: true });
        if (route === "beforeinput") {
          const names = {
            bold: "formatBold",
            italic: "formatItalic",
            underline: "formatUnderline",
            strikethrough: "formatStrikeThrough",
          };
          const event = new InputEvent("beforeinput", {
            inputType: names[property],
            cancelable: true,
          });
          editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
          editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
          expect(event.defaultPrevented).toBe(true);
        }
      });
      read(() => {
        const selection = $getSelection();
        expect($isRangeSelection(selection) && selection.isBackward()).toBe(
          true,
        );
        expect(selection?.getTextContent()).toBe("target");
        expect(
          $getRoot()
            .getAllTextNodes()
            .find((node) => node.getTextContent() === "target")
            ?.hasFormat(property),
        ).toBe(true);
      });
      expect(id).toHaveBeenCalledTimes(1);
      const saved = session.exportDocument();
      expect(saved.status).toBe("valid");
      if (saved.status === "valid") {
        documents.push(saved.value);
        const reopened = setup();
        expect(openReviewSession(reopened.editor, saved.value).status).toBe(
          "valid",
        );
        expect(
          reopened.read(() => $inspectReviewFormatting("format-p")),
        ).toEqual(read(() => $inspectReviewFormatting("format-p")));
      }
      expect(input).toEqual(original);
      unregister();
    }
    for (const doc of documents) expect(doc).toEqual(documents[0]);
  },
);

it.each([false, true])(
  "preserves mixed-run endpoints and orientation (backward=%s), retains identity across current-format edits",
  (backward) => {
    const { update, read, session } = setup([
      text("abc", 1),
      text("def", 2),
      text("ghi", 8),
    ]);
    const id = vi.fn(factory);
    update(() => {
      const [first, , last] = $getRoot().getAllTextNodes();
      const selection = first!.select();
      selection.setTextNodeRange(
        backward ? last! : first!,
        backward ? 2 : 1,
        backward ? first! : last!,
        backward ? 1 : 2,
      );
      expect(
        $setReviewFormatting(
          { underline: true, strikethrough: true },
          { proposalIdFactory: id },
        ).status,
      ).toBe("changed");
    });
    read(() => {
      const selection = $getSelection();
      expect(selection?.getTextContent()).toBe("bcdefgh");
      expect($isRangeSelection(selection) && selection.isBackward()).toBe(
        backward,
      );
      expect($inspectReviewFormatting("format-p")).toMatchObject({
        value: {
          accepted: [
            { text: "bc", format: 1 },
            { text: "def", format: 2 },
            { text: "gh", format: 8 },
          ],
          current: [
            { text: "bc", format: 13 },
            { text: "def", format: 14 },
            { text: "gh", format: 12 },
          ],
        },
      });
    });
    update(() => {
      $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === "def")!
        .select(1, 2);
      expect(
        $setReviewFormatting({ italic: false }, { proposalIdFactory: id })
          .status,
      ).toBe("changed");
    });
    expect(id).toHaveBeenCalledTimes(1);
    expect(session.exportDocument().status).toBe("valid");
    update(() =>
      expect($rejectReviewFormatting("format-p").status).toBe("changed"),
    );
    read(() => {
      expect(
        $getRoot()
          .getAllTextNodes()
          .map((node) => [node.getTextContent(), node.getFormat()]),
      ).toEqual([
        ["abc", 1],
        ["def", 2],
        ["ghi", 8],
      ]);
      expect($getSelection()?.getTextContent()).toBe("e");
    });
  },
);

it("detects no-ops before splitting or allocating identity and removes fully reverted pending work", () => {
  const { update, snapshot, read } = setup([text("bold", 1)]);
  const id = vi.fn(factory);
  update(() => $getRoot().getAllTextNodes()[0]!.select(1, 3));
  const before = snapshot();
  update(() =>
    expect(
      $setReviewFormatting({ bold: true }, { proposalIdFactory: id }).status,
    ).toBe("unchanged"),
  );
  expect(snapshot()).toEqual(before);
  expect(id).not.toHaveBeenCalled();
  update(() =>
    expect(
      $setReviewFormatting({ bold: false }, { proposalIdFactory: id }).status,
    ).toBe("changed"),
  );
  update(() =>
    expect($setReviewFormatting({ bold: true }).status).toBe("changed"),
  );
  read(() => {
    expect(
      $getRoot()
        .getAllTextNodes()
        .map((node) => [node.getTextContent(), node.getFormat()]),
    ).toEqual([["bold", 1]]);
    expect($getSelection()?.getTextContent()).toBe("ol");
    expect($inspectReviewFormatting("format-p").status).toBe("refused");
  });
});

it.each([
  $acceptReviewFormatting,
  $rejectReviewFormatting,
  $removeReviewFormatting,
])(
  "resolves current formatting with %s and keeps no terminal history",
  (operation) => {
    const { update, read, session } = setup([text("target")]);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(0, 6);
      $setReviewFormatting({ bold: true }, { proposalIdFactory: factory });
    });
    update(() => $setReviewFormatting({ italic: true, underline: true }));
    update(() => expect(operation("format-p").status).toBe("changed"));
    read(() => {
      expect($getRoot().getAllTextNodes()[0]!.getFormat()).toBe(
        operation === $acceptReviewFormatting ? 11 : 0,
      );
      expect($inspectReviewFormatting("format-p").status).toBe("refused");
    });
    expect(JSON.stringify(session.exportDocument())).not.toContain("format-p");
  },
);

it.each(["insertion", "replacement", "deletion"])(
  "formats the supported current side of %s without a second identity",
  (kind) => {
    const old = reviewNode("review-deletion", "p", [text("old")]);
    const inserted = reviewNode("review-insertion", "p", [text("new")]);
    const { update, read, snapshot, session } = setup(
      kind === "replacement"
        ? [old, inserted]
        : [kind === "deletion" ? old : inserted],
    );
    const id = vi.fn(factory);
    update(() => $getRoot().getAllTextNodes().at(-1)!.select(2, 1));
    const before = snapshot();
    update(() =>
      expect(
        $setReviewFormatting({ bold: true }, { proposalIdFactory: id }).status,
      ).toBe(kind === "deletion" ? "refused" : "changed"),
    );
    expect(id).not.toHaveBeenCalled();
    if (kind === "deletion") expect(snapshot()).toEqual(before);
    else
      read(() =>
        expect(
          $getRoot()
            .getAllTextNodes()
            .find((node) => node.getTextContent() === "e")!
            .hasFormat("bold"),
        ).toBe(true),
      );
    expect(session.exportDocument().status).toBe("valid");
  },
);

it("refuses formatting across accepted/proposal sides, identities, paragraphs, and unsupported properties without mutation", () => {
  const { editor, session, update, snapshot } = setup([
    text("accepted"),
    reviewNode("review-insertion", "p", [text("new")]),
    reviewNode("review-insertion", "q", [text("other")]),
  ]);
  const unregister = registerReviewSession(editor, session);
  const refused = (operation: () => void) => {
    const before = snapshot();
    update(operation);
    expect(snapshot()).toEqual(before);
  };
  for (const indices of [
    [0, 1],
    [1, 2],
  ]) {
    update(() => {
      const nodes = $getRoot().getAllTextNodes();
      nodes[indices[0]!]!.select().setTextNodeRange(
        nodes[indices[0]!]!,
        1,
        nodes[indices[1]!]!,
        2,
      );
    });
    refused(() =>
      expect($toggleReviewFormatting("bold").status).toBe("refused"),
    );
  }
  update(() => {
    const first = $getRoot().getAllTextNodes()[0]!;
    const last = $createTextNode("paragraph");
    $getRoot().append($createParagraphNode().append(last));
    first.select().setTextNodeRange(first, 1, last, 2);
  });
  refused(() => expect($toggleReviewFormatting("bold").status).toBe("refused"));
  update(() => $getRoot().getAllTextNodes()[0]!.select(1, 3));
  for (const property of ["code", "subscript", "highlight"])
    refused(() =>
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, property as TextFormatType),
    );
  refused(() =>
    editor.dispatchCommand(SET_TEXT_FORMAT_COMMAND, { bold: true, code: true }),
  );
  refused(() =>
    editor.dispatchCommand(
      BEFORE_INPUT_COMMAND,
      new InputEvent("beforeinput", { inputType: "formatSuperscript" }),
    ),
  );
  unregister();
});

it("refuses text edits on pending formatting and validates batch resolution before any mutation", () => {
  const { update, snapshot, read } = setup([text("target")]);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 6);
    $toggleReviewFormatting("bold", { proposalIdFactory: factory });
  });
  for (const collapsed of [false, true]) {
    update(() =>
      $getRoot()
        .getAllTextNodes()[0]!
        .select(1, collapsed ? 1 : 3),
    );
    const before = snapshot();
    update(() => {
      expect($insertReviewText("x").status).toBe("refused");
      expect($deleteReviewText(false).status).toBe("refused");
    });
    expect(snapshot()).toEqual(before);
  }
  const before = snapshot();
  update(() =>
    expect(
      $resolveReviewProposals(["format-p", "missing"], "accept").status,
    ).toBe("refused"),
  );
  expect(snapshot()).toEqual(before);
  update(() =>
    expect($resolveReviewProposals(["format-p"], "accept").status).toBe(
      "changed",
    ),
  );
  read(() =>
    expect($getRoot().getAllTextNodes()[0]!.hasFormat("bold")).toBe(true),
  );
});

it.each(["accepted", "insertion", "replacement"])(
  "collapsed formatting affects future input only at %s, and movement recomputes formatting",
  async (kind) => {
    const inserted = reviewNode("review-insertion", "p", [text("new")]);
    const children =
      kind === "accepted"
        ? [text("plain")]
        : kind === "insertion"
          ? [inserted]
          : [reviewNode("review-deletion", "p", [text("old")]), inserted];
    const { editor, update, snapshot, read, session } = setup([
      ...children,
      text("bold", 1),
    ]);
    const id = vi.fn(factory);
    const unregister = registerReviewSession(editor, session, {
      proposalIdFactory: id,
    });
    update(() =>
      $getRoot()
        .getAllTextNodes()
        [kind === "replacement" ? 1 : 0]!.select(1, 1),
    );
    const before = snapshot().document;
    update(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"));
    expect(snapshot().document).toEqual(before);
    expect(id).not.toHaveBeenCalled();
    update(() =>
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "X"),
    );
    read(() =>
      expect(
        $getRoot()
          .getAllTextNodes()
          .find((node) => node.getTextContent() === "X")
          ?.getFormat(),
      ).toBe(2),
    );
    update(() => $getRoot().getAllTextNodes().at(-1)!.select(1, 1));
    await Promise.resolve();
    read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection) && selection.format).toBe(1);
    });
    unregister();
  },
);

it("reconciles formatting within proposal wrappers and exports DOM without reversing ins/del nesting", () => {
  const { editor, session, update } = setup([
    text("accepted"),
    reviewNode("review-deletion", "d", [text("old", 1)]),
    reviewNode("review-insertion", "i", [text("new")]),
  ]);
  const root = document.createElement("div");
  document.body.append(root);
  editor.setRootElement(root);
  const unregister = registerReviewSession(editor, session);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 8);
    $setReviewFormatting(
      { bold: true, italic: true },
      { proposalIdFactory: factory },
    );
  });
  update(() => {
    $getRoot().getAllTextNodes().at(-1)!.select(0, 3);
    $setReviewFormatting({ italic: true, underline: true });
  });
  expect(
    root.querySelector("p > [data-review-formatting] strong")?.textContent,
  ).toBe("accepted");
  expect(
    root.querySelector("p > [data-review-formatting] strong.italic")
      ?.textContent,
  ).toBe("accepted");
  expect(root.querySelector("p > del strong")?.textContent).toBe("old");
  expect(root.querySelector("p > ins em")?.textContent).toBe("new");
  expect(root.querySelector("strong > ins, em > ins, strong > del")).toBeNull();
  update(() => $rejectReviewFormatting("format-p"));
  expect(root.querySelector("[data-review-formatting]")).toBeNull();
  unregister();
  editor.setRootElement(null);
  root.remove();
});

it("rejects malformed native formatting baselines and identities before installing state", () => {
  const { editor, session, update } = setup([text("target")]);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 6);
    $toggleReviewFormatting("bold", { proposalIdFactory: factory });
  });
  const saved = session.exportDocument();
  if (saved.status !== "valid")
    throw new Error("Expected valid formatting document");
  for (const accepted of [
    [{ text: "wrong", format: 0 }],
    [{ text: "target", format: 16 }],
    [],
  ]) {
    const malformed = structuredClone(saved.value) as unknown as {
      root: { children: Array<{ children: Array<{ accepted: unknown }> }> };
    };
    malformed.root.children[0]!.children[0]!.accepted = accepted;
    const before = editor.getEditorState();
    expect(validateReviewDocument(malformed).status).toBe("invalid");
    expect(openReviewSession(editor, malformed).status).toBe("invalid");
    expect(editor.getEditorState()).toBe(before);
  }
});

it("keeps a toggle performed in the same update as caret movement and creates correctly formatted native insertion", () => {
  const { editor, session, update, read } = setup([text("plain")]);
  const unregister = registerReviewSession(editor, session, {
    proposalIdFactory: factory,
  });
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(2, 2);
    $toggleReviewFormatting("bold");
  });
  update(() => {
    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "X",
      cancelable: true,
    });
    editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
    editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
    expect(event.defaultPrevented).toBe(true);
  });
  read(() => {
    expect($getRoot().getTextContent()).toBe("plXain");
    expect($getRoot().getAllTextNodes()[1]!.getFormat()).toBe(1);
  });
  unregister();
});

it("refuses invalid identity, missing registration, and ambiguous boundaries without splitting the target", () => {
  const { update, snapshot } = setup([
    text("left"),
    reviewNode("review-insertion", "p", [text("inserted")]),
    text("right"),
  ]);
  update(() => $getRoot().getAllTextNodes()[0]!.select(1, 3));
  const before = snapshot();
  update(() =>
    expect(
      $setReviewFormatting({ bold: true }, { proposalIdFactory: () => " " })
        .status,
    ).toBe("refused"),
  );
  expect(snapshot()).toEqual(before);
  update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if ($isElementNode(paragraph)) paragraph.select(1, 1);
  });
  const boundary = snapshot();
  update(() => expect($toggleReviewFormatting("bold").status).toBe("refused"));
  expect(snapshot()).toEqual(boundary);

  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      const node = $createTextNode("text");
      $getRoot().append($createParagraphNode().append(node));
      node.select(1, 3);
    },
    { discrete: true },
  );
  const document = editor.getEditorState().toJSON();
  editor.update(
    () => expect($toggleReviewFormatting("bold").status).toBe("refused"),
    { discrete: true },
  );
  expect(editor.getEditorState().toJSON()).toEqual(document);
});

it("compares native accepted/current runs by content regardless of JSON field order", () => {
  const { editor, session, update, read } = setup([text("target")]);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 6);
    $toggleReviewFormatting("bold", { proposalIdFactory: factory });
  });
  const saved = session.exportDocument();
  if (saved.status !== "valid") throw new Error("Invalid document");
  const input = JSON.parse(JSON.stringify(saved.value));
  input.root.children[0].children[0].accepted = [{ format: 0, text: "target" }];
  expect(openReviewSession(editor, input).status).toBe("valid");
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 6);
    $toggleReviewFormatting("bold");
  });
  read(() =>
    expect($inspectReviewFormatting("format-p").status).toBe("refused"),
  );
});
