import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $isReviewInsertionNode,
  $listReviewProposals,
  openReviewSession,
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

export default function ProposalEvidenceDemo({
  onEditorReady,
}: {
  onEditorReady?: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [outcome, setOutcome] = useState<ReviewIntentOutcome | null>(null);
  const [outcomeCount, setOutcomeCount] = useState(0);
  const {
    evidence,
    evidenceReason,
    evidenceStatus,
    generateEvidence,
    inspection,
    isComposing,
    proposals,
    resolveSelected,
    selectedActive,
    selectedId,
    setSelectedId,
    summaries,
  } = useProposalEvidence(editor);

  const factoryCounter = useRef(0);
  const factory = useCallback(() => `proposal-${++factoryCounter.current}`, []);

  const handleOutcome = useCallback((next: ReviewIntentOutcome) => {
    setOutcome(next);
    setOutcomeCount((count) => count + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("AB")));
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
      throw new Error("Invalid proposal-evidence demo");
    if (!cancelled) setSession(opened.value);
    return () => {
      cancelled = true;
    };
  }, [editor]);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  const resetBaseline = useCallback(() => {
    factoryCounter.current = 0;
    setOutcome(null);
    setOutcomeCount(0);
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("AB")));
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
  }, [editor]);

  const insertAt = useCallback(
    (text: string, place: "afterA" | "end") => {
      editor.update(
        () => {
          const nodes = $getRoot().getAllTextNodes();
          if (place === "afterA") nodes[0]?.select(1, 1);
          else nodes[nodes.length - 1]?.selectEnd();
          handleOutcome(
            $insertReviewText(text, { proposalIdFactory: factory }),
          );
        },
        { discrete: true },
      );
    },
    [editor, factory, handleOutcome],
  );

  /**
   * Scenario setup only: moves the caret into the second proposal without
   * reporting an outcome. The edit itself must come through ordinary typing
   * (or another review route) so tests prove the caret-driven contract.
   */
  const placeCaretInSecond = useCallback(() => {
    editor.update(
      () => {
        const ids = $listReviewProposals();
        const target = ids[1] ?? ids[0];
        if (target === undefined) return;
        for (const node of $getRoot().getAllTextNodes()) {
          const parent = node.getParent();
          if (
            parent !== null &&
            $isReviewInsertionNode(parent) &&
            parent.getProposalId() === target
          ) {
            node.selectEnd();
            break;
          }
        }
      },
      { discrete: true },
    );
  }, [editor]);

  const focusEditor = useCallback(() => {
    editor.getRootElement()?.focus();
  }, [editor]);

  const attemptAcceptedSideDeletion = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
        handleOutcome($deleteReviewText(false, {}));
      },
      { discrete: true },
    );
  }, [editor, handleOutcome]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p data-testid="capability-label">
        Capability demo — non-normative, not a host UI pattern
      </p>

      <section
        aria-label="Scenario setup"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <button
          type="button"
          data-testid="reset-baseline"
          onClick={resetBaseline}
        >
          Reset AB
        </button>
        <button
          type="button"
          data-testid="insert-first"
          onClick={() => insertAt("x", "afterA")}
        >
          Insert x after A
        </button>
        <button
          type="button"
          data-testid="insert-second"
          onClick={() => insertAt("y", "end")}
        >
          Insert y at end
        </button>
        <button
          type="button"
          data-testid="place-caret-second"
          disabled={proposals.length === 0}
          onClick={placeCaretInSecond}
        >
          Place caret in second proposal
        </button>
        <button type="button" data-testid="focus-editor" onClick={focusEditor}>
          Focus editor
        </button>
        <button
          type="button"
          data-testid="refuse-deletion"
          onClick={attemptAcceptedSideDeletion}
        >
          Accepted-side Delete (refuses)
        </button>
      </section>

      <section aria-label="Proposal list">
        <h2>Pending proposals</h2>
        <div
          data-testid="proposal-list"
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {proposals.length === 0 ? (
            <p>No pending proposals.</p>
          ) : (
            summaries.map((summary) => (
              <button
                key={summary.id}
                type="button"
                data-testid="proposal-item"
                data-proposal-id={summary.id}
                aria-pressed={summary.id === selectedId}
                onClick={() => setSelectedId(summary.id)}
              >
                {summary.id} — {summary.kind}
              </button>
            ))
          )}
        </div>
      </section>

      <section aria-label="Selected proposal">
        <h2>Selected proposal</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="accept-selected"
            disabled={!selectedActive}
            onClick={() => resolveSelected("accept")}
          >
            Accept selected
          </button>
          <button
            type="button"
            data-testid="reject-selected"
            disabled={!selectedActive}
            onClick={() => resolveSelected("reject")}
          >
            Reject selected
          </button>
          <button
            type="button"
            data-testid="remove-selected"
            disabled={!selectedActive}
            onClick={() => resolveSelected("remove")}
          >
            Remove selected
          </button>
        </div>
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
      </section>

      <section aria-label="Editable review projection">
        <h2>Editable review projection</h2>
        <div style={{ border: "1px solid #ccc", padding: 8 }}>
          <ContentEditable
            data-testid="proposal-evidence-editor"
            style={{ outline: "none" }}
          />
        </div>
      </section>

      <section aria-label="Document evidence">
        <h2>Document evidence</h2>
        <p data-testid="evidence-status">
          {EVIDENCE_STATUS_TEXT[evidenceStatus]}
        </p>
        {evidenceReason !== null ? (
          <p data-testid="evidence-reason">{evidenceReason}</p>
        ) : null}
        <button
          type="button"
          data-testid="generate-evidence"
          disabled={isComposing}
          onClick={generateEvidence}
        >
          {evidence === null ? "Generate evidence" : "Regenerate evidence"}
        </button>
        {evidence === null ? null : (
          <div data-testid="evidence-pane">
            <h3>Accepted-state preview</h3>
            <pre data-testid="accepted-preview">
              {evidence.accepted.join("\n")}
            </pre>
            <h3>All-accepted preview</h3>
            <pre data-testid="all-accepted-preview">
              {evidence.allAccepted.join("\n")}
            </pre>
            <h3>Native export</h3>
            <pre data-testid="native-export">{evidence.nativeJson}</pre>
          </div>
        )}
      </section>

      <section aria-label="Outcome">
        <h2>Outcome</h2>
        <div data-testid="outcome-pane">
          <p>
            Latest outcome:{" "}
            {outcome === null
              ? "none yet — run the scenario setup above"
              : describeOutcome(outcome)}
          </p>
          <p>Reported outcomes this baseline: {outcomeCount}</p>
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
  );
}
