import { useEffect, useRef } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  DELETE_WORD_COMMAND,
  REMOVE_TEXT_COMMAND,
} from "lexical";
import {
  $deleteReviewText,
  $inspectReviewDeletion,
  $acceptReviewDeletion,
  $rejectReviewDeletion,
  $removeReviewDeletion,
  openReviewSession,
  ReviewInsertionNode,
  ReviewDeletionNode,
} from "lexical-review";
import { registerReviewSession } from "lexical-review/client";

export function DeletionFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = createEditor({
      namespace: "deletion-browser",
      nodes: [ReviewInsertionNode, ReviewDeletionNode],
      onError: (error) => {
        throw error;
      },
    });
    editor.setRootElement(ref.current);
    editor.update(
      () =>
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode("one two three").setFormat(1),
          ),
          $createParagraphNode().append($createTextNode("next")),
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
    if (opened.status !== "valid") throw new Error("Invalid deletion fixture");
    let id = 0;
    const factory = () => `deletion-${++id}`;
    let lastOutcome = "";
    const unregister = registerReviewSession(editor, opened.value, {
      proposalIdFactory: factory,
      onOutcome: (outcome) => {
        lastOutcome = outcome.status;
      },
    });
    const api = {
      select(index: number, start: number, end = start) {
        editor.update(
          () => $getRoot().getAllTextNodes()[index]!.select(start, end),
          { discrete: true },
        );
      },
      crossParagraph() {
        editor.update(
          () => {
            const nodes = $getRoot().getAllTextNodes();
            const selection = nodes[0]!.select(0, 0);
            selection.focus.set(nodes.at(-1)!.getKey(), 2, "text");
          },
          { discrete: true },
        );
      },
      delete(
        backward: boolean,
        granularity: "character" | "word" | "range" = "character",
      ) {
        editor.update(
          () => {
            if (granularity === "word")
              editor.dispatchCommand(DELETE_WORD_COMMAND, backward);
            else if (granularity === "range")
              editor.dispatchCommand(REMOVE_TEXT_COMMAND, null);
            else
              lastOutcome = $deleteReviewText(backward, {
                proposalIdFactory: factory,
              }).status;
          },
          { discrete: true },
        );
      },
      resolve(action: "accept" | "reject" | "remove") {
        editor.update(
          () => {
            lastOutcome = {
              accept: $acceptReviewDeletion,
              reject: $rejectReviewDeletion,
              remove: $removeReviewDeletion,
            }[action]("deletion-1").status;
          },
          { discrete: true },
        );
      },
      snapshot() {
        return {
          document: opened.value.exportDocument(),
          proposal: editor
            .getEditorState()
            .read(() => $inspectReviewDeletion("deletion-1")),
          lastOutcome,
          selection: editor.getEditorState().read(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return null;
            return {
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
            };
          }),
        };
      },
    };
    window.__deletionFixture = api;
    return () => {
      delete window.__deletionFixture;
      unregister();
      editor.setRootElement(null);
    };
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-testid="deletion-editor"
    />
  );
}

declare global {
  interface Window {
    __deletionFixture?: {
      select(index: number, start: number, end?: number): void;
      crossParagraph(): void;
      delete(
        backward: boolean,
        granularity?: "character" | "word" | "range",
      ): void;
      resolve(action: "accept" | "reject" | "remove"): void;
      snapshot(): unknown;
    };
  }
}
