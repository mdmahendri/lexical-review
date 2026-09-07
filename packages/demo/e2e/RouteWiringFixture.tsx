import { useEffect, useRef } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  FORMAT_TEXT_COMMAND,
  createEditor,
} from "lexical";
import {
  $deleteReviewText,
  $inspectReviewProposal,
  $inspectReviewProposalSnapshot,
  $insertReviewText,
  $listReviewProposals,
  $resolveReviewProposals,
  $toggleReviewFormatting,
  openReviewSession,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewInsertionNode,
  type ReviewIntentOutcome,
} from "lexical-review";
import {
  registerReviewSession,
  RESOLVE_REVIEW_PROPOSALS_COMMAND,
} from "lexical-review/client";

export function RouteWiringFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = createEditor({
      namespace: "route-wiring-browser",
      nodes: [ReviewInsertionNode, ReviewDeletionNode, ReviewFormattingNode],
      onError: (error) => {
        throw error;
      },
    });
    editor.setRootElement(ref.current);
    editor.update(
      () =>
        $getRoot().append($createParagraphNode().append($createTextNode("AB"))),
      { discrete: true },
    );
    const input = editor.getEditorState().toJSON();
    const opened = openReviewSession(editor, {
      root: {
        ...input.root,
        $: { "lexical-review": { version: 3, extensions: [] } },
      },
    });
    if (opened.status !== "valid")
      throw new Error("Invalid route-wiring fixture");
    let counter = 0;
    const factory = () => `route-wiring-${++counter}`;
    let lastOutcome: ReviewIntentOutcome | null = null;
    let outcomeCount = 0;
    const unregister = registerReviewSession(editor, opened.value, {
      proposalIdFactory: factory,
      onOutcome: (outcome) => {
        lastOutcome = outcome;
        outcomeCount += 1;
      },
    });
    const recordDirect = (outcome: ReviewIntentOutcome) => {
      lastOutcome = outcome;
      outcomeCount += 1;
    };
    const api = {
      reset() {
        counter = 0;
        lastOutcome = null;
        outcomeCount = 0;
        editor.update(
          () => {
            $getRoot()
              .clear()
              .append($createParagraphNode().append($createTextNode("AB")));
          },
          { discrete: true },
        );
      },
      selectAccepted() {
        editor.update(() => $getRoot().getAllTextNodes()[0]?.select(1, 1), {
          discrete: true,
        });
      },
      selectRange(start = 0, end = 1) {
        editor.update(
          () => $getRoot().getAllTextNodes()[0]?.select(start, end),
          {
            discrete: true,
          },
        );
      },
      insertRoot(value = "x") {
        editor.update(
          () => {
            recordDirect(
              $insertReviewText(value, { proposalIdFactory: factory }),
            );
          },
          { discrete: true },
        );
      },
      formatToolbar() {
        editor.update(
          () => {
            $getRoot().getAllTextNodes()[0]?.select(0, 1);
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
          },
          { discrete: true },
        );
      },
      formatRoot() {
        editor.update(
          () => {
            $getRoot().getAllTextNodes()[0]?.select(0, 1);
            recordDirect(
              $toggleReviewFormatting("bold", {
                proposalIdFactory: factory,
              }),
            );
          },
          { discrete: true },
        );
      },
      continueProposal(value = "!") {
        editor.update(
          () => {
            const nodes = $getRoot().getAllTextNodes();
            const insertion = nodes.find((node) => {
              const parent = node.getParent();
              return parent !== null && parent.getType() === "review-insertion";
            });
            (insertion ?? nodes[0])?.selectEnd();
            recordDirect(
              $insertReviewText(value, { proposalIdFactory: factory }),
            );
          },
          { discrete: true },
        );
      },
      refuseDeletion() {
        editor.update(
          () => {
            $getRoot().getAllTextNodes()[0]?.select(1, 1);
            recordDirect($deleteReviewText(false, {}));
          },
          { discrete: true },
        );
      },
      resolveViaCommand(action: "accept" | "reject" | "remove") {
        const ids = editor.getEditorState().read(() => $listReviewProposals());
        editor.update(
          () => {
            editor.dispatchCommand(RESOLVE_REVIEW_PROPOSALS_COMMAND, {
              action,
              ids,
            });
          },
          { discrete: true },
        );
      },
      resolveRoot(action: "accept" | "reject" | "remove") {
        const ids = editor.getEditorState().read(() => $listReviewProposals());
        editor.update(
          () => {
            recordDirect($resolveReviewProposals(ids, action));
          },
          { discrete: true },
        );
      },
      claimSameObject() {
        const before = outcomeCount;
        editor.update(
          () => {
            const event = new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              data: "z",
            });
            Object.defineProperty(event, "inputType", {
              configurable: true,
              value: "insertText",
            });
            editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, event);
            editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, event);
          },
          { discrete: true },
        );
        return { before, after: outcomeCount };
      },
      snapshot() {
        return editor.getEditorState().read(() => {
          const ids = $listReviewProposals();
          const first = ids[0];
          const selection = $getSelection();
          return {
            document: opened.value.exportDocument(),
            proposals: ids,
            proposal:
              first === undefined ? null : $inspectReviewProposal(first),
            proposalSnapshot:
              first === undefined
                ? null
                : $inspectReviewProposalSnapshot(first),
            lastOutcome,
            outcomeCount,
            text: $getRoot().getTextContent(),
            selection:
              selection !== null && $isRangeSelection(selection)
                ? {
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
                  }
                : null,
            failedExample: {
              error: {
                code: "route-wiring-example",
                message:
                  "Failed is a typed slot; #76 never triggers it live inside an update.",
              },
              status: "failed",
            },
          };
        });
      },
    };
    window.__routeWiringFixture = api;
    return () => {
      delete window.__routeWiringFixture;
      unregister();
      editor.setRootElement(null);
    };
  }, []);
  return (
    <div style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <p data-testid="capability-label">
        Capability demo — non-normative, not a host UI pattern
      </p>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-testid="route-wiring-editor"
      />
    </div>
  );
}

declare global {
  interface Window {
    __routeWiringFixture?: {
      reset(): void;
      selectAccepted(): void;
      selectRange(start?: number, end?: number): void;
      insertRoot(value?: string): void;
      formatToolbar(): void;
      formatRoot(): void;
      continueProposal(value?: string): void;
      refuseDeletion(): void;
      resolveViaCommand(action: "accept" | "reject" | "remove"): void;
      resolveRoot(action: "accept" | "reject" | "remove"): void;
      claimSameObject(): { before: number; after: number };
      snapshot(): {
        document: unknown;
        proposals: unknown;
        proposal: unknown;
        proposalSnapshot: unknown;
        lastOutcome: unknown;
        outcomeCount: number;
        text: unknown;
        selection: unknown;
        failedExample: unknown;
      };
    };
  }
}
