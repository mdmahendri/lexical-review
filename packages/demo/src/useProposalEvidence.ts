import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, LexicalEditor } from "lexical";
import {
  $inspectReviewProposalSnapshot,
  $listReviewProposals,
  $previewAcceptedState,
  $previewAllAccepted,
  exportReviewDocument,
  type ReviewIntentRefusal,
  type ReviewProposalSnapshot,
} from "lexical-review";
import { RESOLVE_REVIEW_PROPOSALS_COMMAND } from "lexical-review/client";
import { deriveEvidenceStatus, type EvidenceStatus } from "./evidenceStatus";

export type ProposalInspection =
  | Readonly<{ status: "ready"; value: ReviewProposalSnapshot }>
  | ReviewIntentRefusal;

export interface GeneratedEvidence {
  docVersion: number;
  accepted: readonly string[];
  allAccepted: readonly string[];
  nativeJson: string;
}

export const EVIDENCE_STATUS_TEXT: Record<EvidenceStatus, string> = {
  "not-generated": "Not generated",
  current: "Current",
  stale: "Stale",
  unavailable: "Unavailable",
};

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

export interface ProposalEvidenceState {
  docVersion: number;
  evidence: GeneratedEvidence | null;
  evidenceReason: string | null;
  evidenceStatus: EvidenceStatus;
  generateEvidence: () => void;
  inspection: ProposalInspection | null;
  isComposing: boolean;
  proposals: readonly string[];
  resetEvidence: () => void;
  resolveSelected: (action: "accept" | "reject" | "remove") => void;
  selectedActive: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  summaries: readonly { id: string; kind: string }[];
}

/**
 * Shared #77 semantic-evidence behavior for the capability demos: separate
 * `selectedId` (list click selects; typing follows the caret, never
 * `selectedId`), Accept/Reject/Remove targeting only `selectedId`,
 * inspection that never moves caret/focus/scroll, freshness
 * `Not generated` / `Stale` / `Unavailable` / `Current`, single-snapshot
 * Generate, selection-only changes never marking stale, and preview errors
 * never overwriting the operation outcome.
 */
export function useProposalEvidence(
  editor: LexicalEditor,
): ProposalEvidenceState {
  const [docVersion, setDocVersion] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [proposals, setProposals] = useState<readonly string[]>([]);
  const [summaries, setSummaries] = useState<
    readonly { id: string; kind: string }[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ProposalInspection | null>(null);
  const [evidence, setEvidence] = useState<GeneratedEvidence | null>(null);
  const [evidenceFailure, setEvidenceFailure] = useState<string | null>(null);

  const fingerprintRef = useRef<string | null>(null);
  const docVersionRef = useRef(0);
  docVersionRef.current = docVersion;

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

  const resetEvidence = useCallback(() => {
    setSelectedId(null);
    setInspection(null);
    setEvidence(null);
    setEvidenceFailure(null);
  }, []);

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

  return {
    docVersion,
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
  };
}
