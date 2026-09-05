import type { EditorState, SerializedEditorState } from "lexical";
import { isValidProposalId } from "./ProposalIdentity";

import { isValidFormatRuns } from "./ReviewFormattingState";

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
type ProposalKind = "deletion" | "insertion" | "formatting";
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

function validateEmptyExtensions(
  value: unknown,
  path: string,
): ValidationResult<void> {
  if (!Array.isArray(value)) {
    return invalid(path, "Expected an extension placeholder array.");
  }
  if (value.length !== 0) {
    return unsupported(
      path,
      "Native review extensions are not supported by this foundation.",
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
): ValidationResult<void> {
  const kind = proposalKind(value);
  if (kind === null) {
    return invalid(
      path,
      "Expected an insertion, deletion, or formatting review node.",
    );
  }
  if (
    !hasExactlyKeys(value, [
      ...(kind === "formatting" ? ["accepted"] : []),
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
  const prior = proposals.get(value.proposalId);
  if (
    prior &&
    (prior.kind === "formatting" ||
      kind === "formatting" ||
      prior.paragraph !== paragraph ||
      prior.index + 1 !== index ||
      (prior.kind === "insertion" && kind === "deletion"))
  ) {
    return invalid(
      `${path}.proposalId`,
      "A proposal must have contiguous ordered sides in one paragraph.",
    );
  }
  proposals.set(value.proposalId, { kind, paragraph, index });

  const extensions = validateEmptyExtensions(
    value.extensions,
    `${path}.extensions`,
  );
  if (extensions.status !== "valid") {
    return extensions;
  }
  if (!Array.isArray(value.children) || value.children.length === 0) {
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
  if (
    kind === "formatting" &&
    (!isValidFormatRuns(value.accepted) ||
      value.accepted.map((run) => run.text).join("") !==
        value.children.map((child) => (child as JsonRecord).text).join(""))
  ) {
    return invalid(
      `${path}.accepted`,
      "Formatting proposals must retain supported accepted formats for exactly their current text.",
    );
  }
  return valid();
}

function validateParagraphNode(
  value: unknown,
  path: string,
  proposals: Map<string, ProposalOccurrence>,
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
  for (let index = 0; index < value.children.length; index += 1) {
    const child = value.children[index];
    const childPath = `${path}.children[${index}]`;
    const result =
      isRecord(child) && proposalKind(child) !== null
        ? validateReviewNode(child, childPath, proposals, path, index)
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
  const extensions = validateEmptyExtensions(
    metadata.extensions,
    `$.root.$.${REVIEW_STATE_KEY}.extensions`,
  );
  if (extensions.status !== "valid") {
    return extensions;
  }

  const proposals = new Map<string, ProposalOccurrence>();
  for (let index = 0; index < root.children.length; index += 1) {
    const result = validateParagraphNode(
      root.children[index],
      `$.root.children[${index}]`,
      proposals,
    );
    if (result.status !== "valid") {
      return result;
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
