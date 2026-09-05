import { $isReviewBoundaryNode } from "./ReviewBoundaryNode";
import { $getRoot, $isElementNode } from "lexical";
import { createProposalId, isValidProposalId } from "./ProposalIdentity";
import { isReviewElementNode } from "./ReviewSelectionPreparation";
import { refusal, type Preparation } from "./ReviewIntent";
export type ReviewProposalIdFactory = () => string;

export type ReviewAuthoringOptions = Readonly<{
  proposalIdFactory?: ReviewProposalIdFactory;
}>;

function getUniqueProposalId(
  factory: ReviewProposalIdFactory,
): Preparation<string> {
  const existing = new Set<string>();
  for (const paragraph of $getRoot().getChildren()) {
    if (!$isElementNode(paragraph)) {
      continue;
    }
    for (const child of paragraph.getChildren()) {
      if (isReviewElementNode(child) || $isReviewBoundaryNode(child)) {
        existing.add(child.getProposalId());
      }
    }
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let proposalId: string;
    try {
      proposalId = factory();
    } catch (cause) {
      return refusal(
        "invalid-proposal-id",
        cause instanceof Error
          ? cause.message
          : "The proposal identity factory failed.",
      );
    }
    if (isValidProposalId(proposalId) && !existing.has(proposalId)) {
      return { status: "ready", value: proposalId };
    }
  }
  return refusal(
    "invalid-proposal-id",
    "The proposal identity factory did not produce a unique valid identity.",
  );
}

export function prepareProposalId(
  options: ReviewAuthoringOptions,
): Preparation<string> {
  return getUniqueProposalId(options.proposalIdFactory ?? createProposalId);
}
