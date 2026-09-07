/**
 * Untrusted single-paragraph paste and copy-style drop intake (#66).
 *
 * Clipboard content is untrusted: supported inline presentation may survive,
 * but foreign `<ins>`/`<del>` review wrappers, proposal metadata, classes,
 * links, scripts, and literal WER-looking text never confer native proposal
 * identity. Every successful application creates or corrects exactly one
 * pending proposal with a fresh native identity and reports its
 * normalization. Multiline content refuses with a handoff to #67; WER
 * mapping and conformance belong to `lexical-review-wer` (#74/#82) and are
 * neither implemented nor tested here.
 *
 * Pasting never restores proposal identity, even when the bytes came from
 * this package's own content-only projection (#65).
 *
 * All `$` functions must run inside an editor read or update. Normalization
 * itself is pure (`normalizeUntrustedClipboardContent`) and performs no
 * mutation; refusals preserve content, pending work, projection, and logical
 * selection.
 */
import { $createTextNode, $getEditor, type TextNode } from "lexical";
import type { ReviewAuthoringOptions } from "./ReviewAuthoring";
import { prepareProposalId } from "./ReviewAuthoring";
import type { ReviewFormatRun } from "./ReviewFormattingState";
import {
  $createReviewDeletionNode,
  $createReviewInsertionNode,
  $isReviewInsertionNode,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./ReviewNodes";
import {
  refusal,
  type Preparation,
  type ReviewIntentError,
  type ReviewIntentRefusal,
} from "./ReviewIntent";
import {
  $claimFragmentInsertion,
  $insertReviewFragment,
} from "./ReviewFragment";
import { normalizeUntrustedMultilineClipboardContent } from "./ReviewMultilinePaste";
import { validateStructuralState } from "./ReviewStructure";
import {
  insertProposalText,
  inspectReviewTarget,
  isolateAcceptedTextRange,
  replaceProposalRange,
  type AcceptedCaretTarget,
  type ReviewTarget,
} from "./ReviewTargeting";

export type ReviewPasteRun = ReviewFormatRun;

export type ReviewPasteNormalization = Readonly<{
  /** The clipboard representation the runs were derived from. */
  source: "text/html" | "text/plain";
  /** Structural/inline tags kept as transparent content, in encounter order. */
  flattened: readonly string[];
  /** Tags dropped with their content or as non-textual media, encounter order. */
  lost: readonly string[];
  /** True when at least one HTML `<br>` became a paragraph boundary (#67). */
  softBreakConverted: boolean;
}>;

export type ReviewPasteOutcome =
  | Readonly<{ status: "changed"; value: ReviewPasteNormalization }>
  | Readonly<{ status: "unchanged"; value: undefined }>
  | ReviewIntentRefusal
  | Readonly<{ error: ReviewIntentError; status: "failed" }>;

export type ReviewPastePreparation = Preparation<{
  runs: readonly ReviewPasteRun[];
  normalization: ReviewPasteNormalization;
}>;

const MULTILINE_HANDOFF =
  "Clipboard content spans multiple paragraphs; single-paragraph paste refuses without mutation (multiline intake belongs to #67).";

function pasteChanged(
  normalization: ReviewPasteNormalization,
): ReviewPasteOutcome {
  return { status: "changed", value: normalization };
}

function pasteUnchanged(): ReviewPasteOutcome {
  return { status: "unchanged", value: undefined };
}

function preventDefaultWhenPossible(event: unknown): void {
  if (event !== null && typeof event === "object") {
    const preventDefault = (event as { preventDefault?: unknown })
      .preventDefault;
    if (typeof preventDefault === "function")
      (event as { preventDefault: () => void }).preventDefault();
  }
}

type TransferPayload = Readonly<{ html: string; plain: string }>;

function safeGetData(dataTransfer: unknown, type: string): string {
  if (dataTransfer === null || typeof dataTransfer !== "object") return "";
  const getData = (dataTransfer as { getData?: unknown }).getData;
  if (typeof getData !== "function") return "";
  try {
    const value = (
      dataTransfer as { getData: (type: string) => unknown }
    ).getData(type);
    return typeof value === "string" ? value : "";
  } catch {
    // Denied or malformed clipboard access falls through to the next source.
    return "";
  }
}

/**
 * Read the clipboard payload carried by a paste/drop event. Returns null
 * when the event carries no readable clipboard interface (malformed event).
 * Paste arrives as `ClipboardEvent.clipboardData` or beforeinput
 * `InputEvent.dataTransfer`; drop arrives as `DragEvent.dataTransfer`.
 */
function readTransferPayload(event: unknown): TransferPayload | null {
  if (event === null || typeof event !== "object") return null;
  const candidate = event as {
    clipboardData?: unknown;
    dataTransfer?: unknown;
  };
  if (
    candidate.clipboardData !== undefined &&
    candidate.clipboardData !== null &&
    typeof candidate.clipboardData === "object"
  ) {
    return {
      html: safeGetData(candidate.clipboardData, "text/html"),
      plain: safeGetData(candidate.clipboardData, "text/plain"),
    };
  }
  if (
    candidate.dataTransfer !== undefined &&
    candidate.dataTransfer !== null &&
    typeof candidate.dataTransfer === "object"
  ) {
    return {
      html: safeGetData(candidate.dataTransfer, "text/html"),
      plain: safeGetData(candidate.dataTransfer, "text/plain"),
    };
  }
  return null;
}

const BLOCK_SELECTOR = [
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
].join(",");

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

type HtmlExtraction = Readonly<{
  runs: ReviewPasteRun[];
  boundaries: number;
  flattened: string[];
  lost: string[];
  hasLineBreak: boolean;
}>;

/**
 * Extract ordered single-paragraph format runs from an HTML string.
 * Foreign `<ins>`/`<del>` wrappers unwrap to transparent content; element
 * attributes (ids, classes, metadata, styles, links) are never read, so
 * generic markup cannot establish proposal identity. Inline `style`
 * attributes are ignored: only semantic tags confer the four supported
 * formats (bold 1, italic 2, strikethrough 4, underline 8). Returns null
 * when there is no usable HTML (unparsable or no body content).
 */
function extractHtmlRuns(html: string): HtmlExtraction | null {
  if (typeof DOMParser === "undefined") return null;
  let body: HTMLElement;
  try {
    body = new DOMParser().parseFromString(html, "text/html").body;
  } catch {
    return null;
  }
  const boundaries =
    body.querySelectorAll("br").length +
    Math.max(0, body.querySelectorAll(BLOCK_SELECTOR).length - 1);
  const runs: ReviewPasteRun[] = [];
  const flattened: string[] = [];
  const lost: string[] = [];
  let hasLineBreak = false;
  const walk = (node: Node, format: number): void => {
    if (node.nodeType === 3) {
      const text = (node as Text).data;
      if (text.length === 0) return;
      if (/[\r\n]/.test(text)) hasLineBreak = true;
      const last = runs.at(-1);
      if (last !== undefined && last.format === format)
        runs[runs.length - 1] = { text: last.text + text, format };
      else runs.push({ text, format });
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (LOST_CONTENT.has(tag)) {
      pushUnique(lost, tag);
      return;
    }
    if (tag === "br") return;
    pushUnique(flattened, tag);
    let childFormat = format;
    if (tag === "strong" || tag === "b") childFormat |= 1;
    else if (tag === "em" || tag === "i") childFormat |= 2;
    else if (tag === "s" || tag === "strike") childFormat |= 4;
    else if (tag === "u") childFormat |= 8;
    // `<ins>`/`<del>`, links, spans, code, font, and the single block
    // wrapper stay transparent: children keep the ambient format.
    for (const child of Array.from(element.childNodes))
      walk(child, childFormat);
  };
  for (const child of Array.from(body.childNodes)) walk(child, 0);
  const merged = runs.filter((run) => run.text.length > 0);
  if (
    merged.length === 0 &&
    flattened.length === 0 &&
    lost.length === 0 &&
    boundaries === 0
  )
    return null;
  return { runs: merged, boundaries, flattened, lost, hasLineBreak };
}

/**
 * Normalize untrusted clipboard content into ordered single-paragraph
 * format runs. Prefers `text/html` and falls back to usable plain text when
 * rich data is absent or yields no supported content. Multiline input
 * refuses `unsupported-target` (handoff to #67); rich content with no
 * recoverable text refuses `unsafe-normalization`; both leave the caller to
 * perform zero mutation. Empty input yields zero runs (the editor seam maps
 * that to `unchanged`).
 */
export function normalizeUntrustedClipboardContent(
  html: string,
  plain: string,
): ReviewPastePreparation {
  if (html.length > 0) {
    const extracted = extractHtmlRuns(html);
    if (extracted !== null) {
      if (extracted.boundaries > 0 || extracted.hasLineBreak)
        return refusal("unsupported-target", MULTILINE_HANDOFF);
      if (extracted.runs.length > 0)
        return {
          status: "ready",
          value: {
            runs: extracted.runs,
            normalization: {
              source: "text/html",
              flattened: extracted.flattened,
              lost: extracted.lost,
              softBreakConverted: false,
            },
          },
        };
      if (plain.length === 0)
        return refusal(
          "unsafe-normalization",
          "The pasted rich content holds no usable text; nothing was inserted.",
        );
    }
  }
  if (/[\r\n]/.test(plain))
    return refusal("unsupported-target", MULTILINE_HANDOFF);
  if (plain.length === 0)
    return {
      status: "ready",
      value: {
        runs: [],
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
      runs: [{ text: plain, format: 0 }],
      normalization: {
        source: "text/plain",
        flattened: [],
        lost: [],
        softBreakConverted: false,
      },
    },
  };
}

function missingProposalNode(
  kind: "deletion" | "insertion",
): ReviewPasteOutcome | null {
  const nodeClass =
    kind === "insertion" ? ReviewInsertionNode : ReviewDeletionNode;
  return $getEditor().hasNode(nodeClass)
    ? null
    : refusal(
        "invalid-structural-target",
        `The editor must register the review-${kind} node before pasting ${kind} proposals.`,
      );
}

function insertInsertionRunsAtAcceptedPoint(
  target: AcceptedCaretTarget,
  proposalId: string,
  runs: readonly ReviewPasteRun[],
): void {
  const wrapper = $createReviewInsertionNode(proposalId);
  const nodes: TextNode[] = runs.map((run) =>
    $createTextNode(run.text).setFormat(run.format),
  );
  wrapper.append(...nodes);
  if (target.node === null) {
    target.paragraph.splice(target.childIndex, 0, [wrapper]);
  } else if (target.offset === 0) {
    target.node.insertBefore(wrapper);
  } else if (target.offset === target.node.getTextContentSize()) {
    target.node.insertAfter(wrapper);
  } else {
    const parts = target.node.splitText(target.offset);
    const right = parts[1];
    if (right === undefined) {
      throw new Error("The accepted paste point could not be split.");
    }
    right.insertBefore(wrapper);
  }
  nodes[nodes.length - 1]!.selectEnd();
}

/**
 * Apply normalized single-paragraph runs to the live selection. One call
 * creates or corrects exactly one pending proposal: collapsed accepted
 * targets create a fresh insertion (paste never restores identity);
 * non-collapsed accepted targets create one atomic same-paragraph
 * replacement; collapsed insertion carets continue that proposal;
 * single-run insertion-range replacement corrects in place. Fragment-owned
 * selections route through the fragment claim (plain typing parity);
 * multi-run fragment or insertion-range correction, deletion-side,
 * formatting, split/merge, mixed-identity, and structural targets refuse
 * without mutation.
 */
export function $applyPasteRuns(
  runs: readonly ReviewPasteRun[],
  normalization: ReviewPasteNormalization,
  options: ReviewAuthoringOptions = {},
): ReviewPasteOutcome {
  const structural = validateStructuralState();
  if (structural !== null) return structural as ReviewPasteOutcome;
  if (runs.length === 0) return pasteUnchanged();
  const plainText = runs.map((run) => run.text).join("");
  if (plainText.length === 0) return pasteUnchanged();
  // Fragment-owned selections keep fragment identity through the existing
  // claim (single-line typing parity; richer fragment correction is #67).
  const fragment = $claimFragmentInsertion(plainText);
  if (fragment !== null) {
    if (fragment.status === "changed") return pasteChanged(normalization);
    return fragment as ReviewPasteOutcome;
  }
  const inspection = inspectReviewTarget();
  if (inspection.status !== "ready") return inspection;
  const target: ReviewTarget = inspection.value;
  if (target.kind === "accepted-caret") {
    const missing = missingProposalNode("insertion");
    if (missing !== null) return missing;
    const proposalId = prepareProposalId(options);
    if (proposalId.status !== "ready") return proposalId;
    insertInsertionRunsAtAcceptedPoint(target, proposalId.value, runs);
    return pasteChanged(normalization);
  }
  if (target.kind === "accepted-range") {
    if (target.start === target.end) return pasteUnchanged();
    const missing =
      missingProposalNode("insertion") ?? missingProposalNode("deletion");
    if (missing !== null) return missing;
    const identity = prepareProposalId(options);
    if (identity.status !== "ready") return identity;
    const selected = isolateAcceptedTextRange(target);
    if (!selected?.length)
      throw new Error("Validated paste target could not be isolated.");
    if (
      runs.length === 1 &&
      selected.map((node) => node.getTextContent()).join("") ===
        runs[0]!.text &&
      selected.every((node) => node.getFormat() === target.selection.format) &&
      runs[0]!.format === target.selection.format
    ) {
      return pasteUnchanged();
    }
    const oldSide = $createReviewDeletionNode(identity.value);
    const newSide = $createReviewInsertionNode(identity.value);
    const contents = runs.map((run) =>
      $createTextNode(run.text).setFormat(run.format),
    );
    selected[0]!.insertBefore(oldSide);
    oldSide.append(...selected);
    oldSide.insertAfter(newSide);
    newSide.append(...contents);
    contents[contents.length - 1]!.selectEnd();
    return pasteChanged(normalization);
  }
  if (target.kind === "proposal-caret") {
    if (!$isReviewInsertionNode(target.wrapper)) {
      return refusal(
        "unsupported-proposal-edit",
        "Pasted content may correct pending insertion content, not deletion content. Resolve first.",
      );
    }
    const proposalId = target.proposalId;
    for (const run of runs) {
      const next = inspectReviewTarget();
      if (next.status !== "ready") return next;
      const caret = next.value;
      if (caret.kind !== "proposal-caret" || caret.proposalId !== proposalId) {
        return refusal(
          "unsafe-proposal-intersection",
          "The paste target moved across proposals mid-application; nothing further was inserted.",
        );
      }
      const inserted = insertProposalText(caret, run.format, run.text);
      if (inserted.status !== "ready") return inserted;
    }
    return pasteChanged(normalization);
  }
  if (!$isReviewInsertionNode(target.wrappers[0])) {
    return refusal(
      "unsupported-proposal-edit",
      "Pasted content may correct pending insertion content, not deletion content. Resolve first.",
    );
  }
  if (runs.length > 1) {
    return refusal(
      "unsupported-proposal-edit",
      "Formatted paste over an insertion range is unsupported; resolve the proposal first, then paste at a caret.",
    );
  }
  const corrected = replaceProposalRange(target, runs[0]!.text);
  if (corrected.status === "changed") return pasteChanged(normalization);
  return corrected as ReviewPasteOutcome;
}

/**
 * Paste the clipboard content carried by `PASTE_COMMAND`
 * (`ClipboardEvent` | beforeinput `InputEvent` | `KeyboardEvent`).
 * Malformed events without readable clipboard data refuse
 * `unsupported-transfer`; the event is always claimed to suppress native
 * fallback mutation.
 *
 * Single-paragraph content follows #66 (`$applyPasteRuns`); content with one
 * or more paragraph boundaries follows #67: it normalizes to fragment
 * components and applies through the native fragment semantics
 * (`$insertReviewFragment`), which owns correction, equivalence-based kind
 * normalization (including the `["",""]` split case), and resolution.
 */
export function $pasteReviewSelection(
  event: unknown,
  options: ReviewAuthoringOptions = {},
): ReviewPasteOutcome {
  const payload = readTransferPayload(event);
  if (payload === null) {
    preventDefaultWhenPossible(event);
    return refusal(
      "unsupported-transfer",
      "Paste requires a clipboard event carrying readable clipboard data.",
    );
  }
  preventDefaultWhenPossible(event);
  const prepared = normalizeUntrustedClipboardContent(
    payload.html,
    payload.plain,
  );
  if (prepared.status !== "ready") {
    // #66 refuses 1+ boundaries with `unsupported-target` as a handoff to the
    // #67 multiline route; every other refusal stands without mutation.
    if (prepared.status !== "refused" || prepared.code !== "unsupported-target")
      return prepared;
    const multiline = normalizeUntrustedMultilineClipboardContent(
      payload.html,
      payload.plain,
    );
    if (multiline.status !== "ready") return multiline;
    const applied = $insertReviewFragment(multiline.value.fragment, options);
    if (applied.status === "changed")
      return pasteChanged(multiline.value.normalization);
    if (applied.status === "unchanged") return pasteUnchanged();
    return applied as ReviewPasteOutcome;
  }
  return $applyPasteRuns(
    prepared.value.runs,
    prepared.value.normalization,
    options,
  );
}

/**
 * Apply a copy-style drop at the current selection. The drop event owns the
 * single outcome; `insertFromDrop` halves are claimed silently by the route.
 * Move-style (or unknown-effect) drops refuse `unsupported-transfer` with
 * zero mutation at source and destination. Drop applies at the live
 * selection: hosts that position a drop caret must set the selection before
 * dispatching (browser-native drop-caret positioning is out of scope).
 */
export function $dropReviewSelection(
  event: unknown,
  options: ReviewAuthoringOptions = {},
): ReviewPasteOutcome {
  if (event === null || typeof event !== "object") {
    preventDefaultWhenPossible(event);
    return refusal(
      "unsupported-transfer",
      "Drop requires a drag event carrying readable clipboard data.",
    );
  }
  const dropEffect = (event as { dropEffect?: unknown }).dropEffect;
  if (dropEffect !== "copy") {
    preventDefaultWhenPossible(event);
    return refusal(
      "unsupported-transfer",
      "Move-style drag/drop is refused without mutation; only copy-style drop follows paste rules.",
    );
  }
  return $pasteReviewSelection(event, options);
}
