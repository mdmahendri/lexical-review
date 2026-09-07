/**
 * Multiline clipboard intake for #67.
 *
 * Normalizes untrusted clipboard payloads into normalized fragment components
 * (`ReviewFragment`) for application through the native fragment semantics in
 * #57 (`$insertReviewFragment`). Single-paragraph intake stays in #66
 * (`ReviewPaste.ts`); this module never restores proposal identity and never
 * consults WER representability.
 *
 * Locked decisions D1-D9 (2026-09-07):
 * - D1: usable = >=1 supported char OR >=1 boundary. No text + no boundaries
 *   is `unchanged`. Outcomes mirror #66 with
 *   `normalization = {source, flattened, lost, softBreakConverted}`.
 * - D2: only `["",""]` may become one #56 split, via fragment-then-normalize
 *   in `ReviewFragment.ts`; `["x","y"]` never does.
 * - D3: one shared boundary rule. Every `<br>` counts, including trailing
 *   rendering breaks. `\r`/`\n` inside HTML text nodes is rendering whitespace
 *   and is stripped; plain CRLF is one boundary, lone LF/CR one each.
 * - D4: HTML-first, fallback to plain only when HTML is unparsable,
 *   zero-usable, or unsafe. Document-order flattening is the deterministic
 *   recovery; otherwise `unsafe-normalization`.
 */

import type { ReviewFormatRun } from "./ReviewFormattingState";
import type { ReviewFragment } from "./ReviewFragment";
import {
  refusal,
  type Preparation,
  type ReviewIntentError,
  type ReviewIntentRefusal,
} from "./ReviewIntent";

export type ReviewMultilinePasteNormalization = Readonly<{
  /** The clipboard representation the components were derived from. */
  source: "text/html" | "text/plain";
  /** Structural/inline tags kept as transparent content, encounter order. */
  flattened: readonly string[];
  /** Tags dropped with content or as non-textual media, encounter order. */
  lost: readonly string[];
  /** True when at least one `<br>` became a paragraph boundary. */
  softBreakConverted: boolean;
}>;

export type ReviewMultilinePasteOutcome =
  | Readonly<{ status: "changed"; value: ReviewMultilinePasteNormalization }>
  | Readonly<{ status: "unchanged"; value: undefined }>
  | ReviewIntentRefusal
  | Readonly<{ error: ReviewIntentError; status: "failed" }>;

export type ReviewMultilinePastePreparation = Preparation<{
  fragment: ReviewFragment;
  normalization: ReviewMultilinePasteNormalization;
}>;

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "header",
  "footer",
  "section",
  "article",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "hr",
]);

const LOST_CONTENT = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "img",
  "video",
  "audio",
  "canvas",
  "embed",
  "object",
  "iframe",
]);

function pushUnique(target: string[], tag: string): void {
  if (!target.includes(tag)) target.push(tag);
}

type MutableParagraph = { runs: ReviewFormatRun[] };

function pushRun(
  paragraph: MutableParagraph,
  text: string,
  format: number,
): void {
  if (text.length === 0) return;
  const last = paragraph.runs.at(-1);
  if (last !== undefined && last.format === format)
    paragraph.runs[paragraph.runs.length - 1] = {
      text: last.text + text,
      format,
    };
  else paragraph.runs.push({ text, format });
}

type HtmlExtraction = {
  paragraphs: MutableParagraph[];
  flattened: string[];
  lost: string[];
  softBreakConverted: boolean;
  seenContent: boolean;
};

/**
 * Extract ordered fragment components from HTML.
 *
 * Block elements are paragraph separators; every `<br>` is one boundary with
 * `softBreakConverted` reported. An ordinary sibling pair yields one boundary,
 * never an extra blank. Explicit empty blocks and repeated/trailing breaks are
 * preserved (`<p>x<br></p>` is `["x",""]`, like plain `"x\n"`). `\r`/`\n`
 * inside HTML text is rendering whitespace and is stripped (D3); all other
 * whitespace and non-BMP text is preserved exactly. Returns null when there is
 * no parsable body content at all.
 */
function extractHtmlFragmentParagraphs(html: string): HtmlExtraction | null {
  if (typeof DOMParser === "undefined") return null;
  let body: HTMLElement;
  try {
    body = new DOMParser().parseFromString(html, "text/html").body;
  } catch {
    return null;
  }
  if (body.childNodes.length === 0) return null;

  const state: HtmlExtraction = {
    paragraphs: [],
    flattened: [],
    lost: [],
    softBreakConverted: false,
    seenContent: false,
  };
  let current: MutableParagraph = { runs: [] };

  const finishCurrent = (force: boolean): void => {
    if (current.runs.length > 0 || force) {
      state.paragraphs.push(current);
      current = { runs: [] };
    }
  };

  const formatForTag = (tag: string, ambient: number): number => {
    if (tag === "strong" || tag === "b") return ambient | 1;
    if (tag === "em" || tag === "i") return ambient | 2;
    if (tag === "s" || tag === "strike") return ambient | 4;
    if (tag === "u") return ambient | 8;
    return ambient;
  };

  /**
   * Walk inline content (text + transparent inline elements). Returns true
   * when the walk ends immediately after a boundary with an empty current
   * paragraph (i.e. a trailing break inside this inline scope).
   */
  const walkInline = (node: Node, format: number): boolean => {
    if (node.nodeType === 3) {
      // D3: ignore CR/LF inside HTML text; keep every other char exactly.
      const text = (node as Text).data.replace(/[\r\n]+/g, "");
      if (text.length === 0) return false;
      state.seenContent = true;
      pushRun(current, text, format);
      return false;
    }
    if (node.nodeType !== 1) return false;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (LOST_CONTENT.has(tag)) {
      pushUnique(state.lost, tag);
      return false;
    }
    if (tag === "br") {
      state.softBreakConverted = true;
      state.seenContent = true;
      finishCurrent(true);
      return true;
    }
    if (tag === "hr") {
      pushUnique(state.flattened, tag);
      state.seenContent = true;
      if (current.runs.length > 0) finishCurrent(true);
      return true;
    }
    if (BLOCK_TAGS.has(tag)) {
      // A block inside inline position (invalid HTML, tolerated): treat as a
      // nested block scope.
      processBlock(element, format);
      return false;
    }
    pushUnique(state.flattened, tag);
    const childFormat = formatForTag(tag, format);
    // `<ins>`/`<del>`, links, spans, code, font stay transparent: children keep
    // ambient format and never confer proposal identity.
    let trailing = false;
    let sawChild = false;
    for (const child of Array.from(element.childNodes)) {
      sawChild = true;
      trailing = walkInline(child, childFormat);
    }
    return sawChild && trailing && current.runs.length === 0;
  };

  /**
   * Process a block element's children as one paragraph scope. Explicit empty
   * blocks yield one empty component; trailing breaks inside the block yield
   * one trailing empty component (like trailing plain newlines).
   */
  const processBlock = (element: Element, ambient: number): void => {
    pushUnique(state.flattened, element.tagName.toLowerCase());
    if (current.runs.length > 0) finishCurrent(true);
    const beforeCount = state.paragraphs.length;
    let trailingBreak = false;
    let sawChild = false;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) {
        const childElement = child as Element;
        const childTag = childElement.tagName.toLowerCase();
        if (childTag === "br") {
          sawChild = true;
          state.softBreakConverted = true;
          state.seenContent = true;
          finishCurrent(true);
          trailingBreak = true;
          continue;
        }
        if (childTag === "hr") {
          sawChild = true;
          pushUnique(state.flattened, childTag);
          state.seenContent = true;
          if (current.runs.length > 0) finishCurrent(true);
          trailingBreak = true;
          continue;
        }
        if (LOST_CONTENT.has(childTag)) {
          sawChild = true;
          pushUnique(state.lost, childTag);
          trailingBreak = false;
          continue;
        }
        if (BLOCK_TAGS.has(childTag)) {
          sawChild = true;
          processBlock(childElement, ambient);
          trailingBreak = false;
          continue;
        }
      }
      sawChild = true;
      trailingBreak = walkInline(child, ambient);
    }
    if (current.runs.length > 0) {
      finishCurrent(true);
    } else if (state.paragraphs.length === beforeCount && !sawChild) {
      // Explicit empty block (<p></p>): one empty component.
      finishCurrent(true);
    } else if (trailingBreak) {
      // Trailing break with no following text (<p>x<br></p> like "x\n").
      finishCurrent(true);
    }
  };

  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType === 1) {
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (LOST_CONTENT.has(tag)) {
        pushUnique(state.lost, tag);
        continue;
      }
      if (tag === "br") {
        state.softBreakConverted = true;
        state.seenContent = true;
        finishCurrent(true);
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        processBlock(element, 0);
        continue;
      }
    }
    walkInline(child, 0);
  }
  if (current.runs.length > 0) finishCurrent(true);

  if (
    state.paragraphs.length === 0 &&
    state.flattened.length === 0 &&
    state.lost.length === 0 &&
    !state.seenContent
  )
    return null;
  return state;
}

function hasUsableText(paragraphs: readonly MutableParagraph[]): boolean {
  return paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => run.text.length > 0),
  );
}

/** Split plain text on CRLF/LF/CR without trimming (D3). */
function splitPlainText(plain: string): string[] {
  return plain.split(/\r\n|\r|\n/);
}

/**
 * Normalize untrusted clipboard content into fragment components.
 *
 * HTML-first per D4; falls back to plain only when rich data is absent,
 * unparsable, or yields no usable text-or-boundary content. Usable (D1) is
 * `>=1 supported char OR >=1 boundary`. Empty (no text, no boundaries) yields
 * one empty component so the caller maps it to `unchanged`.
 */
export function normalizeUntrustedMultilineClipboardContent(
  html: string,
  plain: string,
): ReviewMultilinePastePreparation {
  if (html.length > 0) {
    const extracted = extractHtmlFragmentParagraphs(html);
    if (extracted !== null) {
      const usable =
        hasUsableText(extracted.paragraphs) || extracted.paragraphs.length > 1;
      if (usable) {
        const fragment: ReviewFragment = extracted.paragraphs.map(
          (paragraph) => ({
            // emptyFormat inherits from the paste caret at apply time (D6).
            runs: paragraph.runs.map((run) => ({ ...run })),
          }),
        );
        return {
          status: "ready",
          value: {
            fragment,
            normalization: {
              source: "text/html",
              flattened: extracted.flattened,
              lost: extracted.lost,
              softBreakConverted: extracted.softBreakConverted,
            },
          },
        };
      }
      if (plain.length === 0)
        return refusal(
          "unsafe-normalization",
          "The pasted rich content holds no usable text or paragraph boundaries; nothing was inserted.",
        );
    }
  }
  if (/[\r\n]/.test(plain)) {
    const pieces = splitPlainText(plain);
    const fragment: ReviewFragment = pieces.map((text) => ({
      runs: text.length > 0 ? [{ text, format: 0 }] : [],
    }));
    return {
      status: "ready",
      value: {
        fragment,
        normalization: {
          source: "text/plain",
          flattened: [],
          lost: [],
          softBreakConverted: false,
        },
      },
    };
  }
  if (plain.length === 0)
    return {
      status: "ready",
      value: {
        fragment: [{ runs: [] }],
        normalization: {
          source: "text/plain",
          flattened: [],
          lost: [],
          softBreakConverted: false,
        },
      },
    };
  return {
    status: "ready",
    value: {
      fragment: [{ runs: [{ text: plain, format: 0 }] }],
      normalization: {
        source: "text/plain",
        flattened: [],
        lost: [],
        softBreakConverted: false,
      },
    },
  };
}
