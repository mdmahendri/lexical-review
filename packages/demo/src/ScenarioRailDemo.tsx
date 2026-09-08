import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
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

type ScenarioId = "r1" | "r2" | "r3" | "n1" | "n2" | "n3" | "n4";

interface ScenarioDef {
  id: ScenarioId;
  label: string;
  hint: string;
}

const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: "r1",
    label: "R1 — Insertion continuation",
    hint: "Accepted AB, caret A|B. Type x, then y: one insertion proposal.",
  },
  {
    id: "r2",
    label: "R2 — Edit then direct removal",
    hint: "Accepted AB + pending I1 = xy, caret x|y. Type z (same ID), then Remove.",
  },
  {
    id: "r3",
    label: "R3 — No-mutation refusal",
    hint: "Accepted AB + adjacent insertion X, caret AB|. Delete-forward refuses.",
  },
  {
    id: "n1",
    label: "N1 — Atomic replacement",
    hint: "Accepted cat, range selects c. Replace with b: one shared ID.",
  },
  {
    id: "n2",
    label: "N2 — Paragraph split",
    hint: "Accepted AB, caret A|B. Enter: one split boundary.",
  },
  {
    id: "n3",
    label: "N3 — Fragment insertion",
    hint: "Accepted AB, caret A|B. Simulated multiline paste x\\ny: one fragment.",
  },
  {
    id: "n4",
    label: "N4 — Composition commit",
    hint: "Accepted AB, caret A|B. Simulated composition commit あ: one insertion.",
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

/** Wide screens place the rail beside the editor; narrow screens stack it. */
function useWideRail(): boolean {
  const [wide, setWide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

const mutedText: CSSProperties = { fontSize: 14, color: "#4b5563" };
const sectionBox: CSSProperties = {
  minWidth: 0,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  padding: 12,
};
const actionButton: CSSProperties = {
  border: "1px solid #9ca3af",
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 14,
  background: "#ffffff",
};
const preBox: CSSProperties = {
  maxWidth: "100%",
  overflowX: "auto",
  fontSize: 14,
};

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
  const {
    evidence,
    evidenceReason,
    evidenceStatus,
    generateEvidence,
    inspection,
    isComposing,
    proposals,
    resetEvidence,
    resolveSelected,
    selectedActive,
    selectedId,
    setSelectedId,
    summaries,
  } = useProposalEvidence(editor);
  const wide = useWideRail();

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

  const clearScenarioState = useCallback(() => {
    factoryCounter.current = 0;
    setOutcome(null);
    setOutcomeCount(0);
    setNormalization(null);
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

  const focusEditor = useCallback(() => {
    editor.getRootElement()?.focus();
  }, [editor]);

  const activeScenario = SCENARIOS.find((entry) => entry.id === scenario);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: wide ? "row" : "column",
        gap: 16,
        minWidth: 0,
      }}
    >
      <nav
        aria-label="Scenarios"
        style={
          wide
            ? {
                width: 240,
                flexShrink: 0,
                minWidth: 0,
                position: "sticky",
                top: 8,
                alignSelf: "flex-start",
                maxHeight: "calc(100vh - 16px)",
                overflowY: "auto",
              }
            : {
                minWidth: 0,
                position: "sticky",
                top: 0,
                zIndex: 10,
                background: "#ffffff",
                paddingBottom: 4,
              }
        }
      >
        <p data-testid="capability-label" style={mutedText}>
          Capability demo — non-normative, not a host UI pattern
        </p>
        <div
          data-testid="scenario-rail"
          style={
            wide
              ? {
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minWidth: 0,
                  marginTop: 8,
                }
              : {
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "nowrap",
                  gap: 8,
                  minWidth: 0,
                  maxWidth: "100%",
                  marginTop: 8,
                  paddingBottom: 4,
                  overflowX: "auto",
                }
          }
        >
          {SCENARIOS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-testid="scenario-item"
              data-scenario={entry.id}
              aria-pressed={entry.id === scenario}
              onClick={() => loadScenario(entry.id)}
              style={
                wide
                  ? { ...actionButton, textAlign: "left" }
                  : {
                      ...actionButton,
                      flex: "0 0 auto",
                      whiteSpace: "nowrap",
                    }
              }
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p style={{ ...mutedText, marginTop: 8 }}>
          Switching scenarios resets edits.
        </p>
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            data-testid="reset-scenario"
            onClick={resetScenario}
            style={actionButton}
          >
            Reset scenario
          </button>
        </div>
        <p style={{ ...mutedText, marginTop: 8 }}>{activeScenario?.hint}</p>
      </nav>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minWidth: 0,
          flex: 1,
        }}
      >
        <section aria-label="Scenario actions" style={sectionBox}>
          <h2 style={{ fontWeight: 600 }}>Scenario actions</h2>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              minWidth: 0,
              marginTop: 8,
            }}
          >
            {scenario === "r1" ? (
              <>
                <button
                  type="button"
                  data-testid="act-insert-x"
                  style={actionButton}
                  onClick={() => insertAtPinnedCaret("x")}
                >
                  Insert x after A
                </button>
                <button
                  type="button"
                  data-testid="act-insert-y"
                  style={actionButton}
                  onClick={() => continueInsertion("y")}
                >
                  Insert y (continues)
                </button>
              </>
            ) : null}
            {scenario === "r2" ? (
              <button
                type="button"
                data-testid="act-correct-z"
                style={actionButton}
                onClick={() => correctInsertionAt(1, "z")}
              >
                Type z inside I1
              </button>
            ) : null}
            {scenario === "r3" ? (
              <button
                type="button"
                data-testid="act-delete-forward"
                style={actionButton}
                onClick={attemptAcceptedSideDeletion}
              >
                Accepted-side Delete (refuses)
              </button>
            ) : null}
            {scenario === "n1" ? (
              <button
                type="button"
                data-testid="act-replace"
                style={actionButton}
                onClick={replaceAtPinnedRange}
              >
                Replace c with b
              </button>
            ) : null}
            {scenario === "n2" ? (
              <button
                type="button"
                data-testid="act-split"
                style={actionButton}
                onClick={splitAtPinnedCaret}
              >
                Split paragraph (Enter)
              </button>
            ) : null}
            {scenario === "n3" ? (
              <button
                type="button"
                data-testid="act-paste"
                style={actionButton}
                onClick={simulateMultilinePaste}
              >
                Simulate multiline paste (simulated)
              </button>
            ) : null}
            {scenario === "n4" ? (
              <button
                type="button"
                data-testid="act-compose"
                style={actionButton}
                onClick={simulateCompositionCommit}
              >
                Simulate composition commit (simulated)
              </button>
            ) : null}
            <button
              type="button"
              data-testid="focus-editor"
              style={actionButton}
              onClick={focusEditor}
            >
              Focus editor
            </button>
          </div>
        </section>

        <section aria-label="Proposal list" style={{ minWidth: 0 }}>
          <h2 style={{ fontWeight: 600 }}>Pending proposals</h2>
          <div
            data-testid="proposal-list"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              minWidth: 0,
              marginTop: 4,
            }}
          >
            {proposals.length === 0 ? (
              <p style={mutedText}>No pending proposals.</p>
            ) : (
              summaries.map((summary) => (
                <button
                  key={summary.id}
                  type="button"
                  data-testid="proposal-item"
                  data-proposal-id={summary.id}
                  aria-pressed={summary.id === selectedId}
                  onClick={() => setSelectedId(summary.id)}
                  style={actionButton}
                >
                  {summary.id} — {summary.kind}
                </button>
              ))
            )}
          </div>
        </section>

        <section aria-label="Selected proposal" style={{ minWidth: 0 }}>
          <h2 style={{ fontWeight: 600 }}>Selected proposal</h2>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              minWidth: 0,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              data-testid="accept-selected"
              disabled={!selectedActive}
              onClick={() => resolveSelected("accept")}
              style={actionButton}
            >
              Accept selected
            </button>
            <button
              type="button"
              data-testid="reject-selected"
              disabled={!selectedActive}
              onClick={() => resolveSelected("reject")}
              style={actionButton}
            >
              Reject selected
            </button>
            <button
              type="button"
              data-testid="remove-selected"
              disabled={!selectedActive}
              onClick={() => resolveSelected("remove")}
              style={actionButton}
            >
              Remove selected
            </button>
          </div>
          <div data-testid="selected-details" style={{ minWidth: 0 }}>
            {!selectedActive || inspection === null ? (
              <p style={mutedText}>No proposal selected.</p>
            ) : inspection.status === "ready" ? (
              <pre style={preBox}>
                {JSON.stringify(inspection.value, null, 2)}
              </pre>
            ) : (
              <p style={mutedText}>
                Inspection refused / {inspection.code}: {inspection.message}
              </p>
            )}
          </div>
        </section>

        <section
          aria-labelledby="scenario-editor-heading"
          id="try-it-live"
          style={{ minWidth: 0 }}
        >
          <h2 id="scenario-editor-heading" style={{ fontWeight: 600 }}>
            Editable review projection
          </h2>
          <div
            style={{
              minHeight: 96,
              minWidth: 0,
              border: "1px solid #d1d5db",
              borderRadius: 4,
              padding: 8,
              marginTop: 4,
            }}
          >
            <ContentEditable
              data-testid="scenario-editor"
              style={{ outline: "none", minWidth: 0 }}
            />
          </div>
        </section>

        <section aria-label="Document evidence" style={{ minWidth: 0 }}>
          <h2 style={{ fontWeight: 600 }}>Document evidence</h2>
          <p data-testid="evidence-status" style={{ fontSize: 14 }}>
            {EVIDENCE_STATUS_TEXT[evidenceStatus]}
          </p>
          {evidenceReason !== null ? (
            <p data-testid="evidence-reason" style={mutedText}>
              {evidenceReason}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="generate-evidence"
            disabled={isComposing}
            onClick={generateEvidence}
            style={{ ...actionButton, marginTop: 4 }}
          >
            {evidence === null ? "Generate evidence" : "Regenerate evidence"}
          </button>
          {evidence === null ? null : (
            <div data-testid="evidence-pane" style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>
                Accepted-state preview
              </h3>
              <pre data-testid="accepted-preview" style={preBox}>
                {evidence.accepted.join("\n")}
              </pre>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>
                All-accepted preview
              </h3>
              <pre data-testid="all-accepted-preview" style={preBox}>
                {evidence.allAccepted.join("\n")}
              </pre>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Native export</h3>
              <pre data-testid="native-export" style={preBox}>
                {evidence.nativeJson}
              </pre>
            </div>
          )}
        </section>

        <section aria-label="Outcome" style={{ minWidth: 0 }}>
          <h2 style={{ fontWeight: 600 }}>Outcome</h2>
          <div
            data-testid="outcome-pane"
            style={{
              minWidth: 0,
              border: "1px solid #d1d5db",
              borderRadius: 4,
              background: "#f9fafb",
              padding: 8,
              fontSize: 14,
              marginTop: 4,
            }}
          >
            <p>
              Latest outcome:{" "}
              {outcome === null
                ? "none yet — run the scenario actions above"
                : describeOutcome(outcome)}
            </p>
            <p>Reported outcomes this baseline: {outcomeCount}</p>
            {normalization === null ? null : (
              <p data-testid="normalization-report">
                normalization: {normalization}
              </p>
            )}
          </div>
        </section>

        {session === null ? null : (
          <ReviewSessionPlugin
            session={session}
            proposalIdFactory={factory}
            onOutcome={handleOutcome}
          />
        )}
      </div>
    </div>
  );
}
