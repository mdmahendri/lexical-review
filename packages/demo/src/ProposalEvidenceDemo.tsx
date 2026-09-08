import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $inspectReviewProposalSnapshot,
  $isReviewInsertionNode,
  $listReviewProposals,
  $previewAcceptedState,
  $previewAllAccepted,
  exportReviewDocument,
  openReviewSession,
  type ReviewSession,
} from "lexical-review";
import {
  RESOLVE_REVIEW_PROPOSALS_COMMAND,
  ReviewSessionPlugin,
  type ReviewIntentOutcome,
} from "lexical-review/client";
import { deriveEvidenceStatus, type EvidenceStatus } from "./evidenceStatus";

type Inspection = ReturnType<typeof $inspectReviewProposalSnapshot>;

interface Evidence {
  docVersion: number;
  accepted: readonly string[];
  allAccepted: readonly string[];
  nativeJson: string;
}

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

/**
 * Content fingerprint for freshness. Serialized editor state carries no
 * selection, and node keys are stripped, so selection-only changes never
 * mark generated evidence stale while any content change does.
 */
function fingerprint(state: EditorState): string {
  return JSON.stringify(state.toJSON(), (key, value) =>
    key === "key" ? undefined : value,
  );
}

const STATUS_TEXT: Record<EvidenceStatus, string> = {
  "not-generated": "Not generated",
  current: "Current",
  stale: "Stale",
  unavailable: "Unavailable",
};

export default function ProposalEvidenceDemo({
  onEditorReady,
}: {
  onEditorReady?: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [outcome, setOutcome] = useState<ReviewIntentOutcome | null>(null);
  const [outcomeCount, setOutcomeCount] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [proposals, setProposals] = useState<readonly string[]>([]);
  const [summaries, setSummaries] = useState<
    readonly { id: string; kind: string }[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evidenceFailure, setEvidenceFailure] = useState<string | null>(null);

  const factoryCounter = useRef(0);
  const fingerprintRef = useRef<string | null>(null);
  const docVersionRef = useRef(0);
  const factory = useCallback(() => `proposal-${++factoryCounter.current}`, []);

  docVersionRef.current = docVersion;

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
    fingerprintRef.current = fingerprint(editor.getEditorState());
    setIsComposing(editor.isComposing());
    const unsubscribeUpdate = editor.registerUpdateListener(
      ({ editorState }) => {
        const next = fingerprint(editorState);
        if (fingerprintRef.current !== next) {
          fingerprintRef.current = next;
          setDocVersion((version) => version + 1);
        }
        setIsComposing(editor.isComposing());
      },
    );
    // Native DOM composition events: deterministic across browsers, unlike
    // command dispatch which engines gate differently for synthetic events.
    // The update listener above re-syncs from editor.isComposing() anyway.
    const rootElement = editor.getRootElement();
    const handleStart = () => setIsComposing(true);
    const handleEnd = () => setIsComposing(false);
    rootElement?.addEventListener("compositionstart", handleStart);
    rootElement?.addEventListener("compositionend", handleEnd);
    return () => {
      unsubscribeUpdate();
      rootElement?.removeEventListener("compositionstart", handleStart);
      rootElement?.removeEventListener("compositionend", handleEnd);
    };
  }, [editor]);

  useEffect(() => {
    editor.read(() => {
      const ids = $listReviewProposals();
      setProposals(ids);
      setSummaries(
        ids.map((id) => {
          const found = $inspectReviewProposalSnapshot(id);
          return {
            id,
            kind: found.status === "ready" ? found.value.kind : found.code,
          };
        }),
      );
      if (selectedId === null) {
        setInspection(null);
        return;
      }
      if (!ids.includes(selectedId)) {
        setInspection(null);
        setSelectedId(null);
        return;
      }
      setInspection($inspectReviewProposalSnapshot(selectedId));
    });
  }, [editor, docVersion, selectedId]);

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

  const resolveSelected = useCallback(
    (action: "accept" | "reject" | "remove") => {
      if (selectedId === null) return;
      editor.update(
        () => {
          editor.dispatchCommand(RESOLVE_REVIEW_PROPOSALS_COMMAND, {
            action,
            ids: [selectedId],
          });
        },
        { discrete: true },
      );
    },
    [editor, selectedId],
  );

  const generateEvidence = useCallback(() => {
    if (editor.isComposing()) return;
    const snapshot = editor.getEditorState();
    try {
      // editor.read observes the same synchronously-captured snapshot above:
      // no update can interleave, so previews and export share one source.
      const derived = editor.read(() => ({
        accepted: $previewAcceptedState(),
        allAccepted: $previewAllAccepted(),
      }));
      if (derived.accepted.status !== "ready") {
        setEvidenceFailure(
          `Preview refused / ${derived.accepted.code}: ${derived.accepted.message}`,
        );
        return;
      }
      const exported = exportReviewDocument(snapshot);
      if (exported.status !== "valid") {
        setEvidenceFailure(
          "Native export is not available for the current snapshot.",
        );
        return;
      }
      setEvidence({
        docVersion: docVersionRef.current,
        accepted: [...derived.accepted.value.paragraphs],
        allAccepted: [...derived.allAccepted.paragraphs],
        nativeJson: JSON.stringify(exported.value, null, 2),
      });
      setEvidenceFailure(null);
    } catch (error) {
      setEvidenceFailure(
        error instanceof Error
          ? error.message
          : "Preview could not be determined.",
      );
    }
  }, [editor]);

  const selectedActive = selectedId !== null && proposals.includes(selectedId);
  const evidenceStatus = deriveEvidenceStatus({
    isComposing,
    hasEvidence: evidence !== null,
    isStale: evidence !== null && evidence.docVersion !== docVersion,
    hasGenerationFailure: evidenceFailure !== null,
  });
  const evidenceReason = isComposing
    ? "Preview unavailable during composition"
    : evidenceFailure;

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
        <p data-testid="evidence-status">{STATUS_TEXT[evidenceStatus]}</p>
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
