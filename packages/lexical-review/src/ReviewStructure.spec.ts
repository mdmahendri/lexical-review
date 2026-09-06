import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  BEFORE_INPUT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  type ParagraphNode,
} from "lexical";
import {
  $splitReviewParagraph,
  $mergeReviewParagraph,
  $inspectReviewProposal,
  $resolveReviewProposal,
  $insertReviewText,
  $replaceReviewText,
  $deleteReviewText,
  $resolveReviewProposals,
  ReviewBoundaryNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  openReviewSession,
  validateReviewDocument,
} from "./index";
import { registerReviewSession } from "./client";
import {
  paragraph,
  text,
  reviewDocument,
  reviewNode,
} from "./ReviewDocument.test-fixtures";

function setup(paragraphs = [paragraph([text("abcdef")])]) {
  const editor = createEditor({
    nodes: [
      ReviewBoundaryNode,
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
    ],
    onError(error) {
      throw error;
    },
  });
  const input = reviewDocument(paragraphs);
  const opened = openReviewSession(editor, input);
  if (opened.status !== "valid") throw new Error(JSON.stringify(opened));
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
            ]
          : null,
      };
    });
  return { editor, input, session: opened.value, update, read, snapshot };
}
const id = (value: string) => ({ proposalIdFactory: () => value });
const paragraphs = () => $getRoot().getChildren<ParagraphNode>();
const contents = () => paragraphs().map((node) => node.getTextContent());

it.each(["accept", "reject", "remove"] as const)(
  "%s split preserves accepted formatting, non-BMP text, and round trips",
  (action) => {
    const { editor, input, session, update, read } = setup([
      paragraph([text("ab😀cd", 1)], 1),
    ]);
    const original = JSON.stringify(input);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(4, 4);
      expect($splitReviewParagraph(id("s")).status).toBe("changed");
    });
    read(() => {
      expect(contents()).toEqual(["ab😀", "cd"]);
      expect(
        $getRoot()
          .getAllTextNodes()
          .map((node) => node.getFormat()),
      ).toEqual([1, 1]);
      expect($inspectReviewProposal("s")).toMatchObject({
        value: { kind: "structure", proposal: { kind: "split" } },
      });
    });
    const saved = session.exportDocument();
    expect(saved.status).toBe("valid");
    if (saved.status !== "valid") return;
    expect(openReviewSession(editor, saved.value).status).toBe("valid");
    update(() =>
      expect($resolveReviewProposal("s", action).status).toBe("changed"),
    );
    read(() =>
      expect(contents()).toEqual(
        action === "accept" ? ["ab😀", "cd"] : ["ab😀cd"],
      ),
    );
    expect(JSON.stringify(session.exportDocument())).not.toContain(
      '"proposalId":"s"',
    );
    expect(JSON.stringify(input)).toBe(original);
  },
);

it.each(["s1", "s2"])(
  "resolves repeated splits independently: %s",
  (target) => {
    const { update, read, session } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(2, 2);
      $splitReviewParagraph(id("s1"));
    });
    update(() => {
      $getRoot().getAllTextNodes()[1]!.select(2, 2);
      $splitReviewParagraph(id("s2"));
    });
    read(() => expect(contents()).toEqual(["ab", "cd", "ef"]));
    update(() =>
      expect($resolveReviewProposal(target, "remove").status).toBe("changed"),
    );
    read(() => {
      expect(contents()).toEqual(
        target === "s1" ? ["abcd", "ef"] : ["ab", "cdef"],
      );
      expect($inspectReviewProposal(target === "s1" ? "s2" : "s1").status).toBe(
        "unchanged",
      );
    });
    expect(session.exportDocument().status).toBe("valid");
  },
);

it.each(["typing", "replacement"])(
  "rejecting split preserves subsequent %s and its selection",
  (correction) => {
    const { update, read, session } = setup([paragraph([text("Hello world")])]);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(6, 6);
      $splitReviewParagraph(id("s"));
    });
    update(() => {
      if (correction === "replacement") {
        $getRoot().getAllTextNodes()[1]!.select(0, 1);
        $replaceReviewText("W", id("t"));
      } else $insertReviewText("new ", id("t"));
    });
    update(() =>
      expect($resolveReviewProposal("s", "reject").status).toBe("changed"),
    );
    read(() => {
      expect(paragraphs()).toHaveLength(1);
      expect($getSelection()?.getNodes()[0]?.isAttached()).toBe(true);
    });
    const saved = session.exportDocument();
    expect(saved.status).toBe("valid");
    expect(JSON.stringify(saved)).toContain('"proposalId":"t"');
    update(() =>
      expect($resolveReviewProposals(["t"], "accept").status).toBe("changed"),
    );
    read(() =>
      expect(contents()).toEqual([
        correction === "replacement" ? "Hello World" : "Hello new world",
      ]),
    );
  },
);

it.each([false, true])(
  "merge retains before/after typing attachment, backward=%s",
  (backward) => {
    const { update, read, session, editor } = setup([
      paragraph([text("left", 1)], 1),
      paragraph([text("right", 2)], 2),
    ]);
    update(() => {
      if (backward) $getRoot().getAllTextNodes()[1]!.selectStart();
      else $getRoot().getAllTextNodes()[0]!.selectEnd();
      expect($mergeReviewParagraph(backward, id("m")).status).toBe("changed");
    });
    const saved = session.exportDocument();
    expect(saved.status).toBe("valid");
    if (saved.status === "valid")
      expect(openReviewSession(editor, saved.value).status).toBe("valid");
    update(() => {
      const p = paragraphs()[0]!;
      const marker = p
        .getChildren()
        .find((node) => node instanceof ReviewBoundaryNode)!;
      p.select(marker.getIndexWithinParent(), marker.getIndexWithinParent());
      expect($insertReviewText("L", id("l")).status).toBe("changed");
    });
    update(() => {
      const p = paragraphs()[0]!;
      const marker = p
        .getChildren()
        .find((node) => node instanceof ReviewBoundaryNode)!;
      p.select(
        marker.getIndexWithinParent() + 1,
        marker.getIndexWithinParent() + 1,
      );
      expect($insertReviewText("R", id("r")).status).toBe("changed");
    });
    update(() =>
      expect($resolveReviewProposal("m", "reject").status).toBe("changed"),
    );
    read(() => {
      expect(contents()).toEqual(["leftL", "Rright"]);
      expect(
        $getRoot()
          .getAllTextNodes()
          .map((node) => [node.getTextContent(), node.getFormat()]),
      ).toEqual([
        ["left", 1],
        ["L", 1],
        ["R", 2],
        ["right", 2],
      ]);
    });
    expect(session.exportDocument().status).toBe("valid");
  },
);

it("cancels exact boundaries through inverse gestures and keeps empty paragraph proposals", () => {
  const { update, read, session } = setup([paragraph([])]);
  update(() => {
    paragraphs()[0]!.selectStart();
    expect($splitReviewParagraph(id("s1")).status).toBe("changed");
  });
  update(() => expect($splitReviewParagraph(id("s2")).status).toBe("changed"));
  read(() => expect(contents()).toEqual(["", "", ""]));
  update(() => expect($deleteReviewText(true).status).toBe("changed"));
  read(() => {
    expect(contents()).toEqual(["", ""]);
    expect($inspectReviewProposal("s1").status).toBe("unchanged");
  });
  update(() => $resolveReviewProposal("s1", "accept"));
  update(() => {
    paragraphs()[1]!.selectStart();
    expect($deleteReviewText(true, id("m")).status).toBe("changed");
  });
  expect(session.exportDocument().status).toBe("valid");
  update(() => expect($splitReviewParagraph().status).toBe("changed"));
  read(() => expect(contents()).toEqual(["", ""]));
});

it.each([
  "review-insertion",
  "review-deletion",
  "review-formatting",
  "replacement",
])(
  "refuses splitting inside %s but permits a full proposal endpoint",
  (kind) => {
    const proposal =
      kind === "review-formatting"
        ? {
            ...reviewNode("review-insertion", "t", [text("word", 1)]),
            type: kind,
            accepted: [{ text: "word", format: 0 }],
          }
        : reviewNode(
            kind === "replacement"
              ? "review-deletion"
              : (kind as "review-insertion" | "review-deletion"),
            "t",
            [text("word")],
          );
    const { update, snapshot, session } = setup([
      paragraph([
        proposal,
        ...(kind === "replacement"
          ? [reviewNode("review-insertion", "t", [text("new")])]
          : []),
      ]),
    ]);
    update(() => $getRoot().getAllTextNodes()[0]!.select(2, 2));
    const before = snapshot();
    update(() => expect($splitReviewParagraph(id("s")).status).toBe("refused"));
    expect(snapshot()).toEqual(before);
    update(() => {
      $getRoot().getAllTextNodes()[0]!.selectStart();
      expect($splitReviewParagraph(id("s")).status).toBe("changed");
    });
    expect(session.exportDocument().status).toBe("valid");
  },
);

it("refuses range, surrogate-interior, duplicate identity, and chained merge requests atomically", () => {
  const { update, snapshot } = setup([
    paragraph([text("a😀b")]),
    paragraph([text("c")]),
    paragraph([text("d")]),
  ]);
  for (const [start, end] of [
    [0, 2],
    [2, 2],
  ]) {
    update(() => $getRoot().getAllTextNodes()[0]!.select(start!, end!));
    const before = snapshot();
    update(() => expect($splitReviewParagraph(id("s")).status).toBe("refused"));
    expect(snapshot()).toEqual(before);
  }
  update(() => {
    $getRoot().getAllTextNodes()[0]!.selectEnd();
    $mergeReviewParagraph(false, id("m"));
  });
  update(() => $getRoot().getAllTextNodes().at(-1)!.selectStart());
  const before = snapshot();
  update(() =>
    expect($mergeReviewParagraph(true, id("n")).status).toBe("refused"),
  );
  expect(snapshot()).toEqual(before);
  update(() => $getRoot().getAllTextNodes()[0]!.select(1, 1));
  const merged = snapshot();
  update(() => expect($splitReviewParagraph(id("s")).status).toBe("refused"));
  expect(snapshot()).toEqual(merged);
});

it.each(["root", "command", "key", "beforeinput"])(
  "authors the same split through %s and claims repeated native events once",
  (route) => {
    const { editor, session, update, read } = setup();
    const unregister = registerReviewSession(editor, session, id("s"));
    update(() => $getRoot().getAllTextNodes()[0]!.select(2, 2));
    update(() => {
      if (route === "root") $splitReviewParagraph(id("s"));
      else if (route === "command")
        editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
      else if (route === "key") {
        const event = new KeyboardEvent("keydown", {
          key: "Enter",
          cancelable: true,
        });
        editor.dispatchCommand(KEY_ENTER_COMMAND, event);
        editor.dispatchCommand(KEY_ENTER_COMMAND, event);
        expect(event.defaultPrevented).toBe(true);
      } else {
        const event = new InputEvent("beforeinput", {
          inputType: "insertParagraph",
          cancelable: true,
        });
        editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
        editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
        expect(event.defaultPrevented).toBe(true);
      }
    });
    read(() => expect(contents()).toEqual(["ab", "cdef"]));
    unregister();
  },
);

it("reconciles visible boundary markers and preserves outer review wrappers", () => {
  const { editor, update, session } = setup([
    paragraph([text("left", 1)], 1),
    paragraph([reviewNode("review-insertion", "i", [text("right", 2)])]),
  ]);
  const root = document.createElement("div");
  document.body.append(root);
  editor.setRootElement(root);
  update(() => {
    $getRoot().getAllTextNodes()[0]!.selectEnd();
    expect($mergeReviewParagraph(false, id("m")).status).toBe("changed");
  });
  expect(root.querySelectorAll("p")).toHaveLength(1);
  expect(
    root
      .querySelector('p > del[data-review-boundary="merge"]')
      ?.getAttribute("contenteditable"),
  ).toBe("false");
  expect(root.querySelector("p > ins em")?.textContent).toBe("right");
  update(() => $resolveReviewProposal("m", "reject"));
  expect(root.querySelectorAll("p")).toHaveLength(2);
  expect(root.querySelector("[data-review-boundary]")).toBeNull();
  expect(session.exportDocument().status).toBe("valid");
  editor.setRootElement(null);
  root.remove();
});

it("rejects malformed native boundary placement and identity before installing state", () => {
  const { editor, session, update } = setup();
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(2, 2);
    $splitReviewParagraph(id("s"));
  });
  const saved = session.exportDocument();
  if (saved.status !== "valid") throw new Error("Invalid snapshot");
  for (const mutate of [
    (doc: {
      root: { children: Array<{ children: Array<{ rightFormat?: number }> }> };
    }) => doc.root.children.shift(),
    (doc: {
      root: { children: Array<{ children: Array<{ rightFormat?: number }> }> };
    }) =>
      doc.root.children[1]!.children.push(doc.root.children[1]!.children[0]!),
    (doc: {
      root: { children: Array<{ children: Array<{ rightFormat?: number }> }> };
    }) => (doc.root.children[1]!.children[0]!.rightFormat = 16),
    (doc: {
      root: { children: Array<{ children: Array<{ rightFormat?: number }> }> };
    }) => doc.root.children[1]!.children.reverse(),
  ]) {
    const malformed = structuredClone(saved.value);
    mutate(malformed as unknown as Parameters<typeof mutate>[0]);
    const before = editor.getEditorState();
    expect(validateReviewDocument(malformed).status).toBe("invalid");
    expect(openReviewSession(editor, malformed).status).toBe("invalid");
    expect(editor.getEditorState()).toBe(before);
  }
});

it.each(["left", "right"] as const)(
  "empty %s merge side retains its formatting and local override",
  (side) => {
    const { update, read, session } = setup([
      paragraph([], 1),
      paragraph([], 2),
    ]);
    update(() => {
      paragraphs()[1]!.selectStart();
      $mergeReviewParagraph(true, id("m"));
    });
    update(() => {
      const p = paragraphs()[0]!;
      p.select(side === "left" ? 0 : 1, side === "left" ? 0 : 1);
      expect($insertReviewText("X", id("t")).status).toBe("changed");
    });
    read(() =>
      expect($getRoot().getAllTextNodes()[0]!.getFormat()).toBe(
        side === "left" ? 1 : 2,
      ),
    );
    update(() => $resolveReviewProposal("m", "reject"));
    read(() => {
      expect(contents()).toEqual(side === "left" ? ["X", ""] : ["", "X"]);
      expect(paragraphs().map((p) => p.getTextFormat())).toEqual([1, 2]);
    });
    expect(session.exportDocument().status).toBe("valid");
  },
);

it("keeps split placement valid when typing before its visual marker", () => {
  const { update, session, read } = setup();
  update(() => {
    $getRoot().getAllTextNodes()[0]!.selectStart();
    $splitReviewParagraph(id("s"));
  });
  update(() => {
    paragraphs()[1]!.select(0, 0);
    expect($insertReviewText("X", id("t")).status).toBe("changed");
  });
  expect(session.exportDocument().status).toBe("valid");
  read(() =>
    expect(paragraphs()[1]!.getFirstChild()).toBeInstanceOf(ReviewBoundaryNode),
  );
});

it.each(["accept", "reject"] as const)(
  "batch %s of repeated splits is independent of request order",
  (action) => {
    const { update, session, read, snapshot } = setup();
    update(() => {
      $getRoot().getAllTextNodes()[0]!.select(2, 2);
      $splitReviewParagraph(id("s1"));
    });
    update(() => {
      $getRoot().getAllTextNodes()[1]!.select(2, 2);
      $splitReviewParagraph(id("s2"));
    });
    const before = snapshot();
    update(() =>
      expect($resolveReviewProposals(["s1", "missing"], action).status).toBe(
        "refused",
      ),
    );
    expect(snapshot()).toEqual(before);
    update(() =>
      expect($resolveReviewProposals(["s2", "s1"], action).status).toBe(
        "changed",
      ),
    );
    read(() =>
      expect(contents()).toEqual(
        action === "accept" ? ["ab", "cd", "ef"] : ["abcdef"],
      ),
    );
    expect(session.exportDocument().status).toBe("valid");
  },
);

it("refuses factory failure and structural resolution during composition without mutation", () => {
  const { editor, update, snapshot } = setup();
  update(() => $getRoot().getAllTextNodes()[0]!.select(2, 2));
  const before = snapshot();
  update(() =>
    expect(
      $splitReviewParagraph({
        proposalIdFactory() {
          throw new Error("factory failed");
        },
      }).status,
    ).toBe("refused"),
  );
  expect(snapshot()).toEqual(before);
  update(() => $splitReviewParagraph(id("s")));
  const composing = vi.spyOn(editor, "isComposing").mockReturnValue(true);
  const pending = snapshot();
  update(() => {
    expect($resolveReviewProposal("s", "accept").status).toBe("refused");
    expect($splitReviewParagraph(id("s2")).status).toBe("refused");
    expect($resolveReviewProposals(["s"], "accept").status).toBe("refused");
  });
  expect(snapshot()).toEqual(pending);
  composing.mockRestore();
});

it("preserves backward text selection when rejecting a split moves its current content", () => {
  const { update, read } = setup();
  update(() => {
    $getRoot().getAllTextNodes()[0]!.select(2, 2);
    $splitReviewParagraph(id("s"));
  });
  update(() => {
    const [left, right] = $getRoot().getAllTextNodes();
    right!.select().setTextNodeRange(right!, 2, left!, 1);
    expect($resolveReviewProposal("s", "reject").status).toBe("changed");
  });
  read(() => {
    const selection = $getSelection();
    expect($isRangeSelection(selection) && selection.isBackward()).toBe(true);
    expect(selection?.getTextContent()).toBe("bcd");
  });
});

it("refuses unsupported paragraph styles and duplicate identities before moving nodes", () => {
  const { update, snapshot } = setup();
  update(() => {
    paragraphs()[0]!.setFormat("center");
    $getRoot().getAllTextNodes()[0]!.select(2, 2);
  });
  const before = snapshot();
  update(() => expect($splitReviewParagraph(id("s")).status).toBe("refused"));
  expect(snapshot()).toEqual(before);
  update(() => {
    paragraphs()[0]!.setFormat("");
    $splitReviewParagraph(id("s"));
  });
  update(() => $getRoot().getAllTextNodes().at(-1)!.select(1, 1));
  const pending = snapshot();
  update(() => expect($splitReviewParagraph(id("s")).status).toBe("refused"));
  expect(snapshot()).toEqual(pending);
});
