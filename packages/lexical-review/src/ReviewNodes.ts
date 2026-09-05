import {
  $applyNodeReplacement,
  type EditorConfig,
  ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import { addClassNamesToElement } from "@lexical/utils";
import { assertValidProposalId, createProposalId } from "./ProposalIdentity";

import {
  isValidFormatRuns,
  type ReviewFormatRun,
} from "./ReviewFormattingState";

type SerializedReviewElementNode = Spread<
  {
    extensions: readonly [];
    proposalId: string;
  },
  SerializedElementNode
>;

export type SerializedReviewInsertionNode = SerializedReviewElementNode & {
  type: "review-insertion";
};

export type SerializedReviewDeletionNode = SerializedReviewElementNode & {
  type: "review-deletion";
};

export abstract class ReviewElementNode extends ElementNode {
  __proposalId: string;

  constructor(proposalId: string, key?: NodeKey) {
    super(key);
    assertValidProposalId(proposalId);
    this.__proposalId = proposalId;
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__proposalId = prevNode.__proposalId;
  }

  override updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedReviewElementNode>,
  ): this {
    super.updateFromJSON(serializedNode);
    assertValidProposalId(serializedNode.proposalId);
    const self = this.getWritable();
    self.__proposalId = serializedNode.proposalId;
    return self;
  }

  getProposalId(): string {
    return this.getLatest().__proposalId;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override canBeEmpty(): false {
    return false;
  }

  override isInline(): true {
    return true;
  }

  override splice(
    start: number,
    deleteCount: number,
    nodesToInsert: LexicalNode[],
  ): this {
    if (nodesToInsert.some((node) => node.getType() !== "text")) {
      throw new Error("Review proposal wrappers support text children only.");
    }
    return super.splice(start, deleteCount, nodesToInsert);
  }

  override updateDOM(): false {
    return false;
  }

  protected abstract getReviewTag(): "ins" | "del" | "span";

  override createDOM(config: EditorConfig): HTMLElement {
    const tag = this.getReviewTag();
    const element = document.createElement(tag);
    addClassNamesToElement(
      element,
      tag === "span" ? undefined : config.theme[tag],
    );
    return element;
  }
}

export class ReviewInsertionNode extends ReviewElementNode {
  static override getType(): string {
    return "review-insertion";
  }

  static override clone(node: ReviewInsertionNode): ReviewInsertionNode {
    return new ReviewInsertionNode(node.__proposalId, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedReviewInsertionNode,
  ): ReviewInsertionNode {
    return $createReviewInsertionNode(serializedNode.proposalId).updateFromJSON(
      serializedNode,
    );
  }

  protected override getReviewTag(): "ins" {
    return "ins";
  }

  override exportJSON(): SerializedReviewInsertionNode {
    return {
      ...super.exportJSON(),
      extensions: [],
      type: "review-insertion",
      proposalId: this.getProposalId(),
    };
  }
}

export class ReviewDeletionNode extends ReviewElementNode {
  static override getType(): string {
    return "review-deletion";
  }

  static override clone(node: ReviewDeletionNode): ReviewDeletionNode {
    return new ReviewDeletionNode(node.__proposalId, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedReviewDeletionNode,
  ): ReviewDeletionNode {
    return $createReviewDeletionNode(serializedNode.proposalId).updateFromJSON(
      serializedNode,
    );
  }

  protected override getReviewTag(): "del" {
    return "del";
  }

  override exportJSON(): SerializedReviewDeletionNode {
    return {
      ...super.exportJSON(),
      extensions: [],
      type: "review-deletion",
      proposalId: this.getProposalId(),
    };
  }
}

export function $createReviewInsertionNode(
  proposalId: string = createProposalId(),
): ReviewInsertionNode {
  return $applyNodeReplacement(new ReviewInsertionNode(proposalId));
}

export function $createReviewDeletionNode(
  proposalId: string,
): ReviewDeletionNode {
  return $applyNodeReplacement(new ReviewDeletionNode(proposalId));
}

export function $isReviewInsertionNode(
  node: LexicalNode | null | undefined,
): node is ReviewInsertionNode {
  return node instanceof ReviewInsertionNode;
}

export function $isReviewDeletionNode(
  node: LexicalNode | null | undefined,
): node is ReviewDeletionNode {
  return node instanceof ReviewDeletionNode;
}

export function $canReviewElementNodesBeMerged(
  node1: ReviewElementNode,
  node2: ReviewElementNode,
): boolean {
  return (
    !$isReviewFormattingNode(node1) &&
    node1.getType() === node2.getType() &&
    node1.getProposalId() === node2.getProposalId()
  );
}

export type SerializedReviewFormattingNode = SerializedReviewElementNode & {
  type: "review-formatting";
  accepted: readonly ReviewFormatRun[];
};

export class ReviewFormattingNode extends ReviewElementNode {
  __accepted: readonly ReviewFormatRun[];

  constructor(
    proposalId: string,
    accepted: readonly ReviewFormatRun[],
    key?: NodeKey,
  ) {
    super(proposalId, key);
    if (!isValidFormatRuns(accepted))
      throw new Error("Invalid accepted formatting runs.");
    this.__accepted = Object.freeze(
      accepted.map((run) => Object.freeze({ ...run })),
    );
  }

  static override getType(): string {
    return "review-formatting";
  }
  static override clone(node: ReviewFormattingNode): ReviewFormattingNode {
    return new ReviewFormattingNode(
      node.__proposalId,
      node.__accepted,
      node.__key,
    );
  }
  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__accepted = prevNode.__accepted;
  }
  getAcceptedFormats(): readonly ReviewFormatRun[] {
    return this.getLatest().__accepted;
  }
  static override importJSON(
    node: SerializedReviewFormattingNode,
  ): ReviewFormattingNode {
    return $createReviewFormattingNode(
      node.proposalId,
      node.accepted,
    ).updateFromJSON(node);
  }
  override updateFromJSON(
    node: LexicalUpdateJSON<SerializedReviewFormattingNode>,
  ): this {
    if (!isValidFormatRuns(node.accepted))
      throw new Error("Invalid accepted formatting runs.");
    super.updateFromJSON(node);
    this.getWritable().__accepted = Object.freeze(
      node.accepted.map((run) => Object.freeze({ ...run })),
    );
    return this;
  }
  protected override getReviewTag(): "span" {
    return "span";
  }
  override createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.dataset.reviewFormatting = "";
    return element;
  }
  override exportJSON(): SerializedReviewFormattingNode {
    return {
      ...super.exportJSON(),
      type: "review-formatting",
      proposalId: this.getProposalId(),
      extensions: [],
      accepted: this.getAcceptedFormats().map((run) => ({ ...run })),
    };
  }
}

export function $createReviewFormattingNode(
  proposalId: string,
  accepted: readonly ReviewFormatRun[],
): ReviewFormattingNode {
  return $applyNodeReplacement(new ReviewFormattingNode(proposalId, accepted));
}
export function $isReviewFormattingNode(
  node: LexicalNode | null | undefined,
): node is ReviewFormattingNode {
  return node instanceof ReviewFormattingNode;
}
