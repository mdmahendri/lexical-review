import { useEffect, useRef } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  FORMAT_TEXT_COMMAND,
} from "lexical";
import {
  $inspectReviewFormatting,
  $resolveReviewProposals,
  $toggleReviewFormatting,
  openReviewSession,
  ReviewFormattingNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  type ReviewFormattingProperty,
} from "lexical-review";
import { registerReviewSession } from "lexical-review/client";

export function FormattingFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = createEditor({
      namespace: "formatting-browser",
      nodes: [ReviewFormattingNode, ReviewInsertionNode, ReviewDeletionNode],
      theme: {
        text: {
          bold: "bold",
          italic: "italic",
          underline: "underline",
          strikethrough: "strike",
        },
      },
      onError(error) {
        throw error;
      },
    });
    editor.setRootElement(ref.current);
    editor.update(
      () =>
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode("plain "),
            $createTextNode("bold").setFormat(1),
          ),
        ),
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
      throw new Error("Invalid formatting fixture");
    let outcome = "";
    let counter = 0;
    const proposalIdFactory = () => `proposal-${++counter}`;
    const unregister = registerReviewSession(editor, opened.value, {
      proposalIdFactory,
      onOutcome(result) {
        outcome = result.status;
      },
    });
    window.__formattingFixture = {
      select(index: number, start: number, end = start) {
        editor.update(
          () => $getRoot().getAllTextNodes()[index]!.select(start, end),
          { discrete: true },
        );
      },
      format(property: ReviewFormattingProperty, route: "root" | "client") {
        editor.update(
          () => {
            if (route === "root")
              outcome = $toggleReviewFormatting(property, {
                proposalIdFactory,
              }).status;
            else editor.dispatchCommand(FORMAT_TEXT_COMMAND, property);
          },
          { discrete: true },
        );
      },
      settle(action: "accept" | "reject" | "remove") {
        editor.update(
          () => {
            outcome = $resolveReviewProposals(["proposal-1"], action).status;
          },
          { discrete: true },
        );
      },
      snapshot() {
        return editor.getEditorState().read(() => {
          const selection = $getSelection();
          return {
            document: opened.value.exportDocument(),
            proposal: $inspectReviewFormatting("proposal-1"),
            outcome,
            selection: $isRangeSelection(selection)
              ? {
                  text: selection.getTextContent(),
                  backward: selection.isBackward(),
                  format: selection.format,
                }
              : null,
          };
        });
      },
    };
    return () => {
      delete window.__formattingFixture;
      unregister();
      editor.setRootElement(null);
    };
  }, []);
  return (
    <>
      <style>{`.bold{font-weight:bold}.italic{font-style:italic}.underline{text-decoration:underline}.strike{text-decoration:line-through}`}</style>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-testid="formatting-editor"
      />
    </>
  );
}

declare global {
  interface Window {
    __formattingFixture?: {
      select(index: number, start: number, end?: number): void;
      format(
        property: ReviewFormattingProperty,
        route: "root" | "client",
      ): void;
      settle(action: "accept" | "reject" | "remove"): void;
      snapshot(): unknown;
    };
  }
}
