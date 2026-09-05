import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import { assertValidProposalId } from "./ProposalIdentity";
import { isSupportedFormat } from "./ReviewFormattingState";

export type ReviewBoundaryKind = "split" | "merge";
export type SerializedReviewBoundaryNode = SerializedLexicalNode & {
  type: "review-boundary";
  proposalId: string;
  kind: ReviewBoundaryKind;
  leftFormat: number;
  rightFormat: number;
  extensions: readonly [];
};

/** A split is the first child of its right paragraph; a merge retains an inline seam. */
export class ReviewBoundaryNode extends DecoratorNode<null> {
  __proposalId: string;
  __kind: ReviewBoundaryKind;
  __leftFormat: number;
  __rightFormat: number;

  constructor(
    proposalId: string,
    kind: ReviewBoundaryKind,
    leftFormat = 0,
    rightFormat = 0,
    key?: NodeKey,
  ) {
    super(key);
    assertValidProposalId(proposalId);
    if (
      (kind !== "split" && kind !== "merge") ||
      !isSupportedFormat(leftFormat) ||
      !isSupportedFormat(rightFormat)
    )
      throw new Error("Invalid review boundary.");
    this.__proposalId = proposalId;
    this.__kind = kind;
    this.__leftFormat = leftFormat;
    this.__rightFormat = rightFormat;
  }
  static override getType(): string {
    return "review-boundary";
  }
  static override clone(node: ReviewBoundaryNode): ReviewBoundaryNode {
    return new ReviewBoundaryNode(
      node.__proposalId,
      node.__kind,
      node.__leftFormat,
      node.__rightFormat,
      node.__key,
    );
  }
  override afterCloneFrom(node: this): void {
    super.afterCloneFrom(node);
    this.__proposalId = node.__proposalId;
    this.__kind = node.__kind;
    this.__leftFormat = node.__leftFormat;
    this.__rightFormat = node.__rightFormat;
  }
  getProposalId(): string {
    return this.getLatest().__proposalId;
  }
  getKind(): ReviewBoundaryKind {
    return this.getLatest().__kind;
  }
  getSideFormat(side: "left" | "right"): number {
    const node = this.getLatest();
    return side === "left" ? node.__leftFormat : node.__rightFormat;
  }
  static override importJSON(
    node: SerializedReviewBoundaryNode,
  ): ReviewBoundaryNode {
    return $createReviewBoundaryNode(
      node.proposalId,
      node.kind,
      node.leftFormat,
      node.rightFormat,
    ).updateFromJSON(node);
  }
  override updateFromJSON(
    node: LexicalUpdateJSON<SerializedReviewBoundaryNode>,
  ): this {
    assertValidProposalId(node.proposalId);
    if (
      (node.kind !== "split" && node.kind !== "merge") ||
      !isSupportedFormat(node.leftFormat) ||
      !isSupportedFormat(node.rightFormat)
    )
      throw new Error("Invalid review boundary.");
    super.updateFromJSON(node);
    const self = this.getWritable();
    self.__proposalId = node.proposalId;
    self.__kind = node.kind;
    self.__leftFormat = node.leftFormat;
    self.__rightFormat = node.rightFormat;
    return self;
  }
  override exportJSON(): SerializedReviewBoundaryNode {
    return {
      ...super.exportJSON(),
      type: "review-boundary",
      proposalId: this.getProposalId(),
      kind: this.getKind(),
      leftFormat: this.getSideFormat("left"),
      rightFormat: this.getSideFormat("right"),
      extensions: [],
    };
  }
  override createDOM(): HTMLElement {
    const dom = document.createElement(
      this.getKind() === "split" ? "ins" : "del",
    );
    dom.dataset.reviewBoundary = this.getKind();
    dom.dataset.proposalId = this.getProposalId();
    dom.setAttribute("contenteditable", "false");
    dom.textContent = "¶";
    dom.title =
      this.getKind() === "split"
        ? "Pending paragraph split"
        : "Pending paragraph merge";
    dom.setAttribute("aria-label", dom.title);
    return dom;
  }
  override updateDOM(previous: ReviewBoundaryNode): boolean {
    return (
      previous.__kind !== this.__kind ||
      previous.__proposalId !== this.__proposalId
    );
  }
  override getTextContent(): string {
    return "";
  }
  override isKeyboardSelectable(): boolean {
    return false;
  }
}

export function $createReviewBoundaryNode(
  proposalId: string,
  kind: ReviewBoundaryKind,
  leftFormat = 0,
  rightFormat = 0,
): ReviewBoundaryNode {
  return $applyNodeReplacement(
    new ReviewBoundaryNode(proposalId, kind, leftFormat, rightFormat),
  );
}
export function $isReviewBoundaryNode(
  node: LexicalNode | null | undefined,
): node is ReviewBoundaryNode {
  return node instanceof ReviewBoundaryNode;
}
