import type { ParagraphNode } from "lexical";
import type { ReviewBoundaryNode } from "./ReviewBoundaryNode";
import type { Preparation } from "./ReviewIntent";
import {
  inspectCollectedFragmentGroup,
  type CollectedProposalNodes,
} from "./ReviewProposalCollection";
import type { ReviewElementNode, ReviewFragmentNode } from "./ReviewNodes";
import { inspectBoundary } from "./ReviewStructure";
import { inspectCollectedProposalGroup } from "./ReviewTargeting";

/**
 * Live nodes behind one proposal identity, classified once in canonical
 * order: fragment placement, structural marker, then text group. Readers
 * shape their own values and owners keep their mutation; this module only
 * routes. One fresh collection per read, no registry, no cache: observations
 * expire at the next mutation.
 */
export type ClassifiedProposal =
  | {
      kind: "fragment";
      wrappers: ReviewFragmentNode[];
      paragraphs: ParagraphNode[];
    }
  | { kind: "boundary"; boundary: ReviewBoundaryNode }
  | {
      kind: "insertion" | "deletion" | "replacement" | "formatting";
      wrappers: ReviewElementNode[];
    };

/**
 * Route one shared observation to its kind. Fragment and structural checks
 * run before the identity syntax check, which stays at the text-group stage;
 * failure is the group error, the single source of invalid-proposal-id vs
 * unsupported-target. Callers needing the strict structural error (snapshot)
 * apply their own rule on failure.
 */
export function classifyCollectedProposal(
  collected: CollectedProposalNodes,
  proposalId: string,
): Preparation<ClassifiedProposal> {
  const fragment = inspectCollectedFragmentGroup(collected);
  if (fragment.status === "ready")
    return {
      status: "ready",
      value: {
        kind: "fragment",
        wrappers: fragment.value.wrappers,
        paragraphs: fragment.value.paragraphs,
      },
    };
  const boundary = inspectBoundary(proposalId);
  if (boundary.status === "ready")
    return {
      status: "ready",
      value: { kind: "boundary", boundary: boundary.value },
    };
  const group = inspectCollectedProposalGroup(collected, proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind === "fragment") {
    // Unreachable: the group reports fragment only when the placement check
    // above is ready, which already returned. Re-read to stay total.
    const retried = inspectCollectedFragmentGroup(collected);
    if (retried.status === "ready")
      return {
        status: "ready",
        value: {
          kind: "fragment",
          wrappers: retried.value.wrappers,
          paragraphs: retried.value.paragraphs,
        },
      };
    return retried;
  }
  return {
    status: "ready",
    value: { kind: group.value.kind, wrappers: group.value.wrappers },
  };
}
