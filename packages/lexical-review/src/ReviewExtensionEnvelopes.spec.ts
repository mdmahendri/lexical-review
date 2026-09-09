import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
} from "lexical";
import {
  $createReviewInsertionNode,
  $insertReviewFragment,
  $insertReviewText,
  $isReviewInsertionNode,
  $resolveReviewProposal,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  validateReviewDocument,
} from "./index";
import { registerReviewSession } from "./client";
import {
  boundaryNode,
  formattingNode,
  fragmentNode,
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

const URI_A = "https://example.com/review-extensions/a/v1";
const URI_B = "https://example.com/review-extensions/b/v2";

function envelope(uri: string, required = false, value: unknown = null) {
  return { required, uri, value };
}

type MutableEnvelopeScope = {
  root: {
    $: { "lexical-review": { extensions: unknown[]; version: number } };
  };
};

function docWithExtensions(children: unknown[], extensions: unknown[]) {
  const input = reviewDocument(children) as unknown as MutableEnvelopeScope & {
    root: { children: unknown[] };
  };
  input.root.$["lexical-review"].extensions = extensions;
  return input as unknown;
}

function nodeWithExtensions(node: unknown, extensions: unknown[]) {
  return { ...(node as Record<string, unknown>), extensions };
}

function createFullReviewEditor() {
  return createEditor({
    namespace: "extension-envelopes",
    nodes: [
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewFragmentNode,
      ReviewBoundaryNode,
    ],
    onError: (error) => {
      throw error;
    },
    theme: {
      del: "review-deletion",
      ins: "review-insertion",
    },
  });
}

function exportedEnvelopesOf(
  exported: unknown,
  proposalId: string,
): unknown[][] {
  const sets: unknown[][] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.proposalId === "string" &&
      record.proposalId === proposalId &&
      Array.isArray(record.extensions)
    ) {
      sets.push(record.extensions as unknown[]);
    }
    Object.values(record).forEach(visit);
  };
  visit(exported);
  return sets;
}

describe("native extension envelopes (#63)", () => {
  it.each([
    [
      "non-array document extensions",
      () =>
        docWithExtensions([paragraph([text("Alpha")])], {} as unknown as []),
      "invalid-document",
      "$.root.$.lexical-review.extensions",
    ],
    [
      "empty envelope entry",
      () => docWithExtensions([paragraph([text("Alpha")])], [{}]),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0]",
    ],
    [
      "missing value",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [{ required: false, uri: URI_A }],
        ),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0]",
    ],
    [
      "extra entry key",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [{ required: false, uri: URI_A, value: null, extra: 1 }],
        ),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0]",
    ],
    [
      "relative uri",
      () =>
        docWithExtensions([paragraph([text("Alpha")])], [envelope("notes/v1")]),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0].uri",
    ],
    [
      "padded uri",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [envelope(` ${URI_A} `)],
        ),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0].uri",
    ],
    [
      "non-boolean required",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [{ required: "yes", uri: URI_A, value: null }],
        ),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0].required",
    ],
    [
      "undefined value",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [{ required: false, uri: URI_A, value: undefined }],
        ),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0].value",
    ],
    [
      "function value",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [
            {
              required: false,
              uri: URI_A,
              value: (() => 1) as unknown,
            },
          ],
        ),
      "invalid-document",
      "$.root.$.lexical-review.extensions[0].value",
    ],
    [
      "duplicate uri in one array",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [envelope(URI_A), envelope(URI_A, false, 1)],
        ),
      "invalid-document",
      "$.root.$.lexical-review.extensions[1].uri",
    ],
    [
      "malformed proposal envelope",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(
              reviewNode("review-insertion", "proposal-a", [text("new")]),
              [{}],
            ),
          ]),
        ]),
      "invalid-document",
      "$.root.children[0].children[0].extensions[0]",
    ],
  ])("rejects %s with taxonomy", (_name, build, code, path) => {
    const result = validateReviewDocument(build());
    if (code === "invalid-document") {
      expect(result).toMatchObject({
        issues: [{ code, path }],
        status: "invalid",
      });
    } else {
      expect(result).toMatchObject({
        reason: { code, path },
        status: "unsupported",
      });
    }
  });

  it.each([
    [
      "required document extension",
      () =>
        docWithExtensions(
          [paragraph([text("Alpha")])],
          [envelope(URI_A, true)],
        ),
      "$.root.$.lexical-review.extensions[0]",
    ],
    [
      "required proposal extension after an optional one",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(
              reviewNode("review-insertion", "proposal-a", [text("new")]),
              [envelope(URI_A), envelope(URI_B, true)],
            ),
          ]),
        ]),
      "$.root.children[0].children[0].extensions[1]",
    ],
  ])("refuses %s as unsupported", (_name, build, path) => {
    expect(validateReviewDocument(build())).toMatchObject({
      reason: { code: "unsupported-document", path },
      status: "unsupported",
    });
  });

  it("refuses required extensions on import without partial mutation", () => {
    const editor = createFullReviewEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("existing")),
        );
      },
      { discrete: true },
    );
    const beforeState = editor.getEditorState();
    const beforeJson = beforeState.toJSON();
    const input = docWithExtensions(
      [paragraph([text("Alpha")])],
      [envelope(URI_A, true, { note: "required" })],
    );
    const source = structuredClone(input);

    const opened = openReviewSession(editor, input);

    expect(opened).toMatchObject({
      reason: {
        code: "unsupported-document",
        path: "$.root.$.lexical-review.extensions[0]",
      },
      status: "unsupported",
    });
    expect(input).toEqual(source);
    expect(editor.getEditorState()).toBe(beforeState);
    expect(editor.getEditorState().toJSON()).toEqual(beforeJson);
  });

  it("round-trips optional document and proposal envelopes opaquely", () => {
    const envelopes = [
      envelope(URI_A, false, { note: "doc", tags: ["a", "b"], n: 3 }),
    ];
    const proposalEnvelopes = [
      envelope(URI_B, false, [1, "two", false]),
      envelope(URI_A, false, "shared-uri-independent-scope"),
    ];
    const input = docWithExtensions(
      [
        paragraph([
          text("A"),
          nodeWithExtensions(
            reviewNode("review-insertion", "proposal-a", [text("new", 1)]),
            proposalEnvelopes,
          ),
        ]),
      ],
      envelopes,
    );
    const source = structuredClone(input);
    const editor = createFullReviewEditor();
    const opened = openReviewSession(editor, input);

    expect(opened.status).toBe("valid");
    expect(input).toEqual(source);
    if (opened.status !== "valid") {
      return;
    }
    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status !== "valid") {
      return;
    }
    expect(exported.value).toEqual(source);
    expect(exported.value).not.toBe(input);
    expect(Object.isFrozen(exported.value)).toBe(true);

    const successorEditor = createFullReviewEditor();
    const successor = openReviewSession(successorEditor, exported.value);
    expect(successor.status).toBe("valid");
    if (successor.status === "valid") {
      expect(successor.value.exportDocument()).toEqual(exported);
    }
  });

  it("accepts member-reordered envelopes as the same opaque value", () => {
    const first = docWithExtensions(
      [
        paragraph([
          nodeWithExtensions(
            reviewNode("review-insertion", "proposal-a", [text("new")]),
            [
              {
                required: false,
                uri: URI_A,
                value: { b: [1, 2], a: "x" },
              },
            ],
          ),
        ]),
      ],
      [],
    );
    const second = docWithExtensions(
      [
        paragraph([
          nodeWithExtensions(
            reviewNode("review-insertion", "proposal-a", [text("new")]),
            [
              {
                value: { a: "x", b: [1, 2] },
                uri: URI_A,
                required: false,
              },
            ],
          ),
        ]),
      ],
      [],
    );
    const firstResult = validateReviewDocument(first);
    const secondResult = validateReviewDocument(second);
    expect(firstResult.status).toBe("valid");
    expect(secondResult.status).toBe("valid");
    if (firstResult.status !== "valid" || secondResult.status !== "valid") {
      return;
    }
    expect(secondResult.value).toEqual(firstResult.value);
  });

  it.each([
    [
      "split-side insertion with identical envelopes",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(
              reviewNode("review-insertion", "proposal-a", [text("ne")]),
              [envelope(URI_A, false, 1)],
            ),
            nodeWithExtensions(
              reviewNode("review-insertion", "proposal-a", [text("w")]),
              [envelope(URI_A, false, 1)],
            ),
          ]),
        ]),
      "valid",
      null,
    ],
    [
      "replacement sides with one identical set",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(
              reviewNode("review-deletion", "rep-a", [text("old")]),
              [envelope(URI_A)],
            ),
            nodeWithExtensions(
              reviewNode("review-insertion", "rep-a", [text("new")]),
              [envelope(URI_A)],
            ),
          ]),
        ]),
      "valid",
      null,
    ],
    [
      "formatting wrapper with envelopes",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(
              formattingNode(
                "fmt-a",
                [text("new", 1)],
                [{ format: 0, text: "new" }],
              ),
              [envelope(URI_A, false, { f: true })],
            ),
          ]),
        ]),
      "valid",
      null,
    ],
    [
      "split boundary marker with envelopes",
      () =>
        reviewDocument([
          paragraph([text("left")]),
          paragraph([
            nodeWithExtensions(boundaryNode("spl-a", "split"), [
              envelope(URI_A),
            ]),
            text("right"),
          ]),
        ]),
      "valid",
      null,
    ],
    [
      "fragment components with identical envelopes",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(fragmentNode("frag-a", [text("x")], false), [
              envelope(URI_A, false, [1]),
            ]),
          ]),
          paragraph([
            nodeWithExtensions(fragmentNode("frag-a", [text("y")], true), [
              envelope(URI_A, false, [1]),
            ]),
          ]),
        ]),
      "valid",
      null,
    ],
    [
      "same uri at document and proposal scope",
      () =>
        docWithExtensions(
          [
            paragraph([
              nodeWithExtensions(
                reviewNode("review-insertion", "proposal-a", [text("new")]),
                [envelope(URI_A, false, "proposal-value")],
              ),
            ]),
          ],
          [envelope(URI_A, false, "document-value")],
        ),
      "valid",
      null,
    ],
    [
      "divergent split sides",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(
              reviewNode("review-insertion", "proposal-a", [text("ne")]),
              [envelope(URI_A, false, 1)],
            ),
            nodeWithExtensions(
              reviewNode("review-insertion", "proposal-a", [text("w")]),
              [envelope(URI_A, false, 2)],
            ),
          ]),
        ]),
      "invalid",
      "$.root.children[0].children[1]",
    ],
    [
      "divergent replacement sides",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(
              reviewNode("review-deletion", "rep-a", [text("old")]),
              [envelope(URI_A)],
            ),
            nodeWithExtensions(
              reviewNode("review-insertion", "rep-a", [text("new")]),
              [envelope(URI_B)],
            ),
          ]),
        ]),
      "invalid",
      "$.root.children[0].children[1]",
    ],
    [
      "divergent fragment components",
      () =>
        reviewDocument([
          paragraph([
            nodeWithExtensions(fragmentNode("frag-a", [text("x")], false), [
              envelope(URI_A, false, [1]),
            ]),
          ]),
          paragraph([
            nodeWithExtensions(fragmentNode("frag-a", [text("y")], true), [
              envelope(URI_A, false, [2]),
            ]),
          ]),
        ]),
      "invalid",
      "$.root.children[1].children[0]",
    ],
  ])("ownership: %s", (_name, build, status, path) => {
    const result = validateReviewDocument(build());
    expect(result.status).toBe(status);
    if (status === "invalid" && result.status === "invalid") {
      expect(result.issues[0]).toMatchObject({
        code: "invalid-document",
        path,
      });
    }
  });

  it("refuses export of programmatically added required envelopes without mutating live state", () => {
    const editor = createFullReviewEditor();
    const opened = openReviewSession(
      editor,
      reviewDocument([paragraph([text("Alpha")])]),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    editor.update(
      () => {
        const paragraphNode = $getRoot().getFirstChildOrThrow();
        if (!$isElementNode(paragraphNode)) {
          throw new Error("Expected a paragraph fixture.");
        }
        paragraphNode.append(
          $createReviewInsertionNode("programmatic", [
            { required: true, uri: URI_A, value: null },
          ]).append($createTextNode("hi")),
        );
      },
      { discrete: true },
    );
    const before = editor.getEditorState();

    const exported = opened.value.exportDocument();

    expect(exported).toMatchObject({
      reason: {
        code: "unsupported-document",
        path: "$.root.children[0].children[1].extensions[0]",
      },
      status: "unsupported",
    });
    expect(editor.getEditorState()).toBe(before);
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("Alphahi");
  });

  it("preserves envelopes through insertion continuation", () => {
    const editor = createFullReviewEditor();
    const opened = openReviewSession(
      editor,
      reviewDocument([
        paragraph([
          text("A"),
          nodeWithExtensions(
            reviewNode("review-insertion", "proposal-a", [text("BC")]),
            [envelope(URI_A, false, { kept: true })],
          ),
        ]),
      ]),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const unregister = registerReviewSession(editor, opened.value);
    try {
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0]!.select(1, 1);
        },
        { discrete: true },
      );
      editor.update(
        () => {
          expect($insertReviewText("!").status).toBe("changed");
        },
        { discrete: true },
      );
    } finally {
      unregister();
    }
    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status !== "valid") {
      return;
    }
    expect(exportedEnvelopesOf(exported.value, "proposal-a")).toEqual([
      [{ required: false, uri: URI_A, value: { kept: true } }],
    ]);
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("A!BC");
  });

  it("preserves envelopes through fragment correction and normalization", () => {
    const editor = createFullReviewEditor();
    const opened = openReviewSession(
      editor,
      reviewDocument([
        paragraph([
          nodeWithExtensions(fragmentNode("frag-a", [text("xy")], false), [
            envelope(URI_A, false, "frag"),
          ]),
        ]),
        paragraph([
          nodeWithExtensions(fragmentNode("frag-a", [text("z")], true), [
            envelope(URI_A, false, "frag"),
          ]),
        ]),
      ]),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const unregister = registerReviewSession(editor, opened.value);
    try {
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0]!.select(1, 1);
        },
        { discrete: true },
      );
      editor.update(
        () => {
          expect(
            $insertReviewFragment([{ runs: [{ format: 0, text: "Q" }] }])
              .status,
          ).toBe("changed");
        },
        { discrete: true },
      );
    } finally {
      unregister();
    }
    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status !== "valid") {
      return;
    }
    const sets = exportedEnvelopesOf(exported.value, "frag-a");
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) {
      expect(set).toEqual([{ required: false, uri: URI_A, value: "frag" }]);
    }
  });

  it("merges live same-identity wrappers only when envelopes match", () => {
    const editor = createFullReviewEditor();
    const opened = openReviewSession(
      editor,
      reviewDocument([paragraph([text("A")])]),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    const unregister = registerReviewSession(editor, opened.value);
    try {
      editor.update(
        () => {
          const paragraphNode = $getRoot().getFirstChildOrThrow();
          if (!$isElementNode(paragraphNode)) {
            throw new Error("Expected a paragraph fixture.");
          }
          paragraphNode.append(
            $createReviewInsertionNode("merged", [
              { required: false, uri: URI_A, value: 1 },
            ]).append($createTextNode("x")),
            $createReviewInsertionNode("merged", [
              { required: false, uri: URI_A, value: 1 },
            ]).append($createTextNode("y")),
            $createReviewInsertionNode("split", [
              { required: false, uri: URI_A, value: 1 },
            ]).append($createTextNode("p")),
            $createReviewInsertionNode("split", [
              { required: false, uri: URI_A, value: 2 },
            ]).append($createTextNode("q")),
          );
        },
        { discrete: true },
      );
    } finally {
      unregister();
    }
    const merged = editor.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .map((node) => {
          const parent = node.getParent();
          return {
            id: $isReviewInsertionNode(parent) ? parent.getProposalId() : "",
            text: node.getTextContent(),
          };
        }),
    );
    expect(
      merged
        .filter((entry) => entry.id === "merged")
        .map((entry) => entry.text),
    ).toEqual(["xy"]);
    expect(
      merged.filter((entry) => entry.id === "split").map((entry) => entry.text),
    ).toEqual(["p", "q"]);

    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("invalid");
    if (exported.status === "invalid") {
      expect(exported.issues[0]).toMatchObject({
        code: "invalid-document",
        path: "$.root.children[0].children[3]",
      });
    }
  });

  it("drops envelopes with resolved proposals and retains no history", () => {
    const editor = createFullReviewEditor();
    const opened = openReviewSession(
      editor,
      reviewDocument([
        paragraph([
          nodeWithExtensions(
            reviewNode("review-insertion", "keep-a", [text("new")]),
            [envelope(URI_A, false, 1)],
          ),
          nodeWithExtensions(
            reviewNode("review-insertion", "drop-b", [text("gone")]),
            [envelope(URI_B, false, 2)],
          ),
        ]),
      ]),
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      return;
    }
    editor.update(
      () => {
        expect($resolveReviewProposal("drop-b", "remove").status).toBe(
          "changed",
        );
      },
      { discrete: true },
    );
    const exported = opened.value.exportDocument();
    expect(exported.status).toBe("valid");
    if (exported.status !== "valid") {
      return;
    }
    expect(exportedEnvelopesOf(exported.value, "keep-a")).toEqual([
      [{ required: false, uri: URI_A, value: 1 }],
    ]);
    expect(exportedEnvelopesOf(exported.value, "drop-b")).toEqual([]);
    expect(JSON.stringify(exported.value)).not.toContain("drop-b");
  });
});
