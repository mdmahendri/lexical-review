import { useEffect, useRef } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  UNDO_COMMAND,
  HISTORY_PUSH_TAG,
} from "lexical";
import {
  $inspectReviewProposal,
  $insertReviewText,
  $resolveReviewProposal,
  openReviewSession,
  ReviewInsertionNode,
  ReviewDeletionNode,
} from "lexical-review";
import { registerReviewSession } from "lexical-review/client";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";

export function InsertionFixture() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = createEditor({
      namespace: "pending-insertion-browser",
      nodes: [ReviewInsertionNode, ReviewDeletionNode],
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
    if (opened.status !== "valid") throw new Error("Invalid browser fixture");
    let lastOutcome = "";
    let id = 0;
    const factory = () => `insertion-${++id}`;
    const unregister = registerReviewSession(editor, opened.value, {
      proposalIdFactory: factory,
      onOutcome: (outcome) => {
        lastOutcome = outcome.status;
      },
    });
    const unregisterHistory = registerHistory(
      editor,
      createEmptyHistoryState(),
      0,
    );
    const api = {
      select(index: number, start: number, end = start) {
        editor.update(
          () => $getRoot().getAllTextNodes()[index]!.select(start, end),
          { discrete: true },
        );
      },
      insert(value: string, route: "root" | "client") {
        editor.update(
          () => {
            if (route === "root")
              lastOutcome = $insertReviewText(value, {
                proposalIdFactory: factory,
              }).status;
            else
              editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, value);
          },
          { discrete: true, tag: HISTORY_PUSH_TAG },
        );
      },
      settle(action: "accept" | "reject" | "remove") {
        editor.update(
          () => {
            lastOutcome = $resolveReviewProposal("insertion-1", action).status;
          },
          { discrete: true, tag: HISTORY_PUSH_TAG },
        );
      },
      ambiguous() {
        editor.update(
          () => {
            const paragraph = $getRoot().getFirstChildOrThrow();
            if ($isElementNode(paragraph)) paragraph.select(1, 1);
          },
          { discrete: true },
        );
      },
      undo() {
        editor.dispatchCommand(UNDO_COMMAND, undefined);
      },
      snapshot() {
        return {
          document: opened.value.exportDocument(),
          proposal: editor
            .getEditorState()
            .read(() => $inspectReviewProposal("insertion-1")),
          replacement: editor
            .getEditorState()
            .read(() => $inspectReviewProposal("insertion-1")),
          lastOutcome,
        };
      },
    };
    window.__insertionFixture = api;
    return () => {
      delete window.__insertionFixture;
      unregisterHistory();
      unregister();
      editor.setRootElement(null);
    };
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-testid="insertion-editor"
    />
  );
}

declare global {
  interface Window {
    __insertionFixture?: {
      select(index: number, start: number, end?: number): void;
      insert(value: string, route: "root" | "client"): void;
      settle(action: "accept" | "reject" | "remove"): void;
      ambiguous(): void;
      undo(): void;
      snapshot(): {
        document: unknown;
        proposal: unknown;
        replacement: unknown;
        lastOutcome: string;
      };
    };
  }
}
