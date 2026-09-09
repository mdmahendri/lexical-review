import { validFragmentPositions } from "./ReviewFragmentInvariant";
import type { EditorState, SerializedEditorState } from "lexical";
import { isValidProposalId } from "./ProposalIdentity";
import {
  canonicalExtensionSet,
  validateExtensionEnvelopes,
  type ExtensionValidation,
  type ReviewExtensionEnvelope,
} from "./ReviewExtensionEnvelope";

import { isSupportedFormat } from "./ReviewFormattingState";
import type { ReviewFormatRun } from "./ReviewFormattingState";

const REVIEW_STATE_KEY = "lexical-review";
const SUPPORTED_TEXT_FORMAT_MASK = 0b1111;

declare const reviewDocumentV3Brand: unique symbol;

export type ReviewDocumentV3 = SerializedEditorState & {
  readonly [reviewDocumentV3Brand]: true;
};

export type ValidationIssue = Readonly<{
  code: "invalid-document";
  message: string;
  path: string;
}>;

export type UnsupportedDocumentReason = Readonly<{
  code: "unsupported-document";
  message: string;
  path: string;
}>;

export type ValidationResult<T> =
  | Readonly<{ status: "valid"; value: T }>
  | Readonly<{ issues: readonly ValidationIssue[]; status: "invalid" }>
  | Readonly<{
      reason: UnsupportedDocumentReason;
      status: "unsupported";
    }>;

type JsonRecord = Record<string, unknown>;
type ProposalKind =
  "deletion" | "insertion" | "formatting" | "boundary" | "fragment";
type ProposalOccurrence = Readonly<{
  kind: ProposalKind;
  paragraph: string;
  index: number;
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: JsonRecord, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function invalid(path: string, message: string): ValidationResult<never> {
  return {
    issues: [{ code: "invalid-document", message, path }],
    status: "invalid",
  };
}

function unsupported(path: string, message: string): ValidationResult<never> {
  return {
    reason: { code: "unsupported-document", message, path },
    status: "unsupported",
  };
}

function valid(): ValidationResult<void> {
  return { status: "valid", value: undefined };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function mapExtensionValidation(
  result: ExtensionValidation,
): ValidationResult<readonly ReviewExtensionEnvelope[]> {
  if (result.status === "valid") {
    return { status: "valid", value: result.envelopes };
  }
  if (result.status === "invalid") {
    return invalid(result.path, result.message);
  }
  return unsupported(result.path, result.message);
}

/**
 * Whole-proposal-ID ownership (#63): every node sharing a proposal identity
 * carries one identical envelope set. The first occurrence records the
 * canonical set; any divergence is invalid at the divergent node.
 */
function checkEnvelopeOwnership(
  ownership: Map<string, string>,
  proposalId: string,
  envelopes: readonly ReviewExtensionEnvelope[],
  path: string,
): ValidationResult<void> {
  const canonical = canonicalExtensionSet(envelopes);
  const prior = ownership.get(proposalId);
  if (prior === undefined) {
    ownership.set(proposalId, canonical);
    return valid();
  }
  if (prior !== canonical) {
    return invalid(
      path,
      `Nodes sharing proposal identity ${JSON.stringify(proposalId)} must carry identical extension envelopes.`,
    );
  }
  return valid();
}

function validateTextNode(
  value: unknown,
  path: string,
): ValidationResult<void> {
  if (!isRecord(value)) {
    return invalid(path, "Expected a serialized text node.");
  }
  if (
    !hasExactlyKeys(value, [
      "detail",
      "format",
      "mode",
      "style",
      "text",
      "type",
      "version",
    ])
  ) {
    return invalid(path, "Text nodes must contain only version 3 core fields.");
  }
  if (value.type !== "text" || value.version !== 1) {
    return invalid(path, "Expected a version 1 Lexical text node.");
  }
  if (typeof value.text !== "string" || value.text.length === 0) {
    return invalid(`${path}.text`, "Text node content must be nonempty text.");
  }
  if (
    !Number.isInteger(value.format) ||
    (value.format as number) < 0 ||
    ((value.format as number) & ~SUPPORTED_TEXT_FORMAT_MASK) !== 0
  ) {
    return unsupported(
      `${path}.format`,
      "Only bold, italic, strikethrough, and underline are supported.",
    );
  }
  if (value.detail !== 0 || value.mode !== "normal" || value.style !== "") {
    return unsupported(
      path,
      "Token modes, text detail flags, and inline styles are not supported.",
    );
  }
  return valid();
}

function proposalKind(value: JsonRecord): ProposalKind | null {
  if (value.type === "review-fragment") return "fragment";
  if (value.type === "review-boundary") return "boundary";
  if (value.type === "review-formatting") return "formatting";
  if (value.type === "review-insertion") {
    return "insertion";
  }
  if (value.type === "review-deletion") {
    return "deletion";
  }
  return null;
}

function validateReviewNode(
  value: JsonRecord,
  path: string,
  proposals: Map<string, ProposalOccurrence>,
  paragraph: string,
  index: number,
  ownership: Map<string, string>,
): ValidationResult<void> {
  const kind = proposalKind(value);
  if (kind === null) {
    return invalid(
      path,
      "Expected an insertion, deletion, or formatting review node.",
    );
  }
  if (kind === "boundary") {
    if (
      !hasExactlyKeys(value, [
        "type",
        "version",
        "proposalId",
        "kind",
        "leftFormat",
        "rightFormat",
        "extensions",
      ]) ||
      value.version !== 1 ||
      (value.kind !== "split" && value.kind !== "merge") ||
      !isValidProposalId(value.proposalId)
    )
      return invalid(path, "Invalid serialized structural boundary.");
    if (!isSupportedFormat(value.leftFormat)) {
      return unsupported(
        `${path}.leftFormat`,
        "Only bold, italic, strikethrough, and underline boundary formats are supported.",
      );
    }
    if (!isSupportedFormat(value.rightFormat)) {
      return unsupported(
        `${path}.rightFormat`,
        "Only bold, italic, strikethrough, and underline boundary formats are supported.",
      );
    }
    const duplicate = proposals.get(value.proposalId);
    if (duplicate)
      return invalid(
        path,
        duplicate.kind === "boundary"
          ? "[invalid-structural-target] A structural identity must occur exactly once."
          : "[unsafe-proposal-intersection] A text-proposal identity must never equal a boundary identity.",
      );
    proposals.set(value.proposalId, { kind, paragraph, index });
    const extensions = mapExtensionValidation(
      validateExtensionEnvelopes(value.extensions, `${path}.extensions`),
    );
    if (extensions.status !== "valid") {
      return extensions;
    }
    return checkEnvelopeOwnership(
      ownership,
      value.proposalId as string,
      extensions.value,
      path,
    );
  }
  if (
    !hasExactlyKeys(value, [
      ...(kind === "formatting" ? ["accepted"] : []),
      ...(kind === "fragment" ? ["startsParagraph", "emptyFormat"] : []),
      "children",
      "direction",
      "extensions",
      "format",
      "indent",
      "proposalId",
      "type",
      "version",
    ])
  ) {
    return invalid(
      path,
      `Review nodes must contain only version 3 proposal fields; received ${Object.keys(
        value,
      )
        .sort()
        .join(", ")}.`,
    );
  }
  if (value.version !== 1) {
    return invalid(`${path}.version`, "Expected a version 1 review node.");
  }
  if (value.direction !== null || value.format !== "" || value.indent !== 0) {
    return unsupported(
      path,
      "Review wrapper direction, formatting, indentation, and styles are unsupported.",
    );
  }
  if (!isValidProposalId(value.proposalId)) {
    return invalid(
      `${path}.proposalId`,
      "Proposal identity must be nonempty text without surrounding whitespace or control characters.",
    );
  }
  if (kind === "fragment" && typeof value.startsParagraph !== "boolean")
    return invalid(
      path,
      "Invalid fragment boundary or empty formatting metadata.",
    );
  if (kind === "fragment" && !isSupportedFormat(value.emptyFormat)) {
    return unsupported(
      `${path}.emptyFormat`,
      "Only bold, italic, strikethrough, and underline fragment formats are supported.",
    );
  }
  const prior = proposals.get(value.proposalId);
  if (
    prior &&
    !(prior.kind === "fragment" && kind === "fragment") &&
    (prior.kind === "fragment" ||
      kind === "fragment" ||
      prior.kind === "boundary" ||
      prior.kind === "formatting" ||
      kind === "formatting" ||
      prior.paragraph !== paragraph ||
      prior.index + 1 !== index ||
      (prior.kind === "insertion" && kind === "deletion"))
  ) {
    return invalid(
      `${path}.proposalId`,
      "[unsafe-proposal-intersection] A proposal must have contiguous ordered sides in one paragraph.",
    );
  }
  proposals.set(value.proposalId, { kind, paragraph, index });

  const extensions = mapExtensionValidation(
    validateExtensionEnvelopes(value.extensions, `${path}.extensions`),
  );
  if (extensions.status !== "valid") {
    return extensions;
  }
  const owned = checkEnvelopeOwnership(
    ownership,
    value.proposalId as string,
    extensions.value,
    path,
  );
  if (owned.status !== "valid") {
    return owned;
  }
  if (
    !Array.isArray(value.children) ||
    (value.children.length === 0 && kind !== "fragment")
  ) {
    return invalid(
      `${path}.children`,
      "A pending proposal wrapper must contain at least one text node.",
    );
  }
  for (let index = 0; index < value.children.length; index += 1) {
    const child = validateTextNode(
      value.children[index],
      `${path}.children[${index}]`,
    );
    if (child.status !== "valid") {
      return child;
    }
  }
  if (kind === "formatting") {
    const accepted = value.accepted;
    if (
      !Array.isArray(accepted) ||
      accepted.length === 0 ||
      !accepted.every(
        (run) =>
          isRecord(run) &&
          Object.keys(run).length === 2 &&
          typeof run.text === "string" &&
          run.text.length > 0 &&
          Number.isInteger(run.format),
      )
    ) {
      return invalid(
        `${path}.accepted`,
        "Formatting proposals must retain supported accepted formats for exactly their current text.",
      );
    }
    if (
      !accepted.every((run) =>
        isSupportedFormat((run as JsonRecord).format),
      )
    ) {
      return unsupported(
        `${path}.accepted`,
        "Only bold, italic, strikethrough, and underline accepted formats are supported.",
      );
    }
    const acceptedRuns = accepted as readonly ReviewFormatRun[];
    const currentText = (value.children as JsonRecord[])
      .map((child) => child.text)
      .join("");
    if (acceptedRuns.map((run) => run.text).join("") !== currentText) {
      return invalid(
        `${path}.accepted`,
        "Formatting proposals must retain supported accepted formats for exactly their current text.",
      );
    }
    const currentRuns = (value.children as JsonRecord[]).map((child) => ({
      format: child.format as number,
      text: child.text as string,
    }));
    if (sameFormatRunList(currentRuns, acceptedRuns)) {
      return invalid(
        `${path}.accepted`,
        "A formatting proposal equal to its accepted formats is a no-op.",
      );
    }
  }
  return valid();
}

function sameFormatRunList(
  left: readonly ReviewFormatRun[],
  right: readonly ReviewFormatRun[],
): boolean {
  const canonical = (
    runs: readonly ReviewFormatRun[],
  ): Array<{ text: string; format: number }> => {
    const result: Array<{ text: string; format: number }> = [];
    for (const run of runs) {
      const last = result.at(-1);
      if (last?.format === run.format) last.text += run.text;
      else result.push({ text: run.text, format: run.format });
    }
    return result;
  };
  return (
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
  );
}

function validateParagraphNode(
  value: unknown,
  path: string,
  proposals: Map<string, ProposalOccurrence>,
  ownership: Map<string, string>,
): ValidationResult<void> {
  if (!isRecord(value)) {
    return invalid(path, "Expected a serialized paragraph node.");
  }
  if (
    !hasExactlyKeys(value, [
      "children",
      "direction",
      "format",
      "indent",
      "textFormat",
      "textStyle",
      "type",
      "version",
    ])
  ) {
    return invalid(
      path,
      "Paragraph nodes must contain only version 3 core fields.",
    );
  }
  if (value.type !== "paragraph" || value.version !== 1) {
    return invalid(path, "Expected a version 1 Lexical paragraph node.");
  }
  if (
    value.direction !== null ||
    value.format !== "" ||
    value.indent !== 0 ||
    value.textStyle !== ""
  ) {
    return unsupported(
      path,
      "Paragraph direction, block formatting, indentation, and styles are unsupported.",
    );
  }
  if (
    !Number.isInteger(value.textFormat) ||
    (value.textFormat as number) < 0 ||
    ((value.textFormat as number) & ~SUPPORTED_TEXT_FORMAT_MASK) !== 0
  ) {
    return unsupported(
      `${path}.textFormat`,
      "Only bold, italic, strikethrough, and underline text formatting are supported.",
    );
  }
  if (!Array.isArray(value.children)) {
    return invalid(`${path}.children`, "Expected an array of inline nodes.");
  }
  const boundaries = value.children.filter(
    (child) => isRecord(child) && child.type === "review-boundary",
  );
  if (boundaries.length > 1)
    return invalid(
      path,
      "[ambiguous-boundary] A paragraph permits at most one boundary.",
    );
  if (boundaries[0]?.kind === "split" && value.children[0] !== boundaries[0])
    return invalid(
      path,
      "[ambiguous-boundary] A split marker must be the first child of its paragraph.",
    );
  for (let index = 0; index < value.children.length; index += 1) {
    const child = value.children[index];
    const childPath = `${path}.children[${index}]`;
    const result =
      isRecord(child) && proposalKind(child) !== null
        ? validateReviewNode(
            child,
            childPath,
            proposals,
            path,
            index,
            ownership,
          )
        : validateTextNode(child, childPath);
    if (result.status !== "valid") {
      return result;
    }
  }
  return valid();
}

export function validateReviewDocument(
  input: unknown,
): ValidationResult<ReviewDocumentV3> {
  if (!isRecord(input) || !hasExactlyKeys(input, ["root"])) {
    return invalid("$", "Expected one Lexical-shaped serialized editor state.");
  }
  const root = input.root;
  if (!isRecord(root)) {
    return invalid("$.root", "Expected a serialized Lexical root node.");
  }
  if (
    !hasExactlyKeys(root, [
      "$",
      "children",
      "direction",
      "format",
      "indent",
      "type",
      "version",
    ])
  ) {
    return invalid(
      "$.root",
      "The root node must contain only version 3 core fields.",
    );
  }
  if (root.type !== "root" || root.version !== 1) {
    return invalid("$.root", "Expected a version 1 Lexical root node.");
  }
  if (root.direction !== null || root.format !== "" || root.indent !== 0) {
    return unsupported(
      "$.root",
      "Root direction, formatting, and indentation are unsupported.",
    );
  }
  if (!Array.isArray(root.children) || root.children.length === 0) {
    return invalid(
      "$.root.children",
      "A review document must contain at least one paragraph.",
    );
  }

  const nodeState = root.$;
  if (!isRecord(nodeState) || !hasExactlyKeys(nodeState, [REVIEW_STATE_KEY])) {
    return invalid(
      "$.root.$",
      `Expected package state at ${JSON.stringify(REVIEW_STATE_KEY)}.`,
    );
  }
  const metadata = nodeState[REVIEW_STATE_KEY];
  if (
    !isRecord(metadata) ||
    !hasExactlyKeys(metadata, ["extensions", "version"])
  ) {
    return invalid(
      `$.root.$.${REVIEW_STATE_KEY}`,
      "Expected closed node-backed version 3 review metadata.",
    );
  }
  if (metadata.version !== 3) {
    return unsupported(
      `$.root.$.${REVIEW_STATE_KEY}.version`,
      "Only native review-document version 3 is supported.",
    );
  }
  const extensions = mapExtensionValidation(
    validateExtensionEnvelopes(
      metadata.extensions,
      `$.root.$.${REVIEW_STATE_KEY}.extensions`,
    ),
  );
  if (extensions.status !== "valid") {
    return extensions;
  }

  const boundaryKind = (paragraph: unknown): unknown =>
    isRecord(paragraph) && Array.isArray(paragraph.children)
      ? paragraph.children.find(
          (child) => isRecord(child) && child.type === "review-boundary",
        )?.kind
      : undefined;
  for (let index = 0; index < root.children.length; index++) {
    const kind = boundaryKind(root.children[index]);
    if (
      kind === "split" &&
      (index === 0 || boundaryKind(root.children[index - 1]) === "merge")
    )
      return invalid(
        `$.root.children[${index}]`,
        "[invalid-structural-target] A split requires an attached left paragraph without a pending merge.",
      );
  }

  const proposals = new Map<string, ProposalOccurrence>();
  const ownership = new Map<string, string>();
  for (let index = 0; index < root.children.length; index += 1) {
    const result = validateParagraphNode(
      root.children[index],
      `$.root.children[${index}]`,
      proposals,
      ownership,
    );
    if (result.status !== "valid") {
      return result;
    }
  }

  const replacementSides = new Map<
    string,
    { delText: string; insText: string; insPath: string }
  >();
  root.children.forEach((paragraph, p) => {
    const children = (paragraph as JsonRecord).children as JsonRecord[];
    children.forEach((child, index) => {
      if (!isRecord(child)) return;
      const childPath = `$.root.children[${p}].children[${index}]`;
      if (child.type === "review-deletion" && typeof child.proposalId === "string") {
        const sides = replacementSides.get(child.proposalId) ?? {
          delText: "",
          insText: "",
          insPath: childPath,
        };
        sides.delText += ((child.children as JsonRecord[]) ?? [])
          .map((node) => (isRecord(node) ? node.text : ""))
          .join("");
        replacementSides.set(child.proposalId as string, sides);
      }
      if (child.type === "review-insertion" && typeof child.proposalId === "string") {
        const sides = replacementSides.get(child.proposalId) ?? {
          delText: "",
          insText: "",
          insPath: childPath,
        };
        sides.insText += ((child.children as JsonRecord[]) ?? [])
          .map((node) => (isRecord(node) ? node.text : ""))
          .join("");
        if (sides.insText === "") sides.insPath = childPath;
        replacementSides.set(child.proposalId as string, sides);
      }
    });
  });
  for (const sides of replacementSides.values()) {
    if (sides.delText !== "" && sides.delText === sides.insText) {
      return invalid(
        sides.insPath,
        "An atomic replacement proposal with equal sides is a no-op.",
      );
    }
  }

  const fragments = new Map<
    string,
    import("./ReviewFragmentInvariant").FragmentComponentPosition[]
  >();
  const fragmentText = new Map<string, string>();
  root.children.forEach((paragraph, p) => {
    const children = (paragraph as JsonRecord).children as JsonRecord[];
    children.forEach((child, index) => {
      if (child.type !== "review-fragment") return;
      const id = child.proposalId as string;
      const positions = fragments.get(id) ?? [];
      positions.push({
        paragraph: p,
        index,
        siblings: children.length,
        startsParagraph: child.startsParagraph as boolean,
      });
      fragments.set(id, positions);
      const componentText = ((child.children as JsonRecord[]) ?? [])
        .map((node) => (isRecord(node) ? node.text : ""))
        .join("");
      fragmentText.set(id, `${fragmentText.get(id) ?? ""}${componentText}`);
    });
  });
  for (const positions of fragments.values())
    if (!validFragmentPositions(positions))
      return invalid(
        "$.root.children",
        "[unsafe-proposal-intersection] Fragment components must own contiguous paragraph boundaries without intervening accepted content.",
      );
  for (const text of fragmentText.values()) {
    if (text === "") {
      return invalid(
        "$.root.children",
        "An atomic document-fragment insertion with no text is a no-op.",
      );
    }
  }

  const cloned = structuredClone(input) as unknown as ReviewDocumentV3;
  return { status: "valid", value: deepFreeze(cloned) };
}

export function exportReviewDocument(
  editorState: EditorState,
): ValidationResult<ReviewDocumentV3> {
  return validateReviewDocument(editorState.toJSON());
}
