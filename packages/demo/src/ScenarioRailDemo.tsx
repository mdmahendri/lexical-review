import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $getRoot,
  $isRangeSelection,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  DELETE_CHARACTER_COMMAND,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
  type ParagraphNode,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $isReviewInsertionNode,
  $replaceReviewText,
  openReviewSession,
  type ReviewProposalIdFactory,
  type ReviewSession,
} from "lexical-review";
import {
  ReviewSessionPlugin,
  type ReviewIntentOutcome,
} from "lexical-review/client";
import {
  EVIDENCE_STATUS_TEXT,
  useProposalEvidence,
} from "./useProposalEvidence";

type ScenarioId = "r1" | "r2" | "r3" | "n1" | "n2" | "m1" | "n3" | "n4";

interface ScenarioDef {
  id: ScenarioId;
  label: string;
}

const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: "r1",
    label: "Suggest text",
  },
  {
    id: "r2",
    label: "Revise a suggestion",
  },
  {
    id: "r3",
    label: "Protect pending work",
  },
  {
    id: "n1",
    label: "Replace text",
  },
  {
    id: "n2",
    label: "Split a paragraph",
  },
  {
    id: "m1",
    label: "Merge paragraphs",
  },
  {
    id: "n3",
    label: "Paste paragraphs",
  },
  {
    id: "n4",
    label: "Compose text",
  },
];

function describeOutcome(outcome: ReviewIntentOutcome): string {
  switch (outcome.status) {
    case "changed":
      return "changed — the review state gained, extended, or settled a proposal";
    case "unchanged":
      return "unchanged — nothing to do (for example, empty input)";
    case "refused":
      return `refused / ${outcome.code} — no mutation, selection preserved: ${outcome.message}`;
    case "failed":
      return `failed / ${outcome.error.code}: ${outcome.error.message}`;
  }
}

function setPlainText(text: string, anchor: number, focus: number): void {
  $getRoot()
    .clear()
    .append($createParagraphNode().append($createTextNode(text)));
  $getRoot().getAllTextNodes()[0]?.select(anchor, focus);
}

function setParagraphs(
  texts: readonly string[],
  paragraphIndex: number,
  offset: number,
): void {
  const paragraphs = texts.map((text) =>
    $createParagraphNode().append($createTextNode(text)),
  );
  $getRoot()
    .clear()
    .append(...paragraphs);
  paragraphs[paragraphIndex]?.select(offset, offset);
}

function selectInsertionText(offset: number): boolean {
  for (const node of $getRoot().getAllTextNodes()) {
    const parent = node.getParent();
    if (parent !== null && $isReviewInsertionNode(parent)) {
      node.select(offset, offset);
      return true;
    }
  }
  return false;
}

/**
 * Pinned scenario start, run inside `editor.update`. Moves content and the
 * caret without reporting an outcome. Shared by scenario switching and
 * Reset so both restore exactly the same document.
 */
function setupScenarioDocument(
  id: ScenarioId,
  proposalIdFactory: ReviewProposalIdFactory,
): void {
  switch (id) {
    case "r1":
    case "n2":
    case "n3":
    case "n4":
      setPlainText("AB", 1, 1);
      break;
    case "m1":
      setParagraphs(["A", "B"], 1, 0);
      break;
    case "r2":
      setPlainText("AB", 1, 1);
      $insertReviewText("xy", { proposalIdFactory });
      selectInsertionText(1);
      break;
    case "r3":
      setPlainText("AB", 2, 2);
      $insertReviewText("X", { proposalIdFactory });
      $getRoot().getAllTextNodes()[0]?.select(2, 2);
      break;
    case "n1":
      setPlainText("cat", 0, 1);
      break;
  }
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 7.5 5.5 10.5 11.5 3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 3.5l7 7M10.5 3.5l-7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 3.5h9M5.5 3.5V2.6c0-.3.3-.6.6-.6h1.8c.3 0 .6.3.6.6v.9M4.2 3.5l.6 7c.1.8.7 1.4 1.4 1.4h1.6c.7 0 1.3-.6 1.4-1.4l.6-7M6 6.5v3.5M8 6.5v3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ScenarioRailDemo({
  onEditorReady,
}: {
  onEditorReady?: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [scenario, setScenario] = useState<ScenarioId>("r1");
  const [outcome, setOutcome] = useState<ReviewIntentOutcome | null>(null);
  const [outcomeCount, setOutcomeCount] = useState(0);
  const [normalization, setNormalization] = useState<string | null>(null);
  const [textFormat, setTextFormat] = useState({ bold: false, italic: false });
  const [refusedFlash, setRefusedFlash] = useState(false);
  const {
    evidence,
    evidenceReason,
    evidenceStatus,
    generateEvidence,
    inspection,
    isComposing,
    proposals,
    resetEvidence,
    resolveProposal,
    selectedActive,
    selectedId,
    setSelectedId,
    summaries,
  } = useProposalEvidence(editor);

  const factoryCounter = useRef(0);
  const factory = useCallback(() => `scenario-${++factoryCounter.current}`, []);
  // Guard against re-activating the already-selected rail item without
  // performing editor work inside a React state updater (updaters must stay
  // pure; StrictMode double-invokes them).
  const scenarioRef = useRef<ScenarioId>("r1");

  const handleOutcome = useCallback((next: ReviewIntentOutcome) => {
    setOutcome(next);
    setOutcomeCount((count) => count + 1);
    const value = (next as unknown as { value?: unknown }).value;
    if (
      value !== null &&
      typeof value === "object" &&
      "source" in value &&
      "flattened" in value &&
      "softBreakConverted" in value
    ) {
      setNormalization(JSON.stringify(value));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    editor.update(
      () => {
        setPlainText("AB", 1, 1);
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
    if (opened.status !== "valid")
      throw new Error("Invalid scenario-rail demo");
    if (!cancelled) setSession(opened.value);
    return () => {
      cancelled = true;
    };
  }, [editor]);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        const next = $isRangeSelection(selection)
          ? {
              bold: selection.hasFormat("bold"),
              italic: selection.hasFormat("italic"),
            }
          : { bold: false, italic: false };
        setTextFormat((current) =>
          current.bold === next.bold && current.italic === next.italic
            ? current
            : next,
        );
      });
    });
  }, [editor]);

  useEffect(() => {
    if (outcome?.status !== "refused") return;
    setRefusedFlash(true);
    const timer = window.setTimeout(() => setRefusedFlash(false), 2500);
    return () => window.clearTimeout(timer);
  }, [outcome, outcomeCount]);

  const clearScenarioState = useCallback(() => {
    factoryCounter.current = 0;
    setOutcome(null);
    setOutcomeCount(0);
    setNormalization(null);
    setRefusedFlash(false);
    resetEvidence();
  }, [resetEvidence]);

  /**
   * Selecting a different scenario loads its pinned starting document and
   * discards selection, inspection, the previous outcome, and generated
   * evidence. Activating the already-selected rail item is a no-op and never
   * resets edits. Loading restores the pinned caret without reporting a
   * user-operation outcome.
   */
  const loadScenario = useCallback(
    (next: ScenarioId) => {
      if (scenarioRef.current === next) return;
      scenarioRef.current = next;
      setScenario(next);
      clearScenarioState();
      editor.update(
        () => {
          setupScenarioDocument(next, factory);
        },
        { discrete: true },
      );
    },
    [clearScenarioState, editor, factory],
  );

  /** Reset performs the same restore as loading the current scenario. */
  const resetScenario = useCallback(() => {
    const current = scenarioRef.current;
    clearScenarioState();
    editor.update(
      () => {
        setupScenarioDocument(current, factory);
      },
      { discrete: true },
    );
  }, [clearScenarioState, editor, factory]);

  const insertAtPinnedCaret = useCallback(
    (text: string) => {
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0]?.select(1, 1);
          handleOutcome(
            $insertReviewText(text, { proposalIdFactory: factory }),
          );
        },
        { discrete: true },
      );
    },
    [editor, factory, handleOutcome],
  );

  const continueInsertion = useCallback(
    (text: string) => {
      editor.update(
        () => {
          let continued = false;
          for (const node of $getRoot().getAllTextNodes()) {
            const parent = node.getParent();
            if (parent !== null && $isReviewInsertionNode(parent)) {
              node.selectEnd();
              continued = true;
              break;
            }
          }
          if (!continued) {
            $getRoot().getAllTextNodes()[0]?.select(1, 1);
          }
          handleOutcome(
            $insertReviewText(text, { proposalIdFactory: factory }),
          );
        },
        { discrete: true },
      );
    },
    [editor, factory, handleOutcome],
  );

  const correctInsertionAt = useCallback(
    (offset: number, text: string) => {
      editor.update(
        () => {
          for (const node of $getRoot().getAllTextNodes()) {
            const parent = node.getParent();
            if (parent !== null && $isReviewInsertionNode(parent)) {
              node.select(offset, offset);
              break;
            }
          }
          handleOutcome(
            $insertReviewText(text, { proposalIdFactory: factory }),
          );
        },
        { discrete: true },
      );
    },
    [editor, factory, handleOutcome],
  );

  const attemptAcceptedSideDeletion = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(2, 2);
        handleOutcome($deleteReviewText(false, {}));
      },
      { discrete: true },
    );
  }, [editor, handleOutcome]);

  const replaceAtPinnedRange = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(0, 1);
        handleOutcome($replaceReviewText("b", { proposalIdFactory: factory }));
      },
      { discrete: true },
    );
  }, [editor, factory, handleOutcome]);

  const splitAtPinnedCaret = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
    editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
  }, [editor]);

  const mergeAtPinnedBoundary = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getChildren<ParagraphNode>()[1]?.select(0, 0);
      },
      { discrete: true },
    );
    editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true);
  }, [editor]);

  const simulateMultilinePaste = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
    const event = {
      preventDefault() {},
      clipboardData: {
        getData: (type: string) => (type === "text/html" ? "" : "x\ny"),
      },
    } as unknown as ClipboardEvent;
    editor.dispatchCommand(PASTE_COMMAND, event);
  }, [editor]);

  const simulateCompositionCommit = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
    editor.dispatchCommand(
      COMPOSITION_START_COMMAND,
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    editor.dispatchCommand(
      COMPOSITION_END_COMMAND,
      new CompositionEvent("compositionend", {
        bubbles: true,
        cancelable: true,
        data: "あ",
      }),
    );
  }, [editor]);

  const toggleTextFormat = useCallback(
    (format: "bold" | "italic") => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const activeScenario = SCENARIOS.find((entry) => entry.id === scenario);

  const feedbackText =
    outcome === null
      ? "Start with the first button above. Your change will appear in the document."
      : outcome.status === "refused"
        ? `This edit was refused. ${outcome.message} Your existing work is preserved.`
        : proposals.length
          ? `${proposals.length} pending proposal${proposals.length === 1 ? "" : "s"}. The change is visible, but has not been accepted.`
          : "No pending proposals remain. Try the example again or explore the next capability.";

  const index = SCENARIOS.findIndex((entry) => entry.id === scenario);
  const nextScenario = SCENARIOS[index + 1];
  const explanations: Record<ScenarioId, string> = {
    r1: "Start with AB. Insert x between the letters, then continue with y. Both keystrokes belong to one pending proposal; the accepted document stays AB until you accept it.",
    r2: "This example starts with xy already suggested between A and B. Correct it by adding z. The proposal keeps its identity. Remove withdraws the author’s suggestion.",
    r3: "A pending X sits after accepted text AB. Try deleting forward from the accepted side. The package refuses this unsupported target and preserves the document and selection.",
    n1: "Change cat to bat. The deleted c and inserted b form one replacement proposal, so they are accepted or rejected together.",
    n2: "Split AB between its letters. A paragraph boundary is a reviewable change too: accepting keeps the split; rejecting rejoins the text.",
    m1: "Merge A and B at the paragraph boundary. The merge is a pending structural proposal: accepting keeps one paragraph; rejecting restores the boundary.",
    n3: "Paste x and y as two paragraphs between A and B. The entire fragment is one proposal, reviewed as a whole. This button simulates a plain-text paste.",
    n4: "Text composition can commit a complete character as one insertion proposal. This button simulates the commit; you can also try your own input method in the editor.",
  };

  return (
    <div className="demo-layout">
      <nav aria-label="Scenarios" className="lesson-nav">
        <p className="eyebrow">Explore the capabilities</p>
        <div data-testid="scenario-rail" className="lesson-list">
          {SCENARIOS.map((entry, position) => (
            <button
              key={entry.id}
              type="button"
              data-testid="scenario-item"
              data-scenario={entry.id}
              aria-pressed={entry.id === scenario}
              onClick={() => loadScenario(entry.id)}
            >
              <span className="lesson-number">{position + 1}</span>
              {entry.label}
            </button>
          ))}
        </div>
        <p className="nav-note">
          Each example starts fresh. Switching examples resets edits.
        </p>
      </nav>
      <main id="try-it-live" className="lesson" key={scenario}>
        <header className="lesson-heading">
          <h2>{activeScenario?.label}</h2>
          <p>{explanations[scenario]}</p>
        </header>
        <section aria-label="Scenario actions" className="try-section">
          <h3>
            <span className="step">1</span> Make a change
          </h3>
          <p className="helper">
            Use an example button, or click in the document and type.
          </p>
          <div className="actions example-actions">
            {scenario === "r1" ? (
              <>
                <button
                  type="button"
                  data-testid="act-insert-x"
                  onClick={() => insertAtPinnedCaret("x")}
                >
                  Insert “x” between A and B
                </button>
                <button
                  type="button"
                  data-testid="act-insert-y"
                  onClick={() => continueInsertion("y")}
                >
                  Continue with “y”
                </button>
              </>
            ) : null}
            {scenario === "r2" ? (
              <button
                type="button"
                data-testid="act-correct-z"
                onClick={() => correctInsertionAt(1, "z")}
              >
                Add “z” to the suggestion
              </button>
            ) : null}
            {scenario === "r3" ? (
              <button
                type="button"
                data-testid="act-delete-forward"
                onClick={attemptAcceptedSideDeletion}
              >
                Try deleting across the boundary
              </button>
            ) : null}
            {scenario === "n1" ? (
              <button
                type="button"
                data-testid="act-replace"
                onClick={replaceAtPinnedRange}
              >
                Replace c with b
              </button>
            ) : null}
            {scenario === "n2" ? (
              <button
                type="button"
                data-testid="act-split"
                onClick={splitAtPinnedCaret}
              >
                Split paragraph (Enter)
              </button>
            ) : null}
            {scenario === "m1" ? (
              <button
                type="button"
                data-testid="act-merge"
                onClick={mergeAtPinnedBoundary}
              >
                Merge the paragraphs
              </button>
            ) : null}
            {scenario === "n3" ? (
              <button
                type="button"
                data-testid="act-paste"
                onClick={simulateMultilinePaste}
              >
                Paste two paragraphs (simulated)
              </button>
            ) : null}
            {scenario === "n4" ? (
              <button
                type="button"
                data-testid="act-compose"
                onClick={simulateCompositionCommit}
              >
                Commit “あ” (simulated)
              </button>
            ) : null}
          </div>
          <section
            aria-labelledby="scenario-editor-heading"
            className="editor-sheet"
          >
            <div className="editor-caption">
              <div className="editor-title">
                <h4 id="scenario-editor-heading">YOUR DOCUMENT</h4>
                <span className="review-mode-label">review mode is on</span>
              </div>
              <div className="editor-tools" aria-label="Editor tools">
                <button
                  type="button"
                  className="format-button"
                  data-testid="format-bold"
                  aria-label="Bold"
                  aria-pressed={textFormat.bold}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleTextFormat("bold")}
                >
                  <strong aria-hidden="true">B</strong>
                </button>
                <button
                  type="button"
                  className="format-button"
                  data-testid="format-italic"
                  aria-label="Italic"
                  aria-pressed={textFormat.italic}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleTextFormat("italic")}
                >
                  <em aria-hidden="true">I</em>
                </button>
                <button
                  type="button"
                  className="reset-button"
                  data-testid="reset-scenario"
                  aria-label="Reset example"
                  title="Reset example"
                  onClick={resetScenario}
                >
                  <span aria-hidden="true">↻</span> Reset
                </button>
              </div>
            </div>
            <ContentEditable
              data-testid="scenario-editor"
              aria-label="Editable review document"
              className="review-editor"
            />
            <p
              className={`editor-status${refusedFlash ? " is-error" : ""}`}
              role="status"
            >
              {feedbackText}
            </p>
          </section>
          <div className="editor-legend">
            <span>
              <ins>Inserted</ins> text is pending
            </span>
            <span>
              <del>Deleted</del> text stays visible until resolved
            </span>
          </div>
        </section>
        <section aria-label="Proposal list" className="review-section">
          <h3>
            <span className="step">2</span> Review the change
          </h3>
          <p className="helper">
            Select a pending proposal below, then decide what to keep.
          </p>
          <div data-testid="proposal-list" className="proposal-list">
            {proposals.length === 0 ? (
              <p className="empty-state">
                Your proposals will appear here when you make a change.
              </p>
            ) : (
              summaries.map((summary, position) => (
                <div
                  key={summary.id}
                  className={
                    summary.id === selectedId
                      ? "proposal-row is-selected"
                      : "proposal-row"
                  }
                >
                  <button
                    type="button"
                    data-testid="proposal-item"
                    data-proposal-id={summary.id}
                    aria-pressed={summary.id === selectedId}
                    className="proposal-row-main"
                    onClick={() => setSelectedId(summary.id)}
                  >
                    <span className="proposal-row-index">{position + 1}</span>
                    <span className="proposal-kind" data-kind={summary.kind}>
                      {summary.kind}
                    </span>
                    <span className="proposal-row-title">
                      Change {position + 1}
                    </span>
                  </button>
                  <div
                    className="proposal-row-decisions"
                    role="group"
                    aria-label={`Decide Change ${position + 1}`}
                  >
                    <button
                      type="button"
                      title="Accept — keeps the change"
                      aria-label={`Accept Change ${position + 1}`}
                      data-testid="accept-proposal"
                      data-proposal-id={summary.id}
                      className="decision-button decision-accept"
                      onClick={() => resolveProposal(summary.id, "accept")}
                    >
                      <CheckIcon />
                    </button>
                    <button
                      type="button"
                      title="Reject — sets it aside"
                      aria-label={`Reject Change ${position + 1}`}
                      data-testid="reject-proposal"
                      data-proposal-id={summary.id}
                      className="decision-button decision-reject"
                      onClick={() => resolveProposal(summary.id, "reject")}
                    >
                      <CrossIcon />
                    </button>
                    <button
                      type="button"
                      title="Remove — lets its author withdraw it"
                      aria-label={`Remove Change ${position + 1}`}
                      data-testid="remove-proposal"
                      data-proposal-id={summary.id}
                      className="decision-button decision-remove"
                      onClick={() => resolveProposal(summary.id, "remove")}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="helper">
            Accept keeps the change. Reject sets it aside. Remove lets its
            author withdraw it.
          </p>
        </section>
        <section aria-label="Document evidence" className="preview-section">
          <h3>
            <span className="step">3</span> Compare the outcomes
          </h3>
          <p className="helper">
            Preview the accepted document and what it would become if every
            pending proposal were accepted. Previewing does not resolve changes.
          </p>
          <div className="actions">
            <button
              type="button"
              data-testid="generate-evidence"
              disabled={isComposing}
              onClick={generateEvidence}
            >
              {evidence === null
                ? "Compare document versions"
                : "Refresh comparison"}
            </button>
            <span data-testid="evidence-status">
              {EVIDENCE_STATUS_TEXT[evidenceStatus]}
            </span>
          </div>
          {evidenceReason !== null && (
            <p data-testid="evidence-reason">{evidenceReason}</p>
          )}
          {evidenceStatus === "stale" && (
            <p className="helper">
              The document has changed. Refresh to compare the latest version.
            </p>
          )}
          {evidence !== null && (
            <div data-testid="evidence-pane" className="comparison">
              <div>
                <h4>Accepted document</h4>
                <p className="helper">Without pending changes</p>
                <pre data-testid="accepted-preview">
                  {evidence.accepted.join("\n")}
                </pre>
              </div>
              <div>
                <h4>If all changes are accepted</h4>
                <p className="helper">A preview, not a decision</p>
                <pre data-testid="all-accepted-preview">
                  {evidence.allAccepted.join("\n")}
                </pre>
              </div>
            </div>
          )}
        </section>
        {evidence !== null && (
          <details className="technical-details">
            <summary>
              Developer details · proposal data, outcomes & export
            </summary>
            <p>
              Inspect the package’s current pending proposals and export a
              native review document. Resolved proposals leave no resolution
              history.
            </p>
            <div data-testid="selected-details">
              {!selectedActive || inspection === null ? (
                <p>No proposal selected.</p>
              ) : inspection.status === "ready" ? (
                <pre>{JSON.stringify(inspection.value, null, 2)}</pre>
              ) : (
                <p>
                  Inspection refused / {inspection.code}: {inspection.message}
                </p>
              )}
            </div>
            <div data-testid="outcome-pane">
              <p>
                Latest outcome:{" "}
                {outcome === null
                  ? "none yet — run the scenario actions above"
                  : describeOutcome(outcome)}
              </p>
              <p>Reported outcomes this baseline: {outcomeCount}</p>
              {normalization !== null && (
                <p data-testid="normalization-report">
                  normalization: {normalization}
                </p>
              )}
            </div>
            <h4>Native export</h4>
            <pre data-testid="native-export">{evidence.nativeJson}</pre>
            <p data-testid="capability-label">
              Capability demo — non-normative, not a host UI pattern
            </p>
          </details>
        )}
        <div className="lesson-next">
          <span>
            {index === SCENARIOS.length - 1
              ? "You’ve reached the last example. Revisit any capability or try your own edits."
              : "Ready to explore another capability?"}
          </span>
          {nextScenario !== undefined && (
            <button
              type="button"
              onClick={() => {
                loadScenario(nextScenario.id);
                document
                  .getElementById("try-it-live")
                  ?.scrollIntoView({ block: "start" });
              }}
            >
              Next: {nextScenario.label} →
            </button>
          )}
        </div>
      </main>
      {session !== null && (
        <ReviewSessionPlugin
          session={session}
          proposalIdFactory={factory}
          onOutcome={handleOutcome}
        />
      )}
    </div>
  );
}
