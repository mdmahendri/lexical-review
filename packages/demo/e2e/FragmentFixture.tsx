import { useEffect, useRef } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ParagraphNode,
} from "lexical";
import {
  $insertReviewFragment,
  $resolveReviewProposals,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewFragmentNode,
  ReviewFormattingNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
} from "lexical-review";
import {
  INSERT_REVIEW_FRAGMENT_COMMAND,
  registerReviewSession,
} from "lexical-review/client";
export function FragmentFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = createEditor({
      namespace: "fragment-browser",
      nodes: [
        ReviewBoundaryNode,
        ReviewFragmentNode,
        ReviewFormattingNode,
        ReviewInsertionNode,
        ReviewDeletionNode,
      ],
      onError(error) {
        throw error;
      },
    });
    editor.setRootElement(ref.current);
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode("AB")));
      },
      { discrete: true },
    );
    const input = editor.getEditorState().toJSON();
    const opened = openReviewSession(editor, {
      root: {
        ...input.root,
        $: { "lexical-review": { version: 3, extensions: [] } },
      },
    });
    if (opened.status !== "valid") throw new Error("Invalid fragment fixture");
    let outcome = "",
      counter = 0;
    const options = { proposalIdFactory: () => `proposal-${++counter}` };
    const unregister = registerReviewSession(editor, opened.value, {
      ...options,
      onOutcome(result) {
        outcome = result.status;
      },
    });
    window.__fragmentFixture = {
      insert(value, route = "client") {
        editor.update(
          () => {
            if (!$getSelection()) $getRoot().getAllTextNodes()[0]!.select(1, 1);
            const fragment = value.split("\n").map((text) => ({
              runs: text ? [{ text, format: 0 }] : [],
              emptyFormat: 0,
            }));
            if (route === "root")
              outcome = $insertReviewFragment(fragment, options).status;
            else
              editor.dispatchCommand(INSERT_REVIEW_FRAGMENT_COMMAND, fragment);
          },
          { discrete: true },
        );
      },
      endpoint(side, association) {
        editor.update(
          () => {
            const parts = $getRoot()
              .getChildren<ParagraphNode>()
              .flatMap((p) =>
                p.getChildren().filter((n) => n instanceof ReviewFragmentNode),
              );
            const part = side === "start" ? parts[0]! : parts.at(-1)!;
            if (association === "proposal") {
              if (side === "start") part.selectStart();
              else part.selectEnd();
            } else {
              const index =
                part.getIndexWithinParent() + (side === "start" ? 0 : 1);
              part.getParentOrThrow().select(index, index);
            }
          },
          { discrete: true },
        );
      },
      settle(action) {
        editor.update(
          () => {
            outcome = $resolveReviewProposals(["proposal-1"], action).status;
          },
          { discrete: true },
        );
      },
      snapshot() {
        return editor.getEditorState().read(() => {
          const s = $getSelection();
          const parent = $isRangeSelection(s) ? s.anchor.getNode() : null;
          return {
            paragraphs: $getRoot()
              .getChildren()
              .map((p) => p.getTextContent()),
            document: opened.value.exportDocument(),
            outcome,
            association:
              parent instanceof ReviewFragmentNode ||
              parent?.getParent() instanceof ReviewFragmentNode
                ? "proposal"
                : "accepted",
            format: $isRangeSelection(s) ? s.format : null,
          };
        });
      },
    };
    return () => {
      delete window.__fragmentFixture;
      unregister();
      editor.setRootElement(null);
    };
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-testid="fragment-editor"
    />
  );
}
declare global {
  interface Window {
    __fragmentFixture?: {
      insert(value: string, route?: "root" | "client"): void;
      endpoint(
        side: "start" | "end",
        association: "proposal" | "accepted",
      ): void;
      settle(action: "accept" | "reject" | "remove"): void;
      snapshot(): unknown;
    };
  }
}
