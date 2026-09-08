/**
 * Shared interpretation policy for untrusted clipboard payloads (#66/#67).
 *
 * Clipboard content is untrusted: supported inline presentation may survive,
 * but foreign review markup, proposal metadata, classes, links, scripts, and
 * literal interchange-looking text never confer native proposal identity.
 * Only semantic tags confer the four supported formats (bold 1, italic 2,
 * strikethrough 4, underline 8); inline `style` attributes are never read.
 *
 * This module owns the policy both intake routes share: the block tag table,
 * the discarded-content table, the inline format mapping, body parsing, plain
 * text splitting, and the normalization report shape. The two routes keep
 * their own walks because they answer different questions over the same tree:
 *
 * - Boundary count (single-paragraph view in `ReviewPaste.ts`): `br` elements
 *   plus `max(0, block elements - 1)` over the whole tree, plus raw CR/LF
 *   presence. This is a routing detector, not a paragraph count: it
 *   over-counts nested single-text trees (`<div><p>x</p></div>` counts 1 and
 *   flows to the fragment route) and under-counts loose-text mixes (`x<p>y</p>`
 *   counts 0 and stays single). Both quirks are pinned by the suites.
 * - Paragraph count (fragment view in `ReviewMultilinePaste.ts`): the
 *   splitter output length, answering how many pieces to insert.
 *
 * The paste handoff (`$pasteReviewSelection`) reuses this policy, not one
 * parsed result: each view parses the payload again and keeps its own
 * null/empty gating. Both walks are pure reads over a deterministic parse of
 * gesture-scale payloads, so sharing one parse would couple the views for no
 * observable gain.
 */

export type ReviewClipboardSource = "text/html" | "text/plain";

export type ReviewClipboardNormalization = Readonly<{
  /** The clipboard representation the content was derived from. */
  source: ReviewClipboardSource;
  /** Structural/inline tags kept as transparent content, encounter order. */
  flattened: readonly string[];
  /** Tags dropped with their content or as non-textual media, encounter order. */
  lost: readonly string[];
  /** True when at least one HTML `<br>` became a paragraph boundary. */
  softBreakConverted: boolean;
}>;

const BLOCK_TAG_LIST = [
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
];

export const BLOCK_TAGS: ReadonlySet<string> = new Set(BLOCK_TAG_LIST);

export const BLOCK_SELECTOR = BLOCK_TAG_LIST.join(",");

export const LOST_CONTENT: ReadonlySet<string> = new Set([
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

export function pushUnique(target: string[], tag: string): void {
  if (!target.includes(tag)) target.push(tag);
}

/**
 * Confer the supported inline format for one tag over the ambient format.
 * Every other tag (`ins`/`del`, links, spans, code, font, blocks) stays
 * transparent: children keep the ambient format.
 */
export function applyInlineFormat(tag: string, ambient: number): number {
  if (tag === "strong" || tag === "b") return ambient | 1;
  if (tag === "em" || tag === "i") return ambient | 2;
  if (tag === "s" || tag === "strike") return ambient | 4;
  if (tag === "u") return ambient | 8;
  return ambient;
}

/** Parse one clipboard HTML payload to its body, or null when unavailable. */
export function parseClipboardBody(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  try {
    return new DOMParser().parseFromString(html, "text/html").body;
  } catch {
    return null;
  }
}

/** True when the value carries any CR or LF character. */
export function containsLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

/** Split plain text on CRLF/LF/CR without trimming. */
export function splitPlainText(plain: string): string[] {
  return plain.split(/\r\n|\r|\n/);
}

/** Normalization report for content derived without HTML interpretation. */
export function plainClipboardNormalization(
  source: ReviewClipboardSource,
): ReviewClipboardNormalization {
  return { source, flattened: [], lost: [], softBreakConverted: false };
}
