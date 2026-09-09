import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
  type ParagraphNode,
} from "lexical";
import {
  $isReviewBoundaryNode,
  type ReviewBoundaryNode,
} from "./ReviewBoundaryNode";
import { validFragmentPositions } from "./ReviewFragmentInvariant";
import { isSupportedFormat } from "./ReviewFormattingState";
import {
  $isReviewFragmentNode,
  isReviewElementNode,
  isRootParagraph,
  type ReviewElementNode,
  type ReviewFragmentNode,
} from "./ReviewNodes";
import { refusal, type Preparation } from "./ReviewIntent";

/**
 * Live nodes carrying one proposal identity, gathered in a single tree walk.
 * Kind-specific validation stays with the callers; this module only collects.
 * Boundary observations are carried alongside element wrappers so structural
 * classification reads the same walk instead of re-walking; every matching
 * boundary node is kept so duplicates and misplaced markers stay visible to
 * validation rather than collapsing to the first match.
 */
export type CollectedProposalNodes = {
  wrappers: ReviewElementNode[];
  fragments: ReviewFragmentNode[];
  boundaries: ReviewBoundaryNode[];
};

export function collectProposalNodes(
  proposalId: string,
): CollectedProposalNodes {
  const wrappers: ReviewElementNode[] = [];
  const fragments: ReviewFragmentNode[] = [];
  const boundaries: ReviewBoundaryNode[] = [];
  const visit = (node: LexicalNode): void => {
    if ($isReviewBoundaryNode(node) && node.getProposalId() === proposalId)
      boundaries.push(node);
    if (isReviewElementNode(node) && node.getProposalId() === proposalId) {
      wrappers.push(node);
      if ($isReviewFragmentNode(node)) fragments.push(node);
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  visit($getRoot());
  return { wrappers, fragments, boundaries };
}

/**
 * Shared fragment placement check. Lives in a leaf so review targeting and
 * fragment authoring import it without a cycle; both previously walked the
 * whole tree with identical visitors.
 *
 * The collected form validates read-only over one shared observation; the
 * identity form collects first. Neither checks ID syntax: malformed IDs
 * simply match no nodes and refuse below.
 */
export function inspectCollectedFragmentGroup(
  collected: CollectedProposalNodes,
): Preparation<{
  wrappers: ReviewFragmentNode[];
  paragraphs: ParagraphNode[];
}> {
  const wrappers = collected.fragments;
  const paragraphs = wrappers.map((node) => node.getParent());
  if (
    collected.boundaries.length > 0 ||
    wrappers.length !== collected.wrappers.length ||
    paragraphs.some((parent) => !isRootParagraph(parent)) ||
    !validFragmentPositions(
      wrappers.map((node, index) => ({
        paragraph: paragraphs[index]!.getIndexWithinParent(),
        index: node.getIndexWithinParent(),
        siblings: paragraphs[index]!.getChildrenSize(),
        startsParagraph: node.startsParagraph(),
      })),
    ) ||
    wrappers.some((node) =>
      node
        .getChildren()
        .some(
          (child) =>
            !$isTextNode(child) ||
            !child.getTextContentSize() ||
            !isSupportedFormat(child.getFormat()) ||
            child.getStyle() !== "" ||
            child.getDetail() !== 0 ||
            child.getMode() !== "normal",
        ),
    )
  )
    return refusal(
      "unsafe-proposal-intersection",
      "Expected one contiguous fragment with one component per paragraph and owned internal boundaries.",
    );
  return {
    status: "ready",
    value: { wrappers, paragraphs: paragraphs as ParagraphNode[] },
  };
}

export function inspectFragmentGroup(proposalId: string): Preparation<{
  wrappers: ReviewFragmentNode[];
  paragraphs: ParagraphNode[];
}> {
  return inspectCollectedFragmentGroup(collectProposalNodes(proposalId));
}
