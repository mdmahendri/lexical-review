import type { EditorState, SerializedEditorState } from "lexical";

const SUPPORTED_TEXT_FORMAT_MASK = 0b1111;
const REVIEW_STATE_KEY = "lexical-review";

declare const legacyReviewDocumentV3Brand: unique symbol;

export type ReviewDocumentV3 = SerializedEditorState & {
  readonly [legacyReviewDocumentV3Brand]: true;
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: JsonRecord, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
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
  return { status: "valid", value: undefined };
}

function validateParagraphNode(
  value: unknown,
  path: string,
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
    value.textFormat !== 0 ||
    value.textStyle !== ""
  ) {
    return unsupported(
      path,
      "Paragraph direction, formatting, indentation, and styles are unsupported.",
    );
  }
  if (!Array.isArray(value.children)) {
    return invalid(`${path}.children`, "Expected an array of text nodes.");
  }
  for (let index = 0; index < value.children.length; index += 1) {
    const result = validateTextNode(
      value.children[index],
      `${path}.children[${index}]`,
    );
    if (result.status !== "valid") {
      return result;
    }
  }
  return { status: "valid", value: undefined };
}

function validateInsertionRun(
  value: unknown,
  path: string,
): ValidationResult<void> {
  if (!isRecord(value) || !hasExactlyKeys(value, ["format", "text"])) {
    return invalid(path, "Expected one closed insertion text run.");
  }
  if (typeof value.text !== "string" || value.text.length === 0) {
    return invalid(`${path}.text`, "Insertion text must be nonempty.");
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
  return { status: "valid", value: undefined };
}

function validateProposalHeader(
  value: unknown,
  path: string,
  kind: "deletion" | "insertion",
): ValidationResult<{ id: string; proposal: JsonRecord }> {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["id", "kind", "payload", "status", "target"])
  ) {
    return invalid(path, `Expected one closed ${kind} proposal.`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    return invalid(`${path}.id`, "Proposal identity must be nonempty text.");
  }
  if (value.kind !== kind) {
    return unsupported(`${path}.kind`, `Only ${kind} proposals are supported.`);
  }
  if (
    value.status !== "pending" &&
    value.status !== "accepted" &&
    value.status !== "rejected"
  ) {
    return invalid(
      `${path}.status`,
      "Expected a valid proposal lifecycle status.",
    );
  }
  return { status: "valid", value: { id: value.id, proposal: value } };
}

function validateProposalPayload(
  value: unknown,
  path: string,
  kind: "deletion" | "insertion",
): ValidationResult<void> {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["runs"]) ||
    !Array.isArray(value.runs) ||
    value.runs.length === 0
  ) {
    return invalid(path, `Expected nonempty ${kind} content.`);
  }
  for (let index = 0; index < value.runs.length; index += 1) {
    const result = validateInsertionRun(
      value.runs[index],
      `${path}.runs[${index}]`,
    );
    if (result.status !== "valid") {
      return result;
    }
  }
  return { status: "valid", value: undefined };
}

function validateInsertionProposal(
  value: unknown,
  path: string,
  paragraphLengths: readonly number[],
): ValidationResult<string> {
  const header = validateProposalHeader(value, path, "insertion");
  if (header.status !== "valid") {
    return header;
  }
  const { id, proposal } = header.value;
  if (
    !isRecord(proposal.target) ||
    !hasExactlyKeys(proposal.target, ["offset", "paragraph"]) ||
    !Number.isInteger(proposal.target.paragraph) ||
    !Number.isInteger(proposal.target.offset)
  ) {
    return invalid(`${path}.target`, "Expected one accepted-state text caret.");
  }
  const paragraph = proposal.target.paragraph as number;
  const offset = proposal.target.offset as number;
  if (
    paragraph < 0 ||
    paragraph >= paragraphLengths.length ||
    offset < 0 ||
    offset > (paragraphLengths[paragraph] ?? -1)
  ) {
    return invalid(
      `${path}.target`,
      "The insertion target is outside accepted content.",
    );
  }
  const payload = validateProposalPayload(
    proposal.payload,
    `${path}.payload`,
    "insertion",
  );
  if (payload.status !== "valid") {
    return payload;
  }
  return { status: "valid", value: id };
}

function validateDeletionProposal(
  value: unknown,
  path: string,
  paragraphLengths: readonly number[],
): ValidationResult<string> {
  const header = validateProposalHeader(value, path, "deletion");
  if (header.status !== "valid") {
    return header;
  }
  const { id, proposal } = header.value;
  if (
    !isRecord(proposal.target) ||
    !hasExactlyKeys(proposal.target, ["end", "start"]) ||
    !isRecord(proposal.target.start) ||
    !isRecord(proposal.target.end) ||
    !hasExactlyKeys(proposal.target.start, ["offset", "paragraph"]) ||
    !hasExactlyKeys(proposal.target.end, ["offset", "paragraph"]) ||
    !Number.isInteger(proposal.target.start.paragraph) ||
    !Number.isInteger(proposal.target.start.offset) ||
    !Number.isInteger(proposal.target.end.paragraph) ||
    !Number.isInteger(proposal.target.end.offset)
  ) {
    return invalid(`${path}.target`, "Expected one accepted-state text range.");
  }
  const startParagraph = proposal.target.start.paragraph as number;
  const endParagraph = proposal.target.end.paragraph as number;
  const startOffset = proposal.target.start.offset as number;
  const endOffset = proposal.target.end.offset as number;
  if (
    startParagraph !== endParagraph ||
    startParagraph < 0 ||
    startParagraph >= paragraphLengths.length ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    (proposal.status !== "accepted" &&
      endOffset > (paragraphLengths[startParagraph] ?? -1))
  ) {
    return invalid(
      `${path}.target`,
      "The deletion target is outside one accepted paragraph range.",
    );
  }
  const payload = validateProposalPayload(
    proposal.payload,
    `${path}.payload`,
    "deletion",
  );
  if (payload.status !== "valid") {
    return payload;
  }
  return { status: "valid", value: id };
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
      "An accepted document must contain at least one paragraph.",
    );
  }
  for (let index = 0; index < root.children.length; index += 1) {
    const result = validateParagraphNode(
      root.children[index],
      `$.root.children[${index}]`,
    );
    if (result.status !== "valid") {
      return result;
    }
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
    !hasExactlyKeys(metadata, ["proposals", "version"])
  ) {
    return invalid(
      `$.root.$.${REVIEW_STATE_KEY}`,
      "Expected closed version 3 review metadata.",
    );
  }
  if (metadata.version !== 3) {
    return unsupported(
      `$.root.$.${REVIEW_STATE_KEY}.version`,
      "Only native review-document version 3 is supported.",
    );
  }
  if (!Array.isArray(metadata.proposals)) {
    return invalid(
      `$.root.$.${REVIEW_STATE_KEY}.proposals`,
      "Expected a proposal array.",
    );
  }
  const paragraphLengths = root.children.map((paragraph) =>
    (paragraph as { children: Array<{ text: string }> }).children.reduce(
      (length, run) => length + run.text.length,
      0,
    ),
  );
  const proposalIds = new Set<string>();
  for (let index = 0; index < metadata.proposals.length; index += 1) {
    const proposal = metadata.proposals[index];
    const result =
      isRecord(proposal) && proposal.kind === "deletion"
        ? validateDeletionProposal(
            proposal,
            `$.root.$.${REVIEW_STATE_KEY}.proposals[${index}]`,
            paragraphLengths,
          )
        : validateInsertionProposal(
            proposal,
            `$.root.$.${REVIEW_STATE_KEY}.proposals[${index}]`,
            paragraphLengths,
          );
    if (result.status !== "valid") {
      return result;
    }
    if (proposalIds.has(result.value)) {
      return invalid(
        `$.root.$.${REVIEW_STATE_KEY}.proposals[${index}].id`,
        "Proposal identities must be unique.",
      );
    }
    proposalIds.add(result.value);
  }

  const cloned = structuredClone(input) as unknown as ReviewDocumentV3;
  return { status: "valid", value: deepFreeze(cloned) };
}

export function exportReviewDocument(
  editorState: EditorState,
): ValidationResult<ReviewDocumentV3> {
  const serialized = structuredClone(editorState.toJSON()) as unknown as {
    root: JsonRecord & { children: Array<JsonRecord> };
  };
  const metadata = (serialized.root.$ as JsonRecord | undefined)?.[
    REVIEW_STATE_KEY
  ];
  if (isRecord(metadata) && metadata.draft != null) {
    return unsupported(
      `$.root.$.${REVIEW_STATE_KEY}.draft`,
      "An active proposal draft must be settled before native export.",
    );
  }
  if (isRecord(metadata)) {
    delete metadata.draft;
  }

  for (const paragraph of serialized.root.children) {
    if (!Array.isArray(paragraph.children)) {
      continue;
    }
    const nativeChildren: JsonRecord[] = [];
    for (const originalChild of paragraph.children) {
      if (!isRecord(originalChild)) {
        continue;
      }
      const child = { ...originalChild };
      const childState = isRecord(child.$) ? { ...child.$ } : undefined;
      const segment = childState?.["lexical-review-segment"];
      if (isRecord(segment) && segment.type === "proposal-insertion") {
        continue;
      }
      if (isRecord(segment) && segment.type === "draft-insertion") {
        return unsupported(
          "$",
          "An active proposal draft must be settled before native export.",
        );
      }
      if (child.type === "review") {
        child.type = "text";
        delete child.review;
      }
      if (childState !== undefined) {
        delete childState["lexical-review-segment"];
        if (Object.keys(childState).length === 0) {
          delete child.$;
        } else {
          child.$ = childState;
        }
      }

      const previous = nativeChildren.at(-1);
      if (
        previous !== undefined &&
        previous.type === "text" &&
        child.type === "text" &&
        previous.format === child.format &&
        previous.detail === child.detail &&
        previous.mode === child.mode &&
        previous.style === child.style
      ) {
        previous.text = `${String(previous.text)}${String(child.text)}`;
      } else {
        nativeChildren.push(child);
      }
    }
    paragraph.children = nativeChildren;
  }
  return validateReviewDocument(serialized);
}
