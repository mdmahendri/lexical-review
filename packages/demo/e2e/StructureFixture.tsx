import { useEffect, useRef } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  INSERT_PARAGRAPH_COMMAND,
  type ParagraphNode,
} from "lexical";
import {
  $splitReviewParagraph,
  $resolveReviewProposals,
  openReviewSession,
  ReviewBoundaryNode,
  ReviewFormattingNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
} from "lexical-review";
import { registerReviewSession } from "lexical-review/client";

export function StructureFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = createEditor({
      namespace: "structure-browser",
      nodes: [
        ReviewBoundaryNode,
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
        if (new URLSearchParams(location.search).has("empty"))
          $getRoot().append(
            $createParagraphNode().setTextFormat(1),
            $createParagraphNode().setTextFormat(2),
          );
        else
          $getRoot().append(
            $createParagraphNode().append($createTextNode("Hello world")),
            $createParagraphNode().append($createTextNode("Next")),
          );
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
    if (opened.status !== "valid") throw new Error("Invalid structure fixture");
    let outcome = "";
    let counter = 0;
    const proposalIdFactory = () => `proposal-${++counter}`;
    const unregister = registerReviewSession(editor, opened.value, {
      proposalIdFactory,
      onOutcome(result) {
        outcome = result.status;
      },
    });
    window.__structureFixture = {
      paragraph(index) {
        editor.update(
          () => $getRoot().getChildAtIndex<ParagraphNode>(index)!.selectEnd(),
          { discrete: true },
        );
      },
      select(index, start, end = start) {
        editor.update(
          () => $getRoot().getAllTextNodes()[index]!.select(start, end),
          { discrete: true },
        );
      },
      marker(side) {
        editor.update(
          () => {
            const p = $getRoot().getFirstChildOrThrow<ParagraphNode>();
            const marker = p
              .getChildren()
              .find((node) => node instanceof ReviewBoundaryNode)!;
            const index =
              marker.getIndexWithinParent() + (side === "right" ? 1 : 0);
            p.select(index, index);
          },
          { discrete: true },
        );
      },
      split(route) {
        editor.update(
          () => {
            if (route === "root")
              outcome = $splitReviewParagraph({ proposalIdFactory }).status;
            else editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
          },
          { discrete: true },
        );
      },
      settle(ids, action) {
        editor.update(
          () => {
            outcome = $resolveReviewProposals(ids, action).status;
          },
          { discrete: true },
        );
      },
      snapshot() {
        return editor.getEditorState().read(() => {
          const selection = $getSelection();
          return {
            document: opened.value.exportDocument(),
            paragraphs: $getRoot()
              .getChildren()
              .map((node) => node.getTextContent()),
            outcome,
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
                }
              : null,
          };
        });
      },
    };
    return () => {
      delete window.__structureFixture;
      unregister();
      editor.setRootElement(null);
    };
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-testid="structure-editor"
    />
  );
}

declare global {
  interface Window {
    __structureFixture?: {
      paragraph(index: number): void;
      select(index: number, start: number, end?: number): void;
      marker(side: "left" | "right"): void;
      split(route: "root" | "client"): void;
      settle(ids: string[], action: "accept" | "reject" | "remove"): void;
      snapshot(): unknown;
    };
  }
}
