import {
  $getEditor,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
} from "lexical";
import {
  $isReviewDeletionNode,
  $isReviewInsertionNode,
  getTextChildren,
  isRootParagraph,
  type ReviewElementNode,
} from "./ReviewNodes";
import {
  changed,
  refusal,
  unchanged,
  type Preparation,
  type ReviewIntentOutcome,
} from "./ReviewIntent";
import {
  inspectCollectedFragmentProposal,
  resolveFragment,
  type ReviewFragmentProposal,
} from "./ReviewFragment";
import {
  inspectBoundary,
  inspectStructureProposal,
  resolveStructure,
  validateStructuralState,
  type ReviewStructuralProposal,
} from "./ReviewStructure";
import {
  inspectCollectedFormattingProposal,
  resolveFormatting,
  type ReviewFormattingProposal,
} from "./ReviewFormatting";
import type {
  ReviewDeletionProposal,
  ReviewInsertionProposal,
  ReviewReplacementProposal,
} from "./ReviewText";
import {
  inspectCollectedProposalGroup,
  inspectCollectedProposalKind,
  inspectProposalGroup,
} from "./ReviewTargeting";
import type { ProposalKind } from "./ReviewTargeting";
import {
  collectProposalNodes,
  inspectCollectedFragmentGroup,
  type CollectedProposalNodes,
} from "./ReviewProposalCollection";
import type { LexicalNode, ParagraphNode, TextNode } from "lexical";

export type ProposalResolutionAction = "accept" | "reject" | "remove";

/** Find the live text behind an independent insertion or deletion identity. */
export function findProposal(
  proposalId: string,
  kind: "insertion" | "deletion",
): Preparation<{
  wrappers: ReviewElementNode[];
  paragraph: ParagraphNode;
  text: string;
}> {
  return findCollectedProposal(
    collectProposalNodes(proposalId),
    proposalId,
    kind,
  );
}

/** Text extraction read-only over one shared observation. */
export function findCollectedProposal(
  collected: CollectedProposalNodes,
  proposalId: string,
  kind: "insertion" | "deletion",
): Preparation<{
  wrappers: ReviewElementNode[];
  paragraph: ParagraphNode;
  text: string;
}> {
  const group = inspectCollectedProposalGroup(collected, proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind !== kind)
    return refusal(
      "unsupported-target",
      `The identity does not identify an independent ${kind} proposal.`,
    );
  const first = group.value.wrappers[0]!;
  const paragraph = first.getParent();
  if (!isRootParagraph(paragraph))
    return refusal("invalid-structural-target", "Expected a paragraph.");
  const nodes: TextNode[] = [];
  for (const wrapper of group.value.wrappers) {
    const children = getTextChildren(wrapper);
    if (children === null)
      return refusal(
        "invalid-structural-target",
        "A pending proposal contains unsupported live children.",
      );
    nodes.push(...children);
  }
  if (nodes.length === 0)
    return refusal(
      "invalid-structural-target",
      "A pending proposal must contain live text before it can be edited.",
    );
  return {
    status: "ready",
    value: {
      wrappers: group.value.wrappers,
      paragraph,
      text: nodes.map((node) => node.getTextContent()).join(""),
    },
  };
}

/** Resolve an independent insertion or deletion, keeping its text or not. */
export function resolveProposal(
  proposalId: string,
  retainText: boolean,
  kind: "insertion" | "deletion",
): ReviewIntentOutcome {
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind === "replacement")
    return resolveReplacement(
      proposalId,
      kind === "insertion" ? retainText : !retainText,
    );
  const prepared = findProposal(proposalId, kind);
  if (prepared.status !== "ready") return prepared;
  const { wrappers, paragraph } = prepared.value;
  const first = wrappers[0]!;
  const index = first.getIndexWithinParent();
  const retained = wrappers.flatMap(
    (wrapper) => getTextChildren(wrapper) ?? [],
  );
  const selection = $getSelection();
  const touchesProposal =
    $isRangeSelection(selection) &&
    [selection.anchor.key, selection.focus.key].some((key) =>
      wrappers.some(
        (node) => node.getKey() === key || node.getChildrenKeys().includes(key),
      ),
    );
  if (retainText) {
    for (const wrapper of wrappers) {
      for (const child of wrapper.getChildren()) wrapper.insertBefore(child);
      wrapper.remove();
    }
    if (touchesProposal) retained.at(-1)!.selectEnd();
  } else {
    for (const wrapper of wrappers) wrapper.remove();
    if (touchesProposal) paragraph.select(index, index);
  }
  return changed();
}

/** Resolve a replacement, keeping its new side or restoring its old side. */
export function resolveReplacement(
  proposalId: string,
  accept: boolean,
): ReviewIntentOutcome {
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  if (group.value.kind !== "replacement")
    return refusal(
      "unsupported-target",
      "The identity does not identify a replacement.",
    );
  const selection = $getSelection();
  const keys = new Set(
    group.value.wrappers.flatMap((node) => [
      node.getKey(),
      ...node.getChildrenKeys(),
    ]),
  );
  const touches =
    $isRangeSelection(selection) &&
    (keys.has(selection.anchor.key) || keys.has(selection.focus.key));
  let last: LexicalNode | undefined;
  for (const wrapper of group.value.wrappers) {
    if ($isReviewInsertionNode(wrapper) === accept) {
      for (const child of wrapper.getChildren()) {
        wrapper.insertBefore(child);
        last = child;
      }
    }
    wrapper.remove();
  }
  if (touches && $isTextNode(last)) last.selectEnd();
  return changed();
}

export type InspectedReviewProposal =
  | { kind: "insertion"; proposal: ReviewInsertionProposal }
  | { kind: "deletion"; proposal: ReviewDeletionProposal }
  | { kind: "replacement"; proposal: ReviewReplacementProposal }
  | { kind: "formatting"; proposal: ReviewFormattingProposal }
  | { kind: "structure"; proposal: ReviewStructuralProposal }
  | { kind: "fragment"; proposal: ReviewFragmentProposal };

/** Classify the live proposal behind an identity without a detached proposal registry. */
export function $inspectReviewProposal(
  proposalId: string,
): ReviewIntentOutcome<InspectedReviewProposal> {
  // One shared observation per read; the nested revalidation below reads
  // from it instead of recollecting. Order, gating, and translation match
  // the pre-spike sequence exactly.
  const collected = collectProposalNodes(proposalId);
  const fragment = inspectCollectedFragmentProposal(collected, proposalId);
  if (fragment.status === "unchanged")
    return {
      status: "unchanged",
      value: { kind: "fragment", proposal: fragment.value },
    };
  const boundary = inspectStructureProposal(proposalId);
  if (boundary.status === "unchanged")
    return {
      status: "unchanged",
      value: { kind: "structure", proposal: boundary.value },
    };
  const group = inspectCollectedProposalGroup(collected, proposalId);
  if (group.status !== "ready") return group;
  switch (group.value.kind) {
    case "fragment": {
      const retried = inspectCollectedFragmentProposal(collected, proposalId);
      if (retried.status === "unchanged")
        return {
          status: "unchanged",
          value: { kind: "fragment", proposal: retried.value },
        };
      if (retried.status === "changed")
        return {
          status: "changed",
          value: { kind: "fragment", proposal: retried.value },
        };
      return retried;
    }
    case "formatting": {
      const found = inspectCollectedFormattingProposal(collected, proposalId);
      if (found.status === "unchanged")
        return {
          status: "unchanged",
          value: { kind: "formatting", proposal: found.value },
        };
      if (found.status === "changed")
        return {
          status: "changed",
          value: { kind: "formatting", proposal: found.value },
        };
      return found;
    }
    case "insertion": {
      const prepared = findCollectedProposal(
        collected,
        proposalId,
        "insertion",
      );
      if (prepared.status !== "ready") return prepared;
      return {
        status: "unchanged",
        value: {
          kind: "insertion",
          proposal: { proposalId, text: prepared.value.text },
        },
      };
    }
    case "deletion": {
      const prepared = findCollectedProposal(collected, proposalId, "deletion");
      if (prepared.status !== "ready") return prepared;
      return {
        status: "unchanged",
        value: {
          kind: "deletion",
          proposal: { proposalId, text: prepared.value.text },
        },
      };
    }
    case "replacement":
      return {
        status: "unchanged",
        value: {
          kind: "replacement",
          proposal: {
            proposalId,
            oldText: group.value.wrappers
              .filter($isReviewDeletionNode)
              .map((node) => node.getTextContent())
              .join(""),
            newText: group.value.wrappers
              .filter($isReviewInsertionNode)
              .map((node) => node.getTextContent())
              .join(""),
          },
        },
      };
  }
}

/** Resolve one identity through the same validation as the batch. */
export function $resolveReviewProposal(
  proposalId: string,
  action: ProposalResolutionAction,
): ReviewIntentOutcome {
  return $resolveReviewProposals([proposalId], action);
}

type PreflightedGroup =
  | { id: string; kind: "fragment" }
  | { id: string; kind: "boundary" }
  | { id: string; kind: ProposalKind };

/**
 * Resolve each identity once, validating the entire batch before mutation.
 *
 * Contract (#59): strict preflight-then-mutate. Dedupe IDs by first-seen
 * input order and execute in that order. Any refusal during preflight means
 * zero mutations. The whole-tree structural check runs for every batch, not
 * only structural ones: a text-only batch must not commit while unrelated
 * structure is invalid. Unexpected implementation errors are not caught here;
 * they propagate to Lexical's update error handling, which discards the
 * pending update (see README). A per-ID mutation refusal after preflight
 * passed is unreachable for #58-admitted states; if it occurs on a
 * non-admitted state the batch stops at that ID and reports the refusal.
 */
export function $resolveReviewProposals(
  proposalIds: readonly string[],
  action: ProposalResolutionAction,
): ReviewIntentOutcome {
  if (!Array.isArray(proposalIds))
    return refusal(
      "invalid-proposal-id",
      "Expected an array of proposal identities.",
    );
  if ($getEditor().isComposing())
    return refusal(
      "unsupported-input",
      "Resolution is refused during composition.",
    );
  const groups: PreflightedGroup[] = [];
  for (const id of new Set(proposalIds)) {
    // Fragment and boundary checks come first because inspectProposalKind
    // reports those IDs as kind "fragment" without distinguishing the
    // structural marker. Fall through to inspectProposalKind for text kinds;
    // it is the single source of invalid-proposal-id vs unsupported-target.
    // One shared observation per ID covers the fragment and kind checks;
    // structural inspection keeps its own scope and the mutations below
    // re-observe through owner revalidation.
    const collected = collectProposalNodes(id);
    const fragment = inspectCollectedFragmentGroup(collected);
    if (fragment.status === "ready") {
      groups.push({ id, kind: "fragment" });
      continue;
    }
    const boundary = inspectBoundary(id);
    if (boundary.status === "ready") {
      groups.push({ id, kind: "boundary" });
      continue;
    }
    const kind = inspectCollectedProposalKind(collected, id);
    if (kind.status !== "ready") return kind;
    groups.push({ id, kind: kind.value });
  }
  if (!groups.length) return unchanged();
  const invalid = validateStructuralState();
  if (invalid) return invalid;
  for (const { id, kind } of groups) {
    const outcome =
      kind === "fragment"
        ? action === "accept"
          ? resolveFragment(id, true)
          : resolveFragment(id, false)
        : kind === "boundary"
          ? action === "accept"
            ? resolveStructure(id, true)
            : resolveStructure(id, false)
          : kind === "formatting"
            ? action === "accept"
              ? resolveFormatting(id, true)
              : resolveFormatting(id, false)
            : kind === "replacement"
              ? resolveReplacement(id, action === "accept")
              : resolveProposal(
                  id,
                  kind === "insertion"
                    ? action === "accept"
                    : action !== "accept",
                  kind,
                );
    if (outcome.status !== "changed") return outcome;
  }
  return changed();
}
