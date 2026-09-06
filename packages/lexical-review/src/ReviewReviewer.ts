import {
  $getRoot,
  $isTextNode,
  type ParagraphNode,
  type TextNode,
} from "lexical";
import {
  $isReviewBoundaryNode,
  type ReviewBoundaryNode,
} from "./ReviewBoundaryNode";
import {
  $isReviewDeletionNode,
  $isReviewFormattingNode,
  $isReviewFragmentNode,
  $isReviewInsertionNode,
  getTextChildren,
  isReviewElementNode,
  isRootParagraph,
  type ReviewElementNode,
} from "./ReviewNodes";
import {
  canonicalFormatRuns,
  type ReviewFormatRun,
} from "./ReviewFormattingState";
import { inspectFormattingProposal } from "./ReviewFormatting";
import { inspectFragmentProposal } from "./ReviewFragment";
import { findProposal } from "./ReviewResolution";
import { inspectBoundary, validateStructuralState } from "./ReviewStructure";
import { inspectProposalGroup } from "./ReviewTargeting";
import {
  refusal,
  type Preparation,
  type ReviewIntentRefusal,
} from "./ReviewIntent";

/**
 * Reviewer primitives (#60).
 *
 * Live-state reads over current proposal-bearing nodes. Every function is
 * side-effect-free: no mutation of content, pending work, projection,
 * selection, focus, or scroll. Returned values are detached readonly plain
 * data reflecting call-time state; the package holds no cache and hosts
 * refresh by re-calling on each commit. `$`-prefixed functions must run
 * inside `editor.read()` (or an update); the neighbour lookups are pure and
 * take an explicit list. Kind-specific `$inspectReviewProposal` stays owned
 * by #59; this module adds the unified snapshot, ordering, and previews.
 */

export type ReviewerProposalKind =
  | "insertion"
  | "deletion"
  | "replacement"
  | "formatting"
  | "split"
  | "merge"
  | "fragment";

export type ReviewProposalAttachment = Readonly<{
  /** Index of the host paragraph among root children at call time. */
  paragraphIndex: number;
  /** Index of the anchoring component within its paragraph at call time. */
  childIndex: number;
}>;

type SnapshotBase = Readonly<{
  proposalId: string;
  attachment: ReviewProposalAttachment;
}>;

export type ReviewProposalSnapshot =
  | (SnapshotBase & {
      kind: "insertion";
      content: Readonly<{
        text: string;
        runs: readonly ReviewFormatRun[];
      }>;
    })
  | (SnapshotBase & {
      kind: "deletion";
      content: Readonly<{
        text: string;
        runs: readonly ReviewFormatRun[];
      }>;
    })
  | (SnapshotBase & {
      kind: "replacement";
      content: Readonly<{
        oldText: string;
        newText: string;
        oldRuns: readonly ReviewFormatRun[];
        newRuns: readonly ReviewFormatRun[];
      }>;
    })
  | (SnapshotBase & {
      kind: "formatting";
      content: Readonly<{
        accepted: readonly ReviewFormatRun[];
        current: readonly ReviewFormatRun[];
      }>;
    })
  | (SnapshotBase & {
      kind: "split";
      content: Readonly<{ kind: "split" }>;
    })
  | (SnapshotBase & {
      kind: "merge";
      content: Readonly<{ kind: "merge" }>;
    })
  | (SnapshotBase & {
      kind: "fragment";
      content: Readonly<{
        paragraphs: ReadonlyArray<{
          runs: readonly ReviewFormatRun[];
          emptyFormat?: number;
        }>;
      }>;
    });

export type ReviewPreviewSnapshot = Readonly<{
  paragraphs: readonly string[];
}>;

function attachmentOf(node: ReviewElementNode | ReviewBoundaryNode) {
  const paragraph = node.getParent();
  if (!isRootParagraph(paragraph))
    return refusal(
      "invalid-structural-target",
      "The pending proposal is not attached to a root paragraph.",
    );
  return {
    status: "ready" as const,
    value: {
      paragraphIndex: paragraph.getIndexWithinParent(),
      childIndex: node.getIndexWithinParent(),
    } satisfies ReviewProposalAttachment,
  };
}

function textRuns(nodes: readonly TextNode[]): ReviewFormatRun[] {
  return canonicalFormatRuns(
    nodes.map((node) => ({
      text: node.getTextContent(),
      format: node.getFormat(),
    })),
  );
}

function wrapperRuns(
  wrappers: readonly ReviewElementNode[],
  filter: (node: ReviewElementNode) => boolean,
): TextNode[] | null {
  const nodes: TextNode[] = [];
  for (const wrapper of wrappers) {
    if (!filter(wrapper)) continue;
    const children = getTextChildren(wrapper);
    if (children === null) return null;
    nodes.push(...children);
  }
  return nodes;
}

function anchorOf(
  wrappers: readonly ReviewElementNode[],
): Preparation<ReviewElementNode> {
  const anchor = wrappers[0];
  if (!anchor)
    return refusal(
      "unsupported-target",
      "The pending proposal was not found in a supported paragraph.",
    );
  return { status: "ready", value: anchor };
}

/**
 * List pending proposal identities in deterministic document order: root
 * paragraph index, then child index, one entry per identity at its first
 * component. Multi-node identities (replacement sides, fragment components)
 * anchor at their earliest node; split markers sort at their boundary point
 * because they lead their right paragraph. Pure walk, infallible, available
 * during composition.
 */
export function $listReviewProposals(): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const paragraph of $getRoot().getChildren()) {
    if (!isRootParagraph(paragraph)) continue;
    for (const child of paragraph.getChildren()) {
      if (!isReviewElementNode(child) && !$isReviewBoundaryNode(child))
        continue;
      const proposalId = child.getProposalId();
      if (seen.has(proposalId)) continue;
      seen.add(proposalId);
      ids.push(proposalId);
    }
  }
  return ids;
}

/**
 * Neighbour lookup over an explicit list from `$listReviewProposals`. `null`
 * means the positional edge (`getNext` returns the first identity, `getPrev`
 * the last). Empty lists, end-of-list positions, and unknown/malformed/
 * resolved identities all return `null`, never a refusal. No wrapping, no
 * focus or selection access; wrapping is host policy.
 */
export function getNextProposal(
  proposalIds: readonly string[],
  currentId: string | null,
): string | null {
  if (currentId === null) return proposalIds[0] ?? null;
  const index = proposalIds.indexOf(currentId);
  return index === -1 ? null : (proposalIds[index + 1] ?? null);
}

/** Previous-identity counterpart of `getNextProposal`. */
export function getPrevProposal(
  proposalIds: readonly string[],
  currentId: string | null,
): string | null {
  if (currentId === null) return proposalIds.at(-1) ?? null;
  const index = proposalIds.indexOf(currentId);
  return index <= 0 ? null : (proposalIds[index - 1] ?? null);
}

/**
 * Detached inspection of one pending proposal under its current kind at call
 * time (post-continuation, post-correction, post-normalization). Available
 * during composition. Malformed identities refuse `invalid-proposal-id`;
 * unknown, resolved, or disconnected identities refuse `unsupported-target`;
 * structurally invalid trees refuse `invalid-structural-target` /
 * `unsafe-proposal-intersection` as today.
 */
export function $inspectReviewProposalSnapshot(
  proposalId: string,
): Preparation<ReviewProposalSnapshot> {
  const fragment = inspectFragmentProposal(proposalId);
  if (fragment.status === "unchanged" || fragment.status === "changed") {
    const group = inspectProposalGroup(proposalId);
    if (group.status !== "ready") return group;
    const anchored = anchorOf(group.value.wrappers);
    if (anchored.status !== "ready") return anchored;
    const attachment = attachmentOf(anchored.value);
    if (attachment.status !== "ready") return attachment;
    return {
      status: "ready",
      value: {
        proposalId,
        attachment: attachment.value,
        kind: "fragment",
        content: { paragraphs: fragment.value.paragraphs },
      },
    };
  }
  if (fragment.status === "failed") throw new Error(fragment.error.message);
  const boundary = inspectBoundary(proposalId);
  if (boundary.status === "ready") {
    const attachment = attachmentOf(boundary.value);
    if (attachment.status !== "ready") return attachment;
    if (boundary.value.getKind() === "split")
      return {
        status: "ready",
        value: {
          proposalId,
          attachment: attachment.value,
          kind: "split",
          content: { kind: "split" },
        },
      };
    return {
      status: "ready",
      value: {
        proposalId,
        attachment: attachment.value,
        kind: "merge",
        content: { kind: "merge" },
      },
    };
  }
  if (boundary.status === "refused" && boundary.code !== "unsupported-target")
    return boundary;
  const group = inspectProposalGroup(proposalId);
  if (group.status !== "ready") return group;
  const anchored = anchorOf(group.value.wrappers);
  if (anchored.status !== "ready") return anchored;
  const attachment = attachmentOf(anchored.value);
  if (attachment.status !== "ready") return attachment;
  switch (group.value.kind) {
    case "fragment": {
      const retried = inspectFragmentProposal(proposalId);
      if (retried.status !== "unchanged" && retried.status !== "changed")
        return retried.status === "refused"
          ? retried
          : refusal("invalid-structural-target", retried.error.message);
      return {
        status: "ready",
        value: {
          proposalId,
          attachment: attachment.value,
          kind: "fragment",
          content: { paragraphs: retried.value.paragraphs },
        },
      };
    }
    case "formatting": {
      const found = inspectFormattingProposal(proposalId);
      if (found.status !== "unchanged" && found.status !== "changed")
        return found.status === "refused"
          ? found
          : refusal("invalid-structural-target", found.error.message);
      return {
        status: "ready",
        value: {
          proposalId,
          attachment: attachment.value,
          kind: "formatting",
          content: {
            accepted: found.value.accepted,
            current: found.value.current,
          },
        },
      };
    }
    case "insertion":
    case "deletion": {
      const kind = group.value.kind;
      const prepared = findProposal(proposalId, kind);
      if (prepared.status !== "ready") return prepared;
      const nodes = wrapperRuns(prepared.value.wrappers, () => true);
      if (nodes === null)
        return refusal(
          "invalid-structural-target",
          "A pending proposal contains unsupported live children.",
        );
      const runs = textRuns(nodes);
      return {
        status: "ready",
        value: {
          proposalId,
          attachment: attachment.value,
          kind,
          content: { text: prepared.value.text, runs },
        },
      };
    }
    case "replacement": {
      const oldNodes = wrapperRuns(group.value.wrappers, $isReviewDeletionNode);
      const newNodes = wrapperRuns(
        group.value.wrappers,
        $isReviewInsertionNode,
      );
      if (oldNodes === null || newNodes === null)
        return refusal(
          "invalid-structural-target",
          "A pending proposal contains unsupported live children.",
        );
      const oldRuns = textRuns(oldNodes);
      const newRuns = textRuns(newNodes);
      return {
        status: "ready",
        value: {
          proposalId,
          attachment: attachment.value,
          kind: "replacement",
          content: {
            oldText: oldRuns.map((run) => run.text).join(""),
            newText: newRuns.map((run) => run.text).join(""),
            oldRuns,
            newRuns,
          },
        },
      };
    }
  }
}

/**
 * Derive accepted-state and all-accepted plain-text paragraphs from current
 * nodes without mutating live state, exporting, or resolving. Insertions and
 * fragment payloads appear only in the all-accepted text; deletions and
 * replacement old sides appear only in the accepted-state text; formatting
 * keeps its text in both. Split markers join their paragraphs in the
 * accepted-state text; merge markers divide theirs; fragment-owned breaks
 * (a component with `startsParagraph`) join in the accepted-state text.
 */
function buildPreviewParagraphs(): {
  accepted: string[];
  allAccepted: string[];
} {
  const accepted: string[] = [];
  const allAccepted: string[] = [];
  for (const paragraph of $getRoot().getChildren<ParagraphNode>()) {
    if (!isRootParagraph(paragraph)) continue;
    const children = paragraph.getChildren();
    const first = children[0];
    const joinPrevious =
      ($isReviewBoundaryNode(first) && first.getKind() === "split") ||
      ($isReviewFragmentNode(first) && first.startsParagraph());
    let acceptedHead = "";
    let acceptedTail: string | null = null;
    let allText = "";
    for (const child of children) {
      if ($isReviewBoundaryNode(child)) {
        if (child.getKind() === "merge" && acceptedTail === null)
          acceptedTail = "";
        continue;
      }
      const pushAccepted = (value: string) => {
        if (acceptedTail === null) acceptedHead += value;
        else acceptedTail += value;
      };
      if ($isTextNode(child)) {
        const value = child.getTextContent();
        pushAccepted(value);
        allText += value;
      } else if (isReviewElementNode(child)) {
        const value = child.getTextContent();
        if ($isReviewInsertionNode(child)) allText += value;
        else if ($isReviewDeletionNode(child)) pushAccepted(value);
        else if ($isReviewFormattingNode(child)) {
          pushAccepted(value);
          allText += value;
        } else if ($isReviewFragmentNode(child)) allText += value;
      }
    }
    if (joinPrevious && accepted.length > 0)
      accepted[accepted.length - 1] += acceptedHead;
    else accepted.push(acceptedHead);
    if (acceptedTail !== null) accepted.push(acceptedTail);
    allAccepted.push(allText);
  }
  return { accepted, allAccepted };
}

function previewGatekeeper(): null | ReviewIntentRefusal {
  const invalid = validateStructuralState();
  if (!invalid) return null;
  if (invalid.status === "refused") return invalid;
  throw new Error(
    invalid.status === "failed"
      ? invalid.error.message
      : "Preview could not be determined.",
  );
}

/**
 * Read-only accepted-state outcome snapshot: current accepted content with
 * pending work set aside. Returns a refusal on structurally invalid trees
 * (and during composition); never throws for gating, never mutates.
 */
export function $previewAcceptedState(): Preparation<ReviewPreviewSnapshot> {
  const blocked = previewGatekeeper();
  if (blocked) return blocked;
  return {
    status: "ready",
    value: { paragraphs: buildPreviewParagraphs().accepted },
  };
}

/**
 * Read-only all-accepted outcome snapshot: the document outcome that would
 * result from accepting every pending proposal, without resolving anything.
 * Throws when the outcome cannot be determined (invalid tree or active
 * composition), per the interaction contract; never mutates live state.
 */
export function $previewAllAccepted(): ReviewPreviewSnapshot {
  const blocked = previewGatekeeper();
  if (blocked)
    throw new Error(
      `All-accepted preview could not be determined: ${blocked.code} ${blocked.message}`,
    );
  return { paragraphs: buildPreviewParagraphs().allAccepted };
}
