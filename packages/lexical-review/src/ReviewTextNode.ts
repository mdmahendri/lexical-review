import {
  addClassNamesToElement,
  IS_FIREFOX,
  IS_IOS,
  removeClassNamesFromElement,
  IS_SAFARI,
} from "@lexical/utils";
import {
  $applyNodeReplacement,
  EditorConfig,
  IS_BOLD,
  IS_CODE,
  IS_HIGHLIGHT,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_SUBSCRIPT,
  IS_SUPERSCRIPT,
  IS_UNDERLINE,
  LexicalNode,
  NodeKey,
  SerializedTextNode,
  Spread,
  TEXT_TYPE_TO_FORMAT,
  TextNode,
  setDOMStyleFromCSS,
} from "lexical";

// all copied or modified from https://github.com/facebook/lexical/blob/8eae296ea39ff0dd707c901493553f1d889e9174/packages/lexical/src/nodes/LexicalTextNode.ts

export type TextReviewType = "original" | "insertion" | "deletion";

const IS_ORIG = 1;
const IS_ADD = 1 << 1;
const IS_DEL = 1 << 2;

const TEXT_REVIEW_TO_TYPE: Record<number, TextReviewType> = {
  [IS_ORIG]: "original",
  [IS_ADD]: "insertion",
  [IS_DEL]: "deletion",
};

const TEXT_TYPE_TO_REVIEW: Record<TextReviewType, number> = {
  original: IS_ORIG,
  insertion: IS_ADD,
  deletion: IS_DEL,
};

type SerializedReviewTextNodeV1 = Spread<
  {
    review: number;
  },
  SerializedTextNode
>;

function getReviewElementTag(review: number): string | null {
  if (review & IS_ADD) {
    return "ins";
  }
  if (review & IS_DEL) {
    return "del";
  }
  return null;
}

function getFormatElementOuterTag(format: number): string | null {
  if (format & IS_CODE) {
    return "code";
  }
  if (format & IS_HIGHLIGHT) {
    return "mark";
  }
  if (format & IS_SUBSCRIPT) {
    return "sub";
  }
  if (format & IS_SUPERSCRIPT) {
    return "sup";
  }
  return null;
}

function getFormatElementInnerTag(format: number): string {
  if (format & IS_BOLD) {
    return "strong";
  }
  if (format & IS_ITALIC) {
    return "em";
  }
  return "span";
}

type TextThemeClasses = NonNullable<EditorConfig["theme"]["text"]>;

function setReviewTextThemeClassNames(
  prevFormat: number,
  nextFormat: number,
  dom: HTMLElement,
  textClassNames: TextThemeClasses,
): void {
  addClassNamesToElement(dom, textClassNames.base);

  // Underline and strikethrough share the text-decoration CSS property. When
  // a combined theme class is available, use it instead of competing
  // individual classes.
  const combinedDecorationClassName = textClassNames.underlineStrikethrough;
  const previousHasCombinedDecoration =
    (prevFormat & IS_UNDERLINE) !== 0 && (prevFormat & IS_STRIKETHROUGH) !== 0;
  const nextHasCombinedDecoration =
    (nextFormat & IS_UNDERLINE) !== 0 && (nextFormat & IS_STRIKETHROUGH) !== 0;
  let usesCombinedDecorationClass = false;

  if (combinedDecorationClassName !== undefined) {
    if (nextHasCombinedDecoration) {
      usesCombinedDecorationClass = true;
      if (!previousHasCombinedDecoration) {
        addClassNamesToElement(dom, combinedDecorationClassName);
      }
    } else if (previousHasCombinedDecoration) {
      removeClassNamesFromElement(dom, combinedDecorationClassName);
    }
  }

  // Synchronize individual format classes after handling combined decoration.
  for (const formatName in TEXT_TYPE_TO_FORMAT) {
    const formatFlag = TEXT_TYPE_TO_FORMAT[formatName];
    const className = textClassNames[formatName];

    if (formatFlag === undefined) {
      continue;
    }

    const wasActive = (prevFormat & formatFlag) !== 0;
    const isActive = (nextFormat & formatFlag) !== 0;
    const isTextDecorationFormat =
      formatName === "underline" || formatName === "strikethrough";

    if (isActive) {
      if (usesCombinedDecorationClass && isTextDecorationFormat) {
        if (wasActive) {
          removeClassNamesFromElement(dom, className);
        }
        continue;
      }

      if (
        !wasActive ||
        (previousHasCombinedDecoration && formatName === "underline") ||
        formatName === "strikethrough"
      ) {
        addClassNamesToElement(dom, className);
      }
    } else if (wasActive) {
      removeClassNamesFromElement(dom, className);
    }
  }
}

function getReviewTextContentDOM(
  element: HTMLElement,
  review: number,
  format: number,
): HTMLElement {
  let contentDOM = element;

  if (getReviewElementTag(review) !== null) {
    contentDOM =
      (contentDOM.firstElementChild as HTMLElement | null) ?? contentDOM;
  }

  if (getFormatElementOuterTag(format) !== null) {
    contentDOM =
      (contentDOM.firstElementChild as HTMLElement | null) ?? contentDOM;
  }

  return contentDOM;
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
  node: ReviewTextNode,
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
          text,
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
  contentDOM: HTMLElement,
  node: ReviewTextNode,
  format: number,
  text: string,
  config: EditorConfig,
): void {
  setReviewTextContent(text, contentDOM, node);

  const textClassNames = config.theme.text;
  if (textClassNames !== undefined) {
    setReviewTextThemeClassNames(0, format, contentDOM, textClassNames);
  }
}

export class ReviewTextNode extends TextNode {
  __review: number;

  // new insertion without review type will be considered
  // as an attempt to do insertion
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
    serializedNode: SerializedReviewTextNodeV1,
  ): ReviewTextNode {
    const node = $createReviewTextNode(serializedNode.text);
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    const reviewType = TEXT_REVIEW_TO_TYPE[serializedNode.review];
    if (reviewType) {
      node.setReviewType(reviewType);
    }
    return node;
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const review = this.__review;
    const format = this.__format;
    const reviewTag = getReviewElementTag(review);
    const formatOuterTag = getFormatElementOuterTag(format);
    const formatInnerTag = getFormatElementInnerTag(format);
    const tag = reviewTag ?? formatOuterTag ?? formatInnerTag;
    const dom = document.createElement(tag);

    // If there is no review marker, the root also serves as the format
    // container.
    let formatDOM = dom;
    // Review markers must remain the outermost elements around Lexical
    // formatting, so inserted/deleted text renders as <ins>/<del> wrapping
    // the format elements.
    if (reviewTag !== null) {
      formatDOM = document.createElement(formatOuterTag ?? formatInnerTag);
      dom.appendChild(formatDOM);
    }

    // If there is no outer format, the format container also serves as the
    // deepest content element.
    let contentDOM = formatDOM;
    if (formatOuterTag !== null) {
      contentDOM = document.createElement(formatInnerTag);
      formatDOM.appendChild(contentDOM);
    }

    if (format & IS_CODE) {
      formatDOM.setAttribute("spellcheck", "false");
    }

    if (reviewTag !== null) {
      // add class to outer tag of ins and del
      addClassNamesToElement(dom, config.theme[reviewTag]);
    }

    const text = this.__text;
    createReviewTextInnerDOM(contentDOM, this, format, text, config);
    const style = this.__style;
    if (style !== "") {
      setDOMStyleFromCSS(dom.style, style);
    }

    return dom;
  }

  override getDOMSlot(element: HTMLElement) {
    const slot = super.getDOMSlot(element);
    const contentDOM = getReviewTextContentDOM(
      element,
      this.__review,
      this.__format,
    );

    return contentDOM === element ? slot : slot.withElement(contentDOM);
  }

  override updateDOM(
    prevNode: ReviewTextNode,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    const nextText = this.__text;
    const prevReview = prevNode.__review;
    const nextReview = this.__review;
    const prevFormat = prevNode.__format;
    const nextFormat = this.__format;
    const prevReviewTag = getReviewElementTag(prevReview);
    const nextReviewTag = getReviewElementTag(nextReview);
    const prevFormatOuterTag = getFormatElementOuterTag(prevFormat);
    const nextFormatOuterTag = getFormatElementOuterTag(nextFormat);
    const prevFormatInnerTag = getFormatElementInnerTag(prevFormat);
    const nextFormatInnerTag = getFormatElementInnerTag(nextFormat);
    const prevTag = prevReviewTag ?? prevFormatOuterTag ?? prevFormatInnerTag;
    const nextTag = nextReviewTag ?? nextFormatOuterTag ?? nextFormatInnerTag;

    if (
      prevTag !== nextTag ||
      prevReviewTag !== nextReviewTag ||
      prevFormatOuterTag !== nextFormatOuterTag ||
      prevFormatInnerTag !== nextFormatInnerTag
    ) {
      return true;
    }

    const contentDOM = getReviewTextContentDOM(dom, nextReview, nextFormat);
    setReviewTextContent(nextText, contentDOM, this);

    const textClassNames = config.theme.text;
    if (textClassNames !== undefined && prevFormat !== nextFormat) {
      setReviewTextThemeClassNames(
        prevFormat,
        nextFormat,
        contentDOM,
        textClassNames,
      );
    }

    const prevStyle = prevNode.__style;
    const nextStyle = this.__style;
    if (prevStyle !== nextStyle) {
      setDOMStyleFromCSS(dom.style, nextStyle, prevStyle);
    }

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
  deleteInsertionText(offset: number, delCount: number): ReviewTextNode {
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
      writableSelf.__review,
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

    if (writableSelf.hasReviewType("insertion")) {
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
        writableSelf.__review,
      );
      addReviewText.insertAfter(remainingReviewText);
      return addReviewText;
    }
  }
}

export function $createReviewTextNode(
  text = "",
  type: TextReviewType = "original",
): ReviewTextNode {
  return $applyNodeReplacement(
    new ReviewTextNode(text, TEXT_TYPE_TO_REVIEW[type]),
  );
}

export function $isReviewTextNode(
  node: LexicalNode | null | undefined,
): node is ReviewTextNode {
  return node instanceof ReviewTextNode;
}
