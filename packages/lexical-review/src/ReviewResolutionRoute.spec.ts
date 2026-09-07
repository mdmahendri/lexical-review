/**
 * Client-route unification coverage for #68.
 *
 * The typed `RESOLVE_REVIEW_PROPOSALS_COMMAND` route is a thin wrapper over
 * `$resolveReviewProposals`: dispatching through the command must yield the
 * identical outcome, document, selection, and refusal code as the direct
 * semantic call, with one physical action claimed once. Same-object native
 * events are likewise claimed once across every route.
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  BEFORE_INPUT_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  TextNode,
  createEditor,
  type LexicalEditor,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewFragment,
  $insertReviewText,
  $inspectReviewProposal,
  $resolveReviewProposals,
  $splitReviewParagraph,
  $toggleReviewFormatting,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  openReviewSession,
  type ReviewSession,
} from "./index";
import {
  RESOLVE_REVIEW_PROPOSALS_COMMAND,
  registerReviewSession,
  type ReviewIntentOutcome,
} from "./registerReviewSession";
import type { ProposalResolutionAction } from "./ReviewResolution";
import {
  paragraph,
  reviewDocument,
  text,
} from "./ReviewDocument.test-fixtures";

const NODES = [
  ReviewBoundaryNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
];

type Harness = {
  editor: LexicalEditor;
  session: ReviewSession;
  errors: Error[];
  outcomes: ReviewIntentOutcome[];
  unregister: () => void;
  update: (fn: () => void) => void;
};

function harness(
  options: Parameters<typeof registerReviewSession>[2] = {},
): Harness {
  const errors: Error[] = [];
  const outcomes: ReviewIntentOutcome[] = [];
  const editor = createEditor({
    namespace: "review-resolution-route",
    nodes: [...NODES],
    onError: (error) => {
      errors.push(error);
    },
  });
  const opened = openReviewSession(
    editor,
    reviewDocument([paragraph([text("AB")])]),
  );
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  const unregister = registerReviewSession(editor, opened.value, {
    ...options,
    onOutcome: (outcome) => {
      outcomes.push(outcome);
      options.onOutcome?.(outcome);
    },
  });
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  return {
    editor,
    session: opened.value,
    errors,
    outcomes,
    unregister,
    update,
  };
}

function selectionSnapshot(editor: LexicalEditor) {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    // Node keys are editor-local (fresh editors allocate independently), so
    // compare logical positions: paragraph index, child index, and offset.
    const locate = (key: string, offset: number, type: string) => {
      const node = $getRoot()
        .getAllTextNodes()
        .find((candidate) => candidate.getKey() === key);
      if (node === undefined) {
        const paragraph = $getRoot()
          .getChildren()
          .find((candidate) => candidate.getKey() === key);
        const paragraphIndex = $getRoot()
          .getChildren()
          .findIndex((candidate) => candidate.getKey() === key);
        return {
          text: paragraph?.getTextContent() ?? null,
          paragraphIndex,
          childIndex: -1,
          offset,
          type,
        };
      }
      const parent = node.getParent();
      const paragraphIndex = parent
        ? $getRoot()
            .getChildren()
            .indexOf(parent as never)
        : -1;
      return {
        text: node.getTextContent(),
        paragraphIndex,
        childIndex: parent ? parent.getChildren().indexOf(node as never) : -1,
        offset,
        type,
      };
    };
    return {
      anchor: locate(
        selection.anchor.key,
        selection.anchor.offset,
        selection.anchor.type,
      ),
      focus: locate(
        selection.focus.key,
        selection.focus.offset,
        selection.focus.type,
      ),
    };
  });
}

function documentSnapshot(session: ReviewSession) {
  return JSON.parse(JSON.stringify(session.exportDocument()));
}

function id(value: string) {
  return { proposalIdFactory: () => value };
}

/** Author one pending proposal of the requested kind; returns its identity. */
function author(
  h: Harness,
  kind:
    | "insertion"
    | "deletion"
    | "replacement"
    | "formatting"
    | "split"
    | "fragment",
): string {
  const proposalId = `p-${kind}`;
  h.update(() => {
    const [first] = $getRoot().getAllTextNodes();
    if (kind === "insertion") {
      first!.select(1, 1);
      expect($insertReviewText("x", id(proposalId)).status).toBe("changed");
    } else if (kind === "deletion") {
      first!.select(0, 1);
      expect($deleteReviewText(true, id(proposalId)).status).toBe("changed");
    } else if (kind === "replacement") {
      first!.select(0, 2);
      expect($insertReviewText("xy", id(proposalId)).status).toBe("changed");
    } else if (kind === "formatting") {
      first!.select(0, 2);
      expect($toggleReviewFormatting("bold", id(proposalId)).status).toBe(
        "changed",
      );
    } else if (kind === "split") {
      first!.select(1, 1);
      expect($splitReviewParagraph(id(proposalId)).status).toBe("changed");
    } else {
      first!.select(1, 1);
      expect(
        $insertReviewFragment(
          [
            { runs: [{ text: "x", format: 0 }] },
            { runs: [{ text: "y", format: 0 }] },
          ],
          id(proposalId),
        ).status,
      ).toBe("changed");
    }
  });
  h.update(() => {
    const inspected = $inspectReviewProposal(proposalId);
    expect(inspected.status).toBe("unchanged");
  });
  // Park the caret where resolution leaves it untouched.
  h.update(() => {
    $getRoot().getAllTextNodes()[0]!.select(0, 0);
  });
  return proposalId;
}

function resolveDirect(
  h: Harness,
  ids: string[],
  action: ProposalResolutionAction,
) {
  let outcome: ReviewIntentOutcome | null = null;
  h.update(() => {
    outcome = $resolveReviewProposals(ids, action);
  });
  if (outcome === null) throw new Error("No direct outcome");
  return outcome;
}

function resolveViaRoute(
  h: Harness,
  ids: string[],
  action: ProposalResolutionAction,
) {
  const seen = h.outcomes.length;
  let claimed = false;
  h.update(() => {
    claimed = h.editor.dispatchCommand(RESOLVE_REVIEW_PROPOSALS_COMMAND, {
      ids,
      action,
    });
  });
  expect(claimed).toBe(true);
  expect(h.outcomes).toHaveLength(seen + 1);
  return h.outcomes[h.outcomes.length - 1]!;
}

describe("resolution route parity", () => {
  it.each([
    "insertion",
    "deletion",
    "replacement",
    "formatting",
    "split",
    "fragment",
  ] as const)(
    "accept %s identically through direct and route calls",
    (kind) => {
      const direct = harness();
      const routed = harness();
      try {
        const directId = author(direct, kind);
        const routedId = author(routed, kind);
        expect(routedId).toBe(directId);
        const directOutcome = resolveDirect(direct, [directId], "accept");
        const routedOutcome = resolveViaRoute(routed, [routedId], "accept");
        expect(routedOutcome).toEqual(directOutcome);
        expect(documentSnapshot(routed.session)).toEqual(
          documentSnapshot(direct.session),
        );
        expect(selectionSnapshot(routed.editor)).toEqual(
          selectionSnapshot(direct.editor),
        );
      } finally {
        direct.unregister();
        routed.unregister();
      }
    },
  );

  it.each(["reject", "remove"] as const)(
    "%s insertion identically through direct and route calls",
    (action) => {
      const direct = harness();
      const routed = harness();
      try {
        const directId = author(direct, "insertion");
        const routedId = author(routed, "insertion");
        const directOutcome = resolveDirect(direct, [directId], action);
        const routedOutcome = resolveViaRoute(routed, [routedId], action);
        expect(routedOutcome).toEqual(directOutcome);
        expect(documentSnapshot(routed.session)).toEqual(
          documentSnapshot(direct.session),
        );
        expect(selectionSnapshot(routed.editor)).toEqual(
          selectionSnapshot(direct.editor),
        );
      } finally {
        direct.unregister();
        routed.unregister();
      }
    },
  );

  it("matches batch, empty, duplicate, and refusal outcomes without mutation", () => {
    const direct = harness();
    const routed = harness();
    try {
      const directInsertion = author(direct, "insertion");
      const routedInsertion = author(routed, "insertion");
      // Batch under one action plus duplicate handling.
      const directBatch = resolveDirect(
        direct,
        [directInsertion, directInsertion],
        "reject",
      );
      const routedBatch = resolveViaRoute(
        routed,
        [routedInsertion, routedInsertion],
        "reject",
      );
      expect(routedBatch).toEqual(directBatch);
      expect(documentSnapshot(routed.session)).toEqual(
        documentSnapshot(direct.session),
      );

      // Unknown identity refuses with zero mutation and preserved selection.
      const beforeDocument = documentSnapshot(routed.session);
      const beforeSelection = selectionSnapshot(routed.editor);
      const refused = resolveViaRoute(routed, ["missing"], "accept");
      expect(refused).toMatchObject({
        status: "refused",
        code: "unsupported-target",
      });
      expect(documentSnapshot(routed.session)).toEqual(beforeDocument);
      expect(selectionSnapshot(routed.editor)).toEqual(beforeSelection);

      // Empty batch is unchanged on both paths.
      expect(resolveDirect(direct, [], "accept")).toEqual(
        resolveViaRoute(routed, [], "accept"),
      );
    } finally {
      direct.unregister();
      routed.unregister();
    }
  });

  it("surfaces composition-active refusal as-is with zero mutation", () => {
    const direct = harness();
    const routed = harness();
    const directComposing = vi
      .spyOn(direct.editor, "isComposing")
      .mockReturnValue(true);
    const routedComposing = vi
      .spyOn(routed.editor, "isComposing")
      .mockReturnValue(true);
    try {
      const directId = author(direct, "insertion");
      const routedId = author(routed, "insertion");
      const before = documentSnapshot(routed.session);
      const routedOutcome = resolveViaRoute(routed, [routedId], "accept");
      expect(routedOutcome).toMatchObject({
        status: "refused",
        code: "unsupported-input",
      });
      expect(routedOutcome).toEqual(
        resolveDirect(direct, [directId], "accept"),
      );
      expect(documentSnapshot(routed.session)).toEqual(before);
    } finally {
      directComposing.mockRestore();
      routedComposing.mockRestore();
      direct.unregister();
      routed.unregister();
    }
  });

  it("refuses malformed payloads without mutation", () => {
    const h = harness();
    try {
      author(h, "insertion");
      const before = documentSnapshot(h.session);
      for (const payload of [
        null,
        undefined,
        { ids: ["p-insertion"] },
        { ids: ["p-insertion"], action: "bogus" },
      ]) {
        h.outcomes.length = 0;
        let claimed = false;
        h.update(() => {
          claimed = h.editor.dispatchCommand(
            RESOLVE_REVIEW_PROPOSALS_COMMAND,
            payload as never,
          );
        });
        expect(claimed).toBe(true);
        expect(h.outcomes).toMatchObject([
          { status: "refused", code: "unsupported-input" },
        ]);
      }
      expect(documentSnapshot(h.session)).toEqual(before);
    } finally {
      h.unregister();
    }
  });

  it("rolls back content and selection when the mutation throws", () => {
    const h = harness();
    try {
      const first = author(h, "insertion");
      const second = author(h, "deletion");
      // Park the caret inside the insertion so accepting touches proposal
      // nodes and the forced throw fires mid-mutation.
      h.update(() => {
        const target = $getRoot()
          .getAllTextNodes()
          .find((node) => node.getTextContent().includes("x"))!;
        target.select(1);
      });
      const before = documentSnapshot(h.session);
      const selection = selectionSnapshot(h.editor);
      const original = TextNode.prototype.selectEnd;
      const spy = vi
        .spyOn(TextNode.prototype, "selectEnd")
        .mockImplementationOnce(function (this: TextNode) {
          original.apply(this);
          throw new Error("after select");
        });
      let thrown: Error | null = null;
      try {
        h.update(() => {
          h.editor.dispatchCommand(RESOLVE_REVIEW_PROPOSALS_COMMAND, {
            ids: [first, second],
            action: "accept",
          });
        });
      } catch (error) {
        thrown = error as Error;
      } finally {
        spy.mockRestore();
      }
      // Lexical discards the pending update and reports through onError;
      // the throw propagates rather than returning `failed` from the route.
      expect(h.errors).toHaveLength(1);
      expect(documentSnapshot(h.session)).toEqual(before);
      expect(selectionSnapshot(h.editor)).toEqual(selection);
      expect(thrown).toBeNull();
    } finally {
      h.unregister();
    }
  });
});

describe("route claiming", () => {
  it("claims one split across key, beforeinput, and command routes with equal outcomes", () => {
    const run = (
      dispatch: (editor: LexicalEditor, event: Event) => void,
      label: string,
    ) => {
      // Fixed identity so per-route documents compare exactly.
      const h = harness({ proposalIdFactory: () => "s" });
      h.update(() => $getRoot().getAllTextNodes()[0]!.select(1, 1));
      const event =
        label === "key"
          ? new KeyboardEvent("keydown", { key: "Enter", cancelable: true })
          : new InputEvent("beforeinput", {
              inputType: "insertParagraph",
              cancelable: true,
            });
      h.update(() => {
        dispatch(h.editor, event);
      });
      const snapshot = {
        document: documentSnapshot(h.session),
        selection: selectionSnapshot(h.editor),
        outcomes: [...h.outcomes],
      };
      h.unregister();
      return snapshot;
    };
    const viaKey = run((editor, event) => {
      expect(
        editor.dispatchCommand(KEY_ENTER_COMMAND, event as KeyboardEvent),
      ).toBe(true);
    }, "key");
    const viaBeforeInput = run((editor, event) => {
      expect(
        editor.dispatchCommand(BEFORE_INPUT_COMMAND, event as InputEvent),
      ).toBe(true);
    }, "beforeinput");
    const viaCommand = run((editor) => {
      expect(editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined)).toBe(
        true,
      );
    }, "command");
    expect(viaBeforeInput.document).toEqual(viaKey.document);
    expect(viaCommand.document).toEqual(viaKey.document);
    expect(viaBeforeInput.outcomes).toEqual(viaKey.outcomes);
    expect(viaCommand.outcomes).toEqual(viaKey.outcomes);
  });

  it("applies one deletion for key and beforeinput routes with equal outcomes", () => {
    const run = (dispatch: (h: Harness) => void) => {
      // Fixed identity so per-route documents compare exactly.
      const h = harness({ proposalIdFactory: () => "d" });
      h.update(() => $getRoot().getAllTextNodes()[0]!.select(1, 1));
      h.update(() => dispatch(h));
      const snapshot = {
        document: documentSnapshot(h.session),
        selection: selectionSnapshot(h.editor),
        outcomes: [...h.outcomes],
      };
      h.unregister();
      return snapshot;
    };
    const viaKey = run((h) =>
      expect(
        h.editor.dispatchCommand(
          KEY_BACKSPACE_COMMAND,
          new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }),
        ),
      ).toBe(true),
    );
    const viaBeforeInput = run((h) =>
      expect(
        h.editor.dispatchCommand(
          BEFORE_INPUT_COMMAND,
          new InputEvent("beforeinput", {
            inputType: "deleteContentBackward",
            cancelable: true,
          }),
        ),
      ).toBe(true),
    );
    expect(viaBeforeInput.document).toEqual(viaKey.document);
    expect(viaBeforeInput.outcomes).toEqual(viaKey.outcomes);
  });

  it("claims repeated native event objects once without a second outcome", () => {
    const h = harness();
    try {
      h.update(() => $getRoot().getAllTextNodes()[0]!.select(1, 1));
      const split = new InputEvent("beforeinput", {
        inputType: "insertParagraph",
        cancelable: true,
      });
      h.update(() => {
        expect(h.editor.dispatchCommand(BEFORE_INPUT_COMMAND, split)).toBe(
          true,
        );
        expect(h.editor.dispatchCommand(BEFORE_INPUT_COMMAND, split)).toBe(
          true,
        );
      });
      expect(h.outcomes).toHaveLength(1);
      const lineBreak = new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        cancelable: true,
      });
      h.update(() => {
        expect(h.editor.dispatchCommand(BEFORE_INPUT_COMMAND, lineBreak)).toBe(
          true,
        );
        expect(h.editor.dispatchCommand(BEFORE_INPUT_COMMAND, lineBreak)).toBe(
          true,
        );
      });
      expect(h.outcomes).toHaveLength(2);
      const controlled = new InputEvent("beforeinput", {
        inputType: "insertReplacementText",
        data: "z",
        cancelable: true,
      });
      h.update(() => {
        expect(
          h.editor.dispatchCommand(
            CONTROLLED_TEXT_INSERTION_COMMAND,
            controlled,
          ),
        ).toBe(true);
        expect(
          h.editor.dispatchCommand(
            CONTROLLED_TEXT_INSERTION_COMMAND,
            controlled,
          ),
        ).toBe(true);
      });
      expect(h.outcomes).toHaveLength(3);
    } finally {
      h.unregister();
    }
  });
});
