/**
 * Content-only clipboard projections for ordinary copy and cut (#65).
 *
 * Ordinary copy/cut never transfer portable proposal identity. A clipboard
 * projection is selection-scoped content derived through the named read-only
 * preview over the selected range: `all-accepted` (default) or
 * `accepted-state` (host opt-in). There is no verbatim marker mode.
 *
 * Cut is a projected copy plus one routed deletion intention. Ordering is
 * preflight-first: an unsupported follow-up deletion leaves the clipboard
 * untouched. `$deleteReviewText` owns all deletion semantics; this module
 * only preflights (read-only) and routes.
 *
 * All `$` functions must run inside an editor read or update. Copy performs
 * no mutation. Cut mutates through the shared deletion operation.
 */
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type RangeSelection,
  type TextNode,
} from "lexical";
import type { ReviewAuthoringOptions } from "./ReviewAuthoring";
import {
  $isReviewDeletionNode,
  $isReviewFormattingNode,
  $isReviewFragmentNode,
  $isReviewInsertionNode,
  isReviewElementNode,
  isRootParagraph,
} from "./ReviewNodes";
import {
  refusal,
  type Preparation,
  type ReviewIntentError,
  type ReviewIntentOutcome,
  type ReviewIntentRefusal,
} from "./ReviewIntent";
import { $deleteReviewText } from "./ReviewIntentDispatch";
import { $classifyReviewDeletion } from "./ReviewTargetEdit";
import {
  inspectFragmentSelection,
  inspectReviewTarget,
} from "./ReviewTargeting";
import { validateStructuralState } from "./ReviewStructure";

export type ReviewCopyProjectionMode = "all-accepted" | "accepted-state";

export type ReviewClipboardOptions = ReviewAuthoringOptions &
  Readonly<{
    /** Clipboard projection mode; defaults to `"all-accepted"`. */
    mode?: ReviewCopyProjectionMode;
  }>;

export type ReviewClipboardSuccess = Readonly<{
  mode: ReviewCopyProjectionMode;
  projectedLength: number;
}>;

export type ReviewClipboardEmptyProjection = Readonly<{
  code: "empty-projection";
  message: string;
  mode: ReviewCopyProjectionMode;
  projectedLength: 0;
  status: "refused";
}>;

export type ReviewClipboardOutcome =
  | Readonly<{ status: "changed"; value: ReviewClipboardSuccess }>
  | ReviewClipboardEmptyProjection
  | ReviewIntentRefusal
  | Readonly<{ error: ReviewIntentError; status: "failed" }>;

export type ReviewClipboardProjection = Readonly<{
  mode: ReviewCopyProjectionMode;
  text: string;
  html: string;
  projectedLength: number;
}>;

export const CLIPBOARD_WRITE_FAILED = "clipboard-write-failed";
export const CUT_MUTATION_FAILED_AFTER_COPY = "cut-mutation-failed-after-copy";

type FormatRun = Readonly<{ text: string; format: number }>;

function emptyProjection(
  mode: ReviewCopyProjectionMode,
): ReviewClipboardEmptyProjection {
  return {
    code: "empty-projection",
    message: `Nothing projectable in ${mode} mode; the clipboard was left unchanged.`,
    mode,
    projectedLength: 0,
    status: "refused",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wrapRun(run: FormatRun): string {
  // Only the four supported inline formats survive; strikethrough uses <s>
  // so copied bytes never resemble a review <del> wrapper.
  let open = "";
  let close = "";
  if ((run.format & 1) !== 0) {
    open += "<strong>";
    close = `</strong>${close}`;
  }
  if ((run.format & 2) !== 0) {
    open += "<em>";
    close = `</em>${close}`;
  }
  if ((run.format & 8) !== 0) {
    open += "<u>";
    close = `</u>${close}`;
  }
  if ((run.format & 4) !== 0) {
    open += "<s>";
    close = `</s>${close}`;
  }
  return `${open}${escapeHtml(run.text)}${close}`;
}

function includeInMode(
  parent: ReturnType<TextNode["getParent"]>,
  mode: ReviewCopyProjectionMode,
): boolean {
  if (parent === null || isRootParagraph(parent)) return true;
  if ($isReviewInsertionNode(parent)) return mode === "all-accepted";
  if ($isReviewDeletionNode(parent)) return mode === "accepted-state";
  if ($isReviewFormattingNode(parent)) return true;
  if ($isReviewFragmentNode(parent)) return mode === "all-accepted";
  return false;
}

function sliceSelectedText(
  node: TextNode,
  start: RangeSelection["anchor"],
  end: RangeSelection["anchor"],
  selectedKeys: ReadonlySet<string>,
): string | null {
  if (!selectedKeys.has(node.getKey())) return null;
  const text = node.getTextContent();
  let from = 0;
  let to = text.length;
  if (start.type === "text" && start.key === node.getKey())
    from = Math.max(from, start.offset);
  if (end.type === "text" && end.key === node.getKey())
    to = Math.min(to, end.offset);
  if (to <= from) return "";
  return text.slice(from, to);
}

/**
 * Derive the selection-scoped clipboard projection without mutating live
 * state. Mixed accepted/proposal content and cross-paragraph selections are
 * supported for copy: each side contributes per the mode. Collapsed or
 * content-free selections refuse `empty-projection`.
 */
export function $deriveClipboardProjection(
  mode: ReviewCopyProjectionMode,
): Preparation<ReviewClipboardProjection> {
  const blocked = validateStructuralState();
  if (blocked !== null) {
    if (blocked.status === "refused") return blocked;
    if (blocked.status === "failed") throw new Error(blocked.error.message);
    return refusal(
      "unsupported-target",
      "The clipboard projection could not be derived from invalid review state.",
    );
  }
  const selection = $getSelection();
  if (!$isRangeSelection(selection))
    return refusal(
      "unsupported-target",
      "Copy requires one Lexical range selection.",
    );
  if (selection.isCollapsed()) return emptyProjection(mode);
  const { start, end } = selection.isBackward()
    ? { start: selection.focus, end: selection.anchor }
    : { start: selection.anchor, end: selection.focus };
  const selectedKeys = new Set(
    selection.getNodes().map((node) => node.getKey()),
  );
  const paragraphTexts: string[] = [];
  const paragraphHtml: string[] = [];
  for (const paragraph of $getRoot().getChildren()) {
    if (!isRootParagraph(paragraph)) continue;
    const runs: FormatRun[] = [];
    for (const child of paragraph.getChildren()) {
      if ($isTextNode(child)) {
        const slice = sliceSelectedText(child, start, end, selectedKeys);
        if (slice !== null && slice !== "")
          runs.push({ text: slice, format: child.getFormat() });
        continue;
      }
      if (!isReviewElementNode(child)) continue;
      if (!includeInMode(child, mode)) continue;
      for (const grandchild of child.getChildren()) {
        if (!$isTextNode(grandchild)) continue;
        const slice = sliceSelectedText(grandchild, start, end, selectedKeys);
        if (slice !== null && slice !== "")
          runs.push({ text: slice, format: grandchild.getFormat() });
      }
    }
    if (runs.length === 0) {
      if (selectedKeys.has(paragraph.getKey())) {
        paragraphTexts.push("");
        paragraphHtml.push("<p></p>");
      }
      continue;
    }
    const merged = runs.reduce<FormatRun[]>((acc, run) => {
      const last = acc.at(-1);
      if (last !== undefined && last.format === run.format)
        acc[acc.length - 1] = {
          text: last.text + run.text,
          format: last.format,
        };
      else acc.push(run);
      return acc;
    }, []);
    paragraphTexts.push(merged.map((run) => run.text).join(""));
    paragraphHtml.push(`<p>${merged.map(wrapRun).join("")}</p>`);
  }
  const text = paragraphTexts.join("\n");
  if (text.length === 0) return emptyProjection(mode);
  return {
    status: "ready",
    value: {
      mode,
      text,
      html: paragraphHtml.join(""),
      projectedLength: text.length,
    },
  };
}

function getWritableDataTransfer(event: unknown): {
  setData: (type: string, data: string) => void;
} | null {
  if (event === null || typeof event !== "object") return null;
  const clipboardData = (event as { clipboardData?: unknown }).clipboardData;
  if (clipboardData === null || typeof clipboardData !== "object") return null;
  if (typeof (clipboardData as { setData?: unknown }).setData !== "function")
    return null;
  return clipboardData as { setData: (type: string, data: string) => void };
}

function preventDefaultWhenPossible(event: unknown): void {
  if (event !== null && typeof event === "object") {
    const preventDefault = (event as { preventDefault?: unknown })
      .preventDefault;
    if (typeof preventDefault === "function")
      (event as { preventDefault: () => void }).preventDefault();
  }
}

function failed(
  code: string,
  cause: unknown,
  message: string,
): ReviewClipboardOutcome {
  return {
    error: {
      cause,
      code,
      message: cause instanceof Error ? `${message} ${cause.message}` : message,
    },
    status: "failed",
  };
}

/**
 * Copy the current selection as a content-only projection. No mutation.
 * Malformed events (no writable clipboard data) refuse
 * `unsupported-transfer`; content-free selections refuse `empty-projection`.
 * The event is always claimed to suppress native fallback.
 */
export function $copyReviewSelection(
  event: unknown,
  options: ReviewClipboardOptions = {},
): ReviewClipboardOutcome {
  const mode = options.mode ?? "all-accepted";
  const dataTransfer = getWritableDataTransfer(event);
  if (dataTransfer === null) {
    preventDefaultWhenPossible(event);
    return refusal(
      "unsupported-transfer",
      "Copy requires a clipboard event carrying writable clipboard data.",
    );
  }
  preventDefaultWhenPossible(event);
  const projection = $deriveClipboardProjection(mode);
  if (projection.status !== "ready")
    return projection as ReviewClipboardOutcome;
  try {
    dataTransfer.setData("text/plain", projection.value.text);
    dataTransfer.setData("text/html", projection.value.html);
  } catch (cause) {
    return failed(
      CLIPBOARD_WRITE_FAILED,
      cause,
      "The clipboard write failed; review state and selection are unchanged.",
    );
  }
  return {
    status: "changed",
    value: { mode, projectedLength: projection.value.projectedLength },
  };
}

/**
 * Read-only cut preflight in `$deleteReviewText` dispatch order: fragment
 * ownership, then the classified target. Range checks delegate to the shared
 * deletion classifier so refusal precedence lives in one module. `null`
 * means the follow-up deletion is supported; any outcome must be reported
 * with the clipboard untouched. The follow-up `$deleteReviewText` after the
 * clipboard write revalidates from scratch: a classified target is never
 * assumed to stay valid across that step.
 */
function $preflightCutDeletion(): ReviewIntentOutcome | null {
  const fragment = inspectFragmentSelection();
  if (fragment !== null) {
    // The fragment claim owns wholly fragment-local ranges under the same
    // rules its ticket allows; any refusal is reported before the clipboard
    // is touched.
    if (fragment.status !== "ready") return fragment;
    return null;
  }
  const inspection = inspectReviewTarget();
  if (inspection.status !== "ready") return inspection;
  const target = inspection.value;
  if (target.kind === "accepted-range") {
    if (target.start === target.end)
      return { status: "unchanged", value: undefined };
    const classified = $classifyReviewDeletion(target, false, "character", {});
    if (classified.status !== "ready") return classified;
    return null;
  }
  if (target.kind === "proposal-range") {
    const classified = $classifyReviewDeletion(target, false, "character", {});
    if (classified.status !== "ready") return classified;
    return null;
  }
  return refusal(
    "unsupported-target",
    "Cut requires a supported non-collapsed selection.",
  );
}

/**
 * Cut the current selection: preflight, then projected copy, then one routed
 * deletion intention. A refused preflight or empty projection leaves the
 * clipboard untouched. A clipboard-write failure preserves review state and
 * selection. A follow-up deletion that does not apply after a successful
 * write reports `cut-mutation-failed-after-copy` and admits the clipboard
 * may already hold projected content. Unexpected implementation errors
 * propagate to Lexical's update error handling like other authoring routes.
 */
export function $cutReviewSelection(
  event: unknown,
  options: ReviewClipboardOptions = {},
): ReviewClipboardOutcome {
  const mode = options.mode ?? "all-accepted";
  const dataTransfer = getWritableDataTransfer(event);
  if (dataTransfer === null) {
    preventDefaultWhenPossible(event);
    return refusal(
      "unsupported-transfer",
      "Cut requires a clipboard event carrying writable clipboard data.",
    );
  }
  preventDefaultWhenPossible(event);
  const projection = $deriveClipboardProjection(mode);
  if (projection.status !== "ready")
    return projection as ReviewClipboardOutcome;
  const preflight = $preflightCutDeletion();
  if (preflight !== null) return preflight as ReviewClipboardOutcome;
  try {
    dataTransfer.setData("text/plain", projection.value.text);
    dataTransfer.setData("text/html", projection.value.html);
  } catch (cause) {
    return failed(
      CLIPBOARD_WRITE_FAILED,
      cause,
      "The clipboard write failed; review state and selection are unchanged.",
    );
  }
  const mutation = $deleteReviewText(false, options);
  if (mutation.status !== "changed") {
    const detail =
      mutation.status === "refused"
        ? `${mutation.code} ${mutation.message}`
        : mutation.status === "failed"
          ? mutation.error.message
          : "the deletion reported no change";
    return failed(
      CUT_MUTATION_FAILED_AFTER_COPY,
      mutation,
      `Cut copied ${projection.value.projectedLength} characters but the follow-up deletion did not apply (${detail}); the clipboard may already contain projected content while review state is unchanged.`,
    );
  }
  return {
    status: "changed",
    value: { mode, projectedLength: projection.value.projectedLength },
  };
}
