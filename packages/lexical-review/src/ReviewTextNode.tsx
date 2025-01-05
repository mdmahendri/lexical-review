import {
  addClassNamesToElement,
  IS_FIREFOX,
  IS_IOS,
  IS_SAFARI,
} from "@lexical/utils";
import {
  $applyNodeReplacement,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedTextNode,
  Spread,
  TextNode,
} from "lexical";

// all copied or modified from https://github.com/facebook/lexical/blob/8eae296ea39ff0dd707c901493553f1d889e9174/packages/lexical/src/nodes/LexicalTextNode.ts

export type TextReviewType = "original" | "addition" | "deletion";

const IS_ORIG = 1;
const IS_ADD = 1 << 1;
const IS_DEL = 1 << 2;

const TEXT_REVIEW_TO_TYPE: Record<number, TextReviewType> = {
  [IS_ORIG]: "original",
  [IS_ADD]: "addition",
  [IS_DEL]: "deletion",
};

const TEXT_TYPE_TO_REVIEW: Record<TextReviewType | string, number> = {
  original: IS_ORIG,
  addition: IS_ADD,
  deletion: IS_DEL,
};

type SerializedReviewTextNodeV1 = Spread<
  {
    review: number;
  },
  SerializedTextNode
>;

// copy of getElementOuterTag - no support for tag code, sub, sup
function getReviewElementOuterTag(
  node: ReviewTextNode,
  review: number
): string | null {
  if (review & IS_ADD) {
    return "ins";
  }
  if (review & IS_DEL) {
    return "del";
  }
  return null;
}

// at this time, we do not allow for bold and italic review mode
// so it is fine
function getReviewElementInnerTag(): string {
  return "span";
}

// Reconciliation
export const NON_BREAKING_SPACE = "\u00A0";
// For iOS/Safari we use a non breaking space, otherwise the cursor appears
// overlapping the composed text.
export const COMPOSITION_SUFFIX: string =
  IS_SAFARI || IS_IOS ? NON_BREAKING_SPACE : "\u200b";

// exact copy
function diffComposedText(a: string, b: string): [number, number, string] {
  const aLength = a.length;
  const bLength = b.length;
  let left = 0;
  let right = 0;

  while (left < aLength && left < bLength && a[left] === b[left]) {
    left++;
  }
  while (
    right + left < aLength &&
    right + left < bLength &&
    a[aLength - right - 1] === b[bLength - right - 1]
  ) {
    right++;
  }

  return [left, aLength - left - right, b.slice(left, bLength - right)];
}

// exact copy
// replacing TextNode - ReviewTextNode
function setReviewTextContent(
  nextText: string,
  dom: HTMLElement,
  node: ReviewTextNode
): void {
  const firstChild = dom.firstChild;
  const isComposing = node.isComposing();
  // Always add a suffix if we're composing a node
  const suffix = isComposing ? COMPOSITION_SUFFIX : "";
  const text: string = nextText + suffix;

  if (firstChild == null) {
    dom.textContent = text;
  } else {
    const nodeValue = firstChild.nodeValue;
    if (nodeValue !== text) {
      if (isComposing || IS_FIREFOX) {
        // We also use the diff composed text for general text in FF to avoid
        // We also use the diff composed text for general text in FF to avoid
        // the spellcheck red line from flickering.
        const [index, remove, insert] = diffComposedText(
          nodeValue as string,
          text
        );
        if (remove !== 0) {
          // @ts-expect-error - original directive from lexical
          firstChild.deleteData(index, remove);
        }
        // @ts-expect-error - original directive from lexical
        firstChild.insertData(index, insert);
      } else {
        firstChild.nodeValue = text;
      }
    }
  }
}

// exact copy
// replacing TextNode - ReviewTextNode
function createReviewTextInnerDOM(
  innerDOM: HTMLElement,
  node: ReviewTextNode,
  // innerTag: string,
  // format: number,
  text: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: EditorConfig
): void {
  setReviewTextContent(text, innerDOM, node);
  // const theme = config.theme;
  // Apply theme class names
  // const textClassNames = theme.text;

  // if (textClassNames !== undefined) {
  //   setTextThemeClassNames(innerTag, 0, format, innerDOM, textClassNames);
  // }
}

export class ReviewTextNode extends TextNode {
  __review: number;

  // new addition without review will be considered as an attempt
  // to do addition
  constructor(text: string, review = IS_ADD, key?: NodeKey) {
    super(text, key);
    this.__review = review;
  }

  static override getType(): string {
    return "review";
  }

  static override clone(node: ReviewTextNode): ReviewTextNode {
    return new ReviewTextNode(node.__text, node.__review, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedReviewTextNodeV1
  ): ReviewTextNode {
    const node = $createReviewTextNode(serializedNode.text);
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    node.setReviewType(TEXT_REVIEW_TO_TYPE[serializedNode.review]);

    return node;
  }

  // mimic createDOM but without applying format
  override createDOM(config: EditorConfig): HTMLElement {
    const review = this.__review;
    const outerTag = getReviewElementOuterTag(this, review);
    const innerTag = getReviewElementInnerTag();
    const tag = outerTag == null ? innerTag : outerTag;
    const dom = document.createElement(tag);
    let innerDOM = dom;
    if (outerTag !== null) {
      innerDOM = document.createElement(innerTag);
      dom.appendChild(innerDOM);

      // add class to outer tag of ins and del
      addClassNamesToElement(dom, config.theme[outerTag]);
    }
    const text = this.__text;
    createReviewTextInnerDOM(innerDOM, this, text, config);
    const style = this.__style;
    if (style !== "") {
      dom.style.cssText = style;
    }

    return dom;
  }

  // modify updateDOM
  override updateDOM(
    prevNode: ReviewTextNode,
    dom: HTMLElement,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config: EditorConfig
  ): boolean {
    const nextText = this.__text;
    const prevReview = prevNode.__review;
    const nextReview = this.__review;
    const prevOuterTag = getReviewElementOuterTag(this, prevReview);
    const nextOuterTag = getReviewElementOuterTag(this, nextReview);
    const prevInnerTag = getReviewElementInnerTag(); //only output 'span'
    const nextInnerTag = getReviewElementInnerTag(); //only output 'span'
    const prevTag = prevOuterTag === null ? prevInnerTag : prevOuterTag;
    const nextTag = nextOuterTag === null ? nextInnerTag : nextOuterTag;

    if (prevTag !== nextTag) {
      return true;
    }

    let innerDOM = dom;
    if (nextOuterTag !== null && prevOuterTag !== null) {
      innerDOM = dom.firstChild as HTMLElement;
    }
    setReviewTextContent(nextText, innerDOM, this);

    return false;
  }

  override exportJSON(): SerializedReviewTextNodeV1 {
    return {
      ...super.exportJSON(),
      type: this.getType(),
      review: this.getReviewType(),
    };
  }

  override isTextEntity(): boolean {
    return false;
  }

  override isSimpleText(): boolean {
    return false;
  }

  setReviewType(type: TextReviewType): this {
    const review = TEXT_TYPE_TO_REVIEW[type];
    if (this.__review == review) {
      return this;
    }

    const self = this.getWritable();

    self.__review = review;
    return self;
  }

  getReviewType(): number {
    const self = this.getLatest();
    return self.__review;
  }

  hasReviewType(type: TextReviewType): boolean {
    const reviewType = TEXT_TYPE_TO_REVIEW[type];
    return this.getReviewType() == reviewType;
  }

  // modify spliceText
  deleteAdditionText(offset: number, delCount: number): ReviewTextNode {
    const writableSelf = this.getWritable();
    const text = writableSelf.__text;
    let index = offset;
    if (index < 0) {
      console.log("don't know when this would happen, logging it for now");
      index = 0;
    }

    // need this to prevent offset error of the node
    writableSelf.select(offset, offset);

    writableSelf.__text = text.slice(0, index) + text.slice(index + delCount);
    return writableSelf;
  }

  // modify spliceText
  deleteOriginalText(offset: number, delCount: number): Array<ReviewTextNode> {
    const writableSelf = this.getWritable();
    const text = writableSelf.__text;
    let index = offset;
    if (index < 0) {
      console.log("don't know when this would happen, logging it for now");
      index = 0;
    }

    const delText = text.slice(index, index + delCount);
    writableSelf.__text = text.slice(0, index);
    const deletedReviewText = new ReviewTextNode(delText, IS_DEL);
    writableSelf.insertAfter(deletedReviewText);
    const remainingText = text.slice(index + delCount);
    const remainingReviewText = new ReviewTextNode(
      remainingText,
      writableSelf.__review
    );
    deletedReviewText.insertAfter(remainingReviewText);
    return [writableSelf, deletedReviewText, remainingReviewText];
  }

  insertBetweenAddOrOrig(offset: number, addText: string) {
    if (this.hasReviewType("deletion")) {
      // should not be allowed
      return this;
    }

    const writableSelf = this.getWritable();
    const text = writableSelf.__text;
    let index = offset;
    if (index < 0) {
      console.log("don't know when this would happen, logging it for now");
      index = 0;
    }

    if (writableSelf.hasReviewType("addition")) {
      const newText = text.slice(0, index) + addText + text.slice(index);
      writableSelf.__text = newText;
      return writableSelf;
    } else {
      // must be original
      writableSelf.__text = text.slice(0, index);
      const addReviewText = new ReviewTextNode(addText, IS_ADD);
      writableSelf.insertAfter(addReviewText);
      const remainingText = text.slice(index);
      const remainingReviewText = new ReviewTextNode(
        remainingText,
        writableSelf.__review
      );
      addReviewText.insertAfter(remainingReviewText);
      return addReviewText;
    }
  }
}

export function $createReviewTextNode(
  text = "",
  type: TextReviewType = "original"
): ReviewTextNode {
  return $applyNodeReplacement(
    new ReviewTextNode(text, TEXT_TYPE_TO_REVIEW[type])
  );
}

export function $isReviewTextNode(
  node: LexicalNode | null | undefined
): node is ReviewTextNode {
  return node instanceof ReviewTextNode;
}
