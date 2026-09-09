import {
  $applyNodeReplacement,
  $getRoot,
  $isParagraphNode,
  $isTextNode,
  type EditorConfig,
  ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type ParagraphNode,
  type SerializedElementNode,
  type Spread,
  type TextNode,
} from "lexical";
import { addClassNamesToElement } from "@lexical/utils";
import { assertValidProposalId, createProposalId } from "./ProposalIdentity";
import {
  cloneExtensionEnvelopes,
  readStoredExtensions,
  sameExtensionSets,
  type ReviewExtensionEnvelope,
} from "./ReviewExtensionEnvelope";

import {
  isValidFormatRuns,
  type ReviewFormatRun,
} from "./ReviewFormattingState";

type SerializedReviewElementNode = Spread<
  {
    extensions: readonly ReviewExtensionEnvelope[];
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
  __extensions: readonly ReviewExtensionEnvelope[];

  constructor(
    proposalId: string,
    extensions: readonly ReviewExtensionEnvelope[] = [],
    key?: NodeKey,
  ) {
    super(key);
    assertValidProposalId(proposalId);
    this.__proposalId = proposalId;
    this.__extensions = Object.freeze(cloneExtensionEnvelopes(extensions));
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__proposalId = prevNode.__proposalId;
    this.__extensions = prevNode.__extensions;
  }

  override updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedReviewElementNode>,
  ): this {
    super.updateFromJSON(serializedNode);
    assertValidProposalId(serializedNode.proposalId);
    const self = this.getWritable();
    self.__proposalId = serializedNode.proposalId;
    self.__extensions = Object.freeze(
      readStoredExtensions(serializedNode.extensions),
    );
    return self;
  }

  getProposalId(): string {
    return this.getLatest().__proposalId;
  }

  /** Opaque envelopes carried for the whole proposal identity (#63). */
  getExtensions(): readonly ReviewExtensionEnvelope[] {
    return this.getLatest().__extensions;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override canBeEmpty(): boolean {
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
    return new ReviewInsertionNode(
      node.__proposalId,
      node.__extensions,
      node.__key,
    );
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
      extensions: cloneExtensionEnvelopes(this.getExtensions()),
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
    return new ReviewDeletionNode(
      node.__proposalId,
      node.__extensions,
      node.__key,
    );
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
      extensions: cloneExtensionEnvelopes(this.getExtensions()),
      type: "review-deletion",
      proposalId: this.getProposalId(),
    };
  }
}

export function $createReviewInsertionNode(
  proposalId: string = createProposalId(),
  extensions: readonly ReviewExtensionEnvelope[] = [],
): ReviewInsertionNode {
  return $applyNodeReplacement(new ReviewInsertionNode(proposalId, extensions));
}

export function $createReviewDeletionNode(
  proposalId: string,
  extensions: readonly ReviewExtensionEnvelope[] = [],
): ReviewDeletionNode {
  return $applyNodeReplacement(new ReviewDeletionNode(proposalId, extensions));
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
    !$isReviewFragmentNode(node1) &&
    node1.getType() === node2.getType() &&
    node1.getProposalId() === node2.getProposalId() &&
    // Divergent same-ID wrappers stay separate so export validation surfaces
    // the ownership violation instead of the merge silently resolving it.
    sameExtensionSets(node1.getExtensions(), node2.getExtensions())
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
    extensions: readonly ReviewExtensionEnvelope[] = [],
    key?: NodeKey,
  ) {
    super(proposalId, extensions, key);
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
      node.__extensions,
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
      extensions: cloneExtensionEnvelopes(this.getExtensions()),
      accepted: this.getAcceptedFormats().map((run) => ({ ...run })),
    };
  }
}

export function $createReviewFormattingNode(
  proposalId: string,
  accepted: readonly ReviewFormatRun[],
  extensions: readonly ReviewExtensionEnvelope[] = [],
): ReviewFormattingNode {
  return $applyNodeReplacement(
    new ReviewFormattingNode(proposalId, accepted, extensions),
  );
}
export function $isReviewFormattingNode(
  node: LexicalNode | null | undefined,
): node is ReviewFormattingNode {
  return node instanceof ReviewFormattingNode;
}

/** One paragraph-local component; startsParagraph owns the boundary before it. */
export type SerializedReviewFragmentNode = SerializedReviewElementNode & {
  type: "review-fragment";
  startsParagraph: boolean;
  emptyFormat: number;
};
export class ReviewFragmentNode extends ReviewElementNode {
  __startsParagraph: boolean;
  __emptyFormat: number;
  constructor(
    proposalId: string,
    startsParagraph = false,
    emptyFormat = 0,
    extensions: readonly ReviewExtensionEnvelope[] = [],
    key?: NodeKey,
  ) {
    super(proposalId, extensions, key);
    if (
      typeof startsParagraph !== "boolean" ||
      !Number.isInteger(emptyFormat) ||
      emptyFormat < 0 ||
      emptyFormat > 15
    )
      throw new Error("Invalid fragment component metadata.");
    this.__startsParagraph = startsParagraph;
    this.__emptyFormat = emptyFormat;
  }
  static override getType(): string {
    return "review-fragment";
  }
  static override clone(node: ReviewFragmentNode): ReviewFragmentNode {
    return new ReviewFragmentNode(
      node.__proposalId,
      node.__startsParagraph,
      node.__emptyFormat,
      node.__extensions,
      node.__key,
    );
  }
  override afterCloneFrom(node: this): void {
    super.afterCloneFrom(node);
    this.__startsParagraph = node.__startsParagraph;
    this.__emptyFormat = node.__emptyFormat;
  }
  startsParagraph(): boolean {
    return this.getLatest().__startsParagraph;
  }
  getEmptyFormat(): number {
    return this.getLatest().__emptyFormat;
  }
  override canBeEmpty(): boolean {
    return true;
  }
  protected override getReviewTag(): "ins" {
    return "ins";
  }
  override createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.dataset.reviewFragment = this.getProposalId();
    if (this.startsParagraph()) dom.dataset.reviewFragmentBoundary = "";
    return dom;
  }
  static override importJSON(
    node: SerializedReviewFragmentNode,
  ): ReviewFragmentNode {
    return $createReviewFragmentNode(
      node.proposalId,
      node.startsParagraph,
      node.emptyFormat,
    ).updateFromJSON(node);
  }
  override updateFromJSON(
    node: LexicalUpdateJSON<SerializedReviewFragmentNode>,
  ): this {
    super.updateFromJSON(node);
    if (
      typeof node.startsParagraph !== "boolean" ||
      !Number.isInteger(node.emptyFormat) ||
      node.emptyFormat < 0 ||
      (node.emptyFormat & ~15) !== 0
    )
      throw new Error("Invalid fragment component metadata.");
    const self = this.getWritable();
    self.__startsParagraph = node.startsParagraph;
    self.__emptyFormat = node.emptyFormat;
    return self;
  }
  override exportJSON(): SerializedReviewFragmentNode {
    return {
      ...super.exportJSON(),
      type: "review-fragment",
      proposalId: this.getProposalId(),
      extensions: cloneExtensionEnvelopes(this.getExtensions()),
      startsParagraph: this.startsParagraph(),
      emptyFormat: this.getEmptyFormat(),
    };
  }
}
export function $createReviewFragmentNode(
  proposalId: string,
  startsParagraph = false,
  emptyFormat = 0,
  extensions: readonly ReviewExtensionEnvelope[] = [],
): ReviewFragmentNode {
  return $applyNodeReplacement(
    new ReviewFragmentNode(
      proposalId,
      startsParagraph,
      emptyFormat,
      extensions,
    ),
  );
}
export function $isReviewFragmentNode(
  node: LexicalNode | null | undefined,
): node is ReviewFragmentNode {
  return node instanceof ReviewFragmentNode;
}

/** Node-shape predicates shared by targeting, normalization, and preview. */
export function isReviewElementNode(
  node: LexicalNode | null | undefined,
): node is ReviewElementNode {
  return (
    $isReviewFragmentNode(node) ||
    $isReviewDeletionNode(node) ||
    $isReviewInsertionNode(node) ||
    $isReviewFormattingNode(node)
  );
}

export function isRootParagraph(
  node: LexicalNode | null,
): node is ParagraphNode {
  return $isParagraphNode(node) && node.getParent() === $getRoot();
}

export function getChildIndex(
  parent: ElementNode,
  node: LexicalNode,
): number | null {
  const index = parent
    .getChildren()
    .findIndex((child) => child.getKey() === node.getKey());
  return index === -1 ? null : index;
}

export function getTextChildren(wrapper: ReviewElementNode): TextNode[] | null {
  const children = wrapper.getChildren();
  if (
    (children.length === 0 && !$isReviewFragmentNode(wrapper)) ||
    children.some(
      (child) => !$isTextNode(child) || child.getTextContentSize() === 0,
    )
  ) {
    return null;
  }
  return children.filter($isTextNode);
}
