import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ParagraphNode,
  type TextNode,
} from "lexical";
import {
  $insertReviewFragment,
  $inspectReviewProposal,
  $resolveReviewProposal,
  $insertReviewText,
  $deleteReviewText,
  $replaceReviewText,
  $splitReviewParagraph,
  $resolveReviewProposals,
  $setReviewFormatting,
  ReviewFragmentNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewBoundaryNode,
  openReviewSession,
  validateReviewDocument,
  createReviewPreview,
} from "./index";
import {
  INSERT_REVIEW_FRAGMENT_COMMAND,
  registerReviewSession,
} from "./client";
import {
  paragraph,
  text,
  reviewDocument,
} from "./ReviewDocument.test-fixtures";

const id = (value: string) => ({ proposalIdFactory: () => value });
const fragment = (value: string, format = 0) =>
  value.split("\n").map((text) => ({
    runs: text ? [{ text, format }] : [],
    emptyFormat: format,
  }));
const contents = () =>
  $getRoot()
    .getChildren()
    .map((p) => p.getTextContent());
const parts = () =>
  $getRoot()
    .getChildren<ParagraphNode>()
    .flatMap((p) =>
      p.getChildren().filter((n) => n instanceof ReviewFragmentNode),
    );
function setup(values = ["AB"]) {
  const editor = createEditor({
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
  const input = reviewDocument(
    values.map((value) => paragraph(value ? [text(value)] : [])),
  );
  const opened = openReviewSession(editor, input);
  if (opened.status !== "valid") throw new Error(JSON.stringify(opened));
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  const read = <T>(fn: () => T) => editor.getEditorState().read(fn);
  const snapshot = () =>
    read(() => {
      const s = $getSelection();
      return {
        document: editor.getEditorState().toJSON(),
        selection: $isRangeSelection(s)
          ? [
              s.anchor.key,
              s.anchor.offset,
              s.anchor.type,
              s.focus.key,
              s.focus.offset,
              s.focus.type,
            ]
          : null,
      };
    });
  const insert = (value = "x\ny", offset = 1) =>
    update(() => {
      const first = $getRoot().getFirstChildOrThrow<ParagraphNode>();
      if (first.getFirstChild())
        first.getFirstChildOrThrow<TextNode>().select(offset, offset);
      else first.select();
      expect($insertReviewFragment(fragment(value), id("f")).status).toBe(
        "changed",
      );
    });
  return {
    editor,
    input,
    session: opened.value,
    update,
    read,
    snapshot,
    insert,
  };
}

it.each(["accept", "reject", "remove"] as const)(
  "%s resolves the whole fragment and round trips",
  (action) => {
    const { editor, input, session, update, read, insert } = setup();
    const original = JSON.stringify(input);
    insert();
    read(() => {
      expect(contents()).toEqual(["Ax", "yB"]);
      expect(parts().map((n) => n.getProposalId())).toEqual(["f", "f"]);
      expect($inspectReviewProposal("f")).toMatchObject({
        value: { kind: "fragment" },
      });
    });
    const saved = session.exportDocument();
    expect(saved.status).toBe("valid");
    if (saved.status !== "valid") return;
    expect(openReviewSession(editor, saved.value).status).toBe("valid");
    update(() =>
      expect($resolveReviewProposals(["f"], action).status).toBe("changed"),
    );
    read(() =>
      expect(contents()).toEqual(action === "accept" ? ["Ax", "yB"] : ["AB"]),
    );
    expect(JSON.stringify(session.exportDocument())).not.toContain(
      '"proposalId":"f"',
    );
    expect(JSON.stringify(input)).toBe(original);
  },
);
it.each([
  [0, ["x", "yAB"]],
  [2, ["ABx", "y"]],
] as const)("supports offset %i", (offset, expected) => {
  const s = setup();
  s.insert("x\ny", offset);
  s.read(() => expect(contents()).toEqual(expected));
});
it("paragraph-end paste leaves the next accepted paragraph separate", () => {
  const s = setup(["A", "B"]);
  s.insert();
  s.read(() => expect(contents()).toEqual(["Ax", "y", "B"]));
});
it("empty paragraphs and non-BMP formatting survive", () => {
  const s = setup([""]);
  s.update(() => {
    $getRoot().getFirstChildOrThrow<ParagraphNode>().select();
    expect($insertReviewFragment(fragment("\n😀\n", 3), id("f")).status).toBe(
      "changed",
    );
  });
  s.read(() => {
    expect(contents()).toEqual(["", "😀", ""]);
    expect($getRoot().getAllTextNodes()[0]!.getFormat()).toBe(3);
  });
  expect(s.session.exportDocument().status).toBe("valid");
});
it("corrects text, internal structure, replacement and further paste under one identity", () => {
  const s = setup();
  s.insert();
  s.update(() => expect($insertReviewText("z").status).toBe("changed"));
  s.read(() => expect(contents()).toEqual(["Ax", "yzB"]));
  s.update(() => expect($splitReviewParagraph().status).toBe("changed"));
  s.read(() => {
    expect(contents()).toEqual(["Ax", "yz", "B"]);
    expect(parts()).toHaveLength(3);
  });
  s.update(() => expect($deleteReviewText(true).status).toBe("changed"));
  s.update(() => {
    parts()[1]!.getFirstChildOrThrow<TextNode>().select(0, 2);
    expect($replaceReviewText("q").status).toBe("changed");
  });
  s.update(() =>
    expect($insertReviewFragment(fragment("r\ns")).status).toBe("changed"),
  );
  s.read(() => {
    expect(contents()).toEqual(["Ax", "qr", "sB"]);
    expect(new Set(parts().map((n) => n.getProposalId()))).toEqual(
      new Set(["f"]),
    );
  });
});
it("normalizes an internal boundary deletion to insertion with stable ID", () => {
  const s = setup();
  s.insert();
  s.update(() => {
    parts()[1]!.selectStart();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  s.read(() => {
    expect(contents()).toEqual(["AxyB"]);
    expect($inspectReviewProposal("f")).toMatchObject({
      value: { kind: "insertion", proposal: { text: "xy" } },
    });
  });
  expect(s.session.exportDocument().status).toBe("valid");
});
it("normalizes one empty boundary to split but preserves multiple boundaries", () => {
  const s = setup();
  s.insert("\n\n");
  s.read(() => expect(parts()).toHaveLength(3));
  s.update(() => {
    parts()[2]!.selectStart();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  s.read(() => {
    expect(contents()).toEqual(["A", "B"]);
    expect($inspectReviewProposal("f")).toMatchObject({
      value: { kind: "structure", proposal: { kind: "split" } },
    });
  });
});
it("removes the proposal when its entire payload and boundaries are deleted", () => {
  const s = setup();
  s.insert();
  s.update(() => {
    const p = parts();
    const selection = p[0]!.selectStart();
    selection.focus.set(p[1]!.getFirstChildOrThrow().getKey(), 1, "text");
    expect($deleteReviewText(false).status).toBe("changed");
  });
  s.read(() => expect(contents()).toEqual(["AB"]));
  expect(s.session.exportDocument().status).toBe("valid");
});
it("formats a cross-paragraph selection locally and preserves orientation", () => {
  const s = setup();
  s.insert("xy\nzz");
  s.update(() => {
    const p = parts();
    const sel = p[1]!.getFirstChildOrThrow<TextNode>().select(1, 1);
    sel.focus.set(p[0]!.getFirstChildOrThrow().getKey(), 1, "text");
    expect($setReviewFormatting({ bold: true }).status).toBe("changed");
    expect(
      $isRangeSelection($getSelection()) &&
        ($getSelection() as import("lexical").RangeSelection).isBackward(),
    ).toBe(true);
  });
  s.read(() => {
    expect(
      $getRoot()
        .getAllTextNodes()
        .filter((n) => n.getFormat() === 1)
        .map((n) => n.getTextContent()),
    ).toEqual(["y", "z"]);
    expect(parts().map((n) => n.getProposalId())).toEqual(["f", "f"]);
  });
});
it.each(["accept", "reject"] as const)(
  "coexists with a split: %s F then reject S",
  (action) => {
    const s = setup(["ABCD"]);
    s.update(() => {
      $getRoot().getAllTextNodes()[0]!.select(3, 3);
      expect($splitReviewParagraph(id("s")).status).toBe("changed");
    });
    s.insert();
    s.read(() => expect(contents()).toEqual(["Ax", "yBC", "D"]));
    s.update(() =>
      expect($resolveReviewProposals(["f"], action).status).toBe("changed"),
    );
    s.update(() =>
      expect($resolveReviewProposals(["s"], "reject").status).toBe("changed"),
    );
    s.read(() =>
      expect(contents()).toEqual(
        action === "accept" ? ["Ax", "yBCD"] : ["ABCD"],
      ),
    );
  },
);
it("rejects split first without losing the fragment", () => {
  const s = setup(["ABCD"]);
  s.update(() => {
    $getRoot().getAllTextNodes()[0]!.select(3, 3);
    $splitReviewParagraph(id("s"));
  });
  s.insert();
  s.update(() =>
    expect($resolveReviewProposals(["s"], "reject").status).toBe("changed"),
  );
  s.read(() => {
    expect(contents()).toEqual(["Ax", "yBCD"]);
    expect($inspectReviewProposal("f").status).toBe("unchanged");
  });
});
it("accepted-side deletion is independent and survives fragment rejection", () => {
  const s = setup();
  s.insert();
  s.update(() => {
    $getRoot().getAllTextNodes()[0]!.selectEnd();
    expect($deleteReviewText(true, id("d")).status).toBe("changed");
  });
  s.update(() =>
    expect($resolveReviewProposal("f", "reject").status).toBe("changed"),
  );
  expect(JSON.stringify(s.session.exportDocument())).toContain(
    '"proposalId":"d"',
  );
  s.update(() =>
    expect($resolveReviewProposals(["d"], "accept").status).toBe("changed"),
  );
  s.read(() => expect(contents()).toEqual(["B"]));
});
it("refuses mixed ownership without changing document or selection", () => {
  const s = setup();
  s.insert();
  s.update(() => {
    const sel = $getRoot().getAllTextNodes()[0]!.select(0, 0);
    sel.focus.set(parts()[1]!.getFirstChildOrThrow().getKey(), 1, "text");
  });
  const before = s.snapshot();
  s.update(() => expect($replaceReviewText("q").status).toBe("refused"));
  expect(s.snapshot()).toEqual(before);
});
it("rejects malformed shared IDs and ownership on import", () => {
  const s = setup();
  s.insert();
  const saved = JSON.parse(JSON.stringify(s.session.exportDocument()));
  saved.value.root.children[1].children[0].startsParagraph = false;
  expect(validateReviewDocument(saved.value).status).toBe("invalid");
});
it("client semantic command is route neutral and DOM wraps formatting inside ins", () => {
  const s = setup();
  const root = document.createElement("div");
  document.body.append(root);
  s.editor.setRootElement(root);
  const unregister = registerReviewSession(s.editor, s.session, id("f"));
  s.update(() => {
    $getRoot().getAllTextNodes()[0]!.select(1, 1);
    s.editor.dispatchCommand(
      INSERT_REVIEW_FRAGMENT_COMMAND,
      fragment("x\ny", 1),
    );
  });
  expect(root.querySelectorAll("ins[data-review-fragment='f']")).toHaveLength(
    2,
  );
  expect(root.querySelector("ins strong, ins b")).not.toBeNull();
  s.read(() => expect(contents()).toEqual(["Ax", "yB"]));
  unregister();
  s.editor.setRootElement(null);
  root.remove();
});

it.each(["accept", "reject"] as const)(
  "%s preserves a caret on accepted suffix text",
  (action) => {
    const s = setup();
    s.insert();
    s.update(() => {
      $getRoot().getAllTextNodes().at(-1)!.selectEnd();
    });
    s.update(() =>
      expect($resolveReviewProposals(["f"], action).status).toBe("changed"),
    );
    s.read(() => {
      const sel = $getSelection();
      expect($isRangeSelection(sel) && sel.anchor.offset).toBe(2);
      expect(
        $isRangeSelection(sel) && sel.anchor.getNode().getTextContent(),
      ).toBe(action === "accept" ? "yB" : "AB");
    });
  },
);
it.each(["insert", "split", "delete"])(
  "refuses %s at an internal accepted-side component boundary",
  (action) => {
    const s = setup();
    s.insert();
    s.update(() => parts()[1]!.getParentOrThrow().select(0, 0));
    const before = s.snapshot();
    s.update(() =>
      expect(
        (action === "insert"
          ? $insertReviewFragment(fragment("a\nb"))
          : action === "split"
            ? $splitReviewParagraph()
            : $deleteReviewText(true)
        ).status,
      ).toBe("refused"),
    );
    expect(s.snapshot()).toEqual(before);
  },
);
it("preserves formatting on accepted suffix after fragment-local replacement", () => {
  const s = setup();
  s.update(() => {
    $getRoot().getAllTextNodes()[0]!.setFormat(2);
  });
  s.insert();
  s.update(() => {
    $insertReviewText("q");
  });
  s.read(() =>
    expect(
      $getRoot()
        .getAllTextNodes()
        .filter((n) => n.getParent()?.getType() === "paragraph")
        .map((n) => [n.getTextContent(), n.getFormat()]),
    ).toEqual([
      ["A", 2],
      ["B", 2],
    ]),
  );
});
it("word deletion remains local and preserves a non-BMP character boundary", () => {
  const s = setup();
  s.insert("hello\n😀 world");
  s.update(() =>
    expect($deleteReviewText(true, { granularity: "word" }).status).toBe(
      "changed",
    ),
  );
  s.update(() => expect($deleteReviewText(true).status).toBe("changed"));
  s.update(() => expect($deleteReviewText(true).status).toBe("changed"));
  s.read(() => expect(contents()).toEqual(["Ahello", "B"]));
});
it("refuses malformed native content and active composition atomically", () => {
  const s = setup();
  s.update(() => {
    $getRoot().getAllTextNodes()[0]!.select(1, 1);
  });
  const before = s.snapshot();
  s.update(() =>
    expect(
      $insertReviewFragment([{ runs: [{ text: "x\ny", format: 0 }] }]).status,
    ).toBe("refused"),
  );
  expect(s.snapshot()).toEqual(before);
  const mock = vi.spyOn(s.editor, "isComposing").mockReturnValue(true);
  const composing = s.snapshot();
  s.update(() =>
    expect($insertReviewFragment(fragment("x\ny")).status).toBe("refused"),
  );
  expect(s.snapshot()).toEqual(composing);
  mock.mockRestore();
});

it("previews current fragment content without changing live state or input", () => {
  const s = setup();
  s.insert();
  s.update(() => {
    $insertReviewText("z");
  });
  const before = s.snapshot();
  const saved = s.session.exportDocument();
  if (saved.status !== "valid") throw new Error(JSON.stringify(saved));
  for (const mode of ["accepted-state", "all-accepted"] as const) {
    const preview = createReviewPreview(saved.value, mode);
    expect(preview.status).toBe("valid");
    if (preview.status !== "valid") continue;
    const reopened = setup();
    expect(openReviewSession(reopened.editor, preview.value).status).toBe(
      "valid",
    );
    reopened.read(() =>
      expect(contents()).toEqual(
        mode === "accepted-state" ? ["AB"] : ["Ax", "yzB"],
      ),
    );
    expect(JSON.stringify(preview)).not.toContain('"proposalId"');
  }
  expect(s.snapshot()).toEqual(before);
});
it("empty fragment formatting inherits the insertion target unless explicitly supplied", () => {
  const s = setup();
  s.update(() => {
    const node = $getRoot().getAllTextNodes()[0]!;
    node.setFormat(2);
    node.select(1, 1);
    expect(
      $insertReviewFragment(
        [{ runs: [] }, { runs: [{ text: "x", format: 1 }] }, { runs: [] }],
        id("f"),
      ).status,
    ).toBe("changed");
    expect($insertReviewText("z").status).toBe("changed");
  });
  s.read(() =>
    expect(parts().at(-1)!.getFirstChildOrThrow<TextNode>().getFormat()).toBe(
      2,
    ),
  );
});
it("batch resolution refuses invalid unrelated structure before resolving any fragment", () => {
  const s = setup();
  s.insert();
  s.update(() => {
    $getRoot().getLastChildOrThrow<ParagraphNode>().setIndent(1);
  });
  const before = s.snapshot();
  s.update(() =>
    expect($resolveReviewProposals(["f"], "accept").status).toBe("refused"),
  );
  expect(s.snapshot()).toEqual(before);
});
