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
  inspectFragment,
  inspectFragmentProposal,
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
  inspectFormattingProposal,
  resolveFormatting,
  type ReviewFormattingProposal,
} from "./ReviewFormatting";
import type {
  ReviewDeletionProposal,
  ReviewInsertionProposal,
  ReviewReplacementProposal,
} from "./ReviewText";
import { inspectProposalGroup, inspectProposalKind } from "./ReviewTargeting";
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
  const group = inspectProposalGroup(proposalId);
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
  const fragment = inspectFragmentProposal(proposalId);
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
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  switch (group.value.kind) {
    case "fragment": {
      const retried = inspectFragmentProposal(proposalId);
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
      const found = inspectFormattingProposal(proposalId);
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
      const prepared = findProposal(proposalId, "insertion");
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
      const prepared = findProposal(proposalId, "deletion");
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

/** Resolve each identity once, validating the entire batch before mutation. */
export function $resolveReviewProposals(
  proposalIds: readonly string[],
  action: ProposalResolutionAction,
): ReviewIntentOutcome {
  if ($getEditor().isComposing())
    return refusal(
      "unsupported-input",
      "Resolution is refused during composition.",
    );
  const groups = [];
  for (const id of new Set(proposalIds)) {
    const fragment = inspectFragment(id);
    if (fragment.status === "ready") {
      groups.push({ id, kind: "fragment" as const });
      continue;
    }
    const boundary = inspectBoundary(id);
    if (boundary.status === "ready") {
      groups.push({ id, kind: "boundary" as const });
      continue;
    }
    const kind = inspectProposalKind(id);
    if (kind.status !== "ready") return kind;
    groups.push({ id, kind: kind.value });
  }
  if (
    groups.some(
      (group) => group.kind === "boundary" || group.kind === "fragment",
    )
  ) {
    const invalid = validateStructuralState();
    if (invalid) return invalid;
  }
  for (const { id, kind } of groups) {
    if (kind === "fragment") {
      if (action === "accept") resolveFragment(id, true);
      else resolveFragment(id, false);
    } else if (kind === "boundary") {
      if (action === "accept") resolveStructure(id, true);
      else resolveStructure(id, false);
    } else if (kind === "formatting") {
      if (action === "accept") resolveFormatting(id, true);
      else resolveFormatting(id, false);
    } else if (kind === "replacement")
      resolveReplacement(id, action === "accept");
    else
      resolveProposal(
        id,
        kind === "insertion" ? action === "accept" : action !== "accept",
        kind,
      );
  }
  return groups.length ? changed() : unchanged();
}
