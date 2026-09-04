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
import { assertValidProposalId } from "./ProposalIdentity";

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

  protected abstract getReviewTag(): "ins" | "del";

  override createDOM(config: EditorConfig): HTMLElement {
    const tag = this.getReviewTag();
    const element = document.createElement(tag);
    addClassNamesToElement(element, config.theme[tag]);
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
  proposalId: string,
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
    node1.getType() === node2.getType() &&
    node1.getProposalId() === node2.getProposalId()
  );
}
