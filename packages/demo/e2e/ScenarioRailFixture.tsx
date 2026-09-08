import { useCallback, useEffect, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import {
  $listReviewProposals,
  exportReviewDocument,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
} from "lexical-review";
import ScenarioRailDemo from "../src/ScenarioRailDemo";

export function ScenarioRailFixture() {
  const initialConfig = {
    namespace: "scenario-rail-browser",
    onError(error: Error) {
      throw error;
    },
    nodes: [
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewFragmentNode,
      ReviewBoundaryNode,
    ],
  };
  const editorRef = useRef<LexicalEditor | null>(null);
  const handleEditor = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
  }, []);

  useEffect(() => {
    const readDomText = (testId: string): string | null => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      return element === null ? null : (element.textContent ?? "");
    };
    window.__scenarios = {
      snapshot() {
        const editor = editorRef.current;
        if (editor === null) throw new Error("Scenario editor not ready.");
        const state = editor.read(() => {
          const selection = $getSelection();
          return {
            proposals: $listReviewProposals(),
            text: $getRoot().getTextContent(),
            paragraphs: $getRoot()
              .getChildren()
              .map((child) => child.getTextContent()),
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
            document: exportReviewDocument(editor.getEditorState()),
          };
        });
        const activeRail = document.querySelector(
          '[data-testid="scenario-item"][aria-pressed="true"]',
        );
        return {
          ...state,
          scenario: activeRail?.getAttribute("data-scenario") ?? null,
          outcome: readDomText("outcome-pane"),
          normalization: readDomText("normalization-report"),
          evidenceStatus: readDomText("evidence-status"),
        };
      },
    };
    return () => {
      delete window.__scenarios;
    };
  }, []);

  return (
    // No overflow clipping here: the responsive test must observe the demo's
    // own page-level overflow behavior.
    <div style={{ maxWidth: "100%" }}>
      <LexicalComposer initialConfig={initialConfig}>
        <ScenarioRailDemo onEditorReady={handleEditor} />
      </LexicalComposer>
    </div>
  );
}

declare global {
  interface Window {
    __scenarios?: {
      snapshot(): {
        proposals: readonly string[];
        text: string;
        paragraphs: readonly string[];
        selection: {
          anchor: { key: string; offset: number; type: string };
          focus: { key: string; offset: number; type: string };
        } | null;
        document: unknown;
        scenario: string | null;
        outcome: string | null;
        normalization: string | null;
        evidenceStatus: string | null;
      };
    };
  }
}
