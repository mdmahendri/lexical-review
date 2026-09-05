import { ReviewBoundaryNode } from "./ReviewBoundaryNode";
import type { EditorState, LexicalEditor } from "lexical";
import {
  exportReviewDocument,
  validateReviewDocument,
  type ReviewDocumentV3,
  type ValidationResult,
} from "./ReviewDocument";
import {
  ReviewFragmentNode,
  ReviewDeletionNode,
  ReviewInsertionNode,
  ReviewFormattingNode,
} from "./ReviewNodes";

export interface ReviewSession {
  exportDocument(): ValidationResult<ReviewDocumentV3>;
  getEditorState(): EditorState;
}

function invalid(message: string, path = "$"): ValidationResult<never> {
  return {
    issues: [{ code: "invalid-document", message, path }],
    status: "invalid",
  };
}

function sameSerializedValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameSerializedValue(value, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        sameSerializedValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function pendingNodeKinds(document: ReviewDocumentV3): Readonly<{
  fragment: boolean;
  boundary: boolean;
  formatting: boolean;
  deletion: boolean;
  insertion: boolean;
}> {
  let fragment = false;
  let boundary = false;
  let formatting = false;
  let deletion = false;
  let insertion = false;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    fragment ||= record.type === "review-fragment";
    boundary ||= record.type === "review-boundary";
    formatting ||= record.type === "review-formatting";
    insertion ||= record.type === "review-insertion";
    deletion ||= record.type === "review-deletion";
    Object.values(record).forEach(visit);
  };
  visit(document.root);
  return { deletion, insertion, formatting, boundary, fragment };
}

class LexicalReviewSession implements ReviewSession {
  readonly #editor: LexicalEditor;

  constructor(editor: LexicalEditor) {
    this.#editor = editor;
  }

  exportDocument(): ValidationResult<ReviewDocumentV3> {
    return exportReviewDocument(this.#editor.getEditorState());
  }

  getEditorState(): EditorState {
    return this.#editor.getEditorState();
  }
}

export function importReviewDocument(
  editor: LexicalEditor,
  input: unknown,
): ValidationResult<EditorState> {
  const validated = validateReviewDocument(input);
  if (validated.status !== "valid") {
    return validated;
  }
  const requiredNodes = pendingNodeKinds(validated.value);
  if (
    (requiredNodes.fragment && !editor.hasNode(ReviewFragmentNode)) ||
    (requiredNodes.boundary && !editor.hasNode(ReviewBoundaryNode)) ||
    (requiredNodes.formatting && !editor.hasNode(ReviewFormattingNode)) ||
    (requiredNodes.insertion && !editor.hasNode(ReviewInsertionNode)) ||
    (requiredNodes.deletion && !editor.hasNode(ReviewDeletionNode))
  ) {
    return invalid(
      "Every proposal node type present in the document must be registered before opening pending proposals.",
      "$.root.children",
    );
  }
  try {
    const parsed = editor.parseEditorState(validated.value);
    const reparsed = validateReviewDocument(parsed.toJSON());
    if (reparsed.status !== "valid") {
      return invalid(
        "Lexical could not preserve the validated review document while parsing.",
        "$",
      );
    }
    if (!sameSerializedValue(validated.value, reparsed.value)) {
      return invalid(
        "Lexical changed the validated review document while parsing.",
        "$",
      );
    }
    return {
      status: "valid",
      value: parsed,
    };
  } catch (cause) {
    return invalid(
      cause instanceof Error
        ? cause.message
        : "Lexical could not parse the review document.",
      "$",
    );
  }
}

export function openReviewSession(
  editor: LexicalEditor,
  input: unknown,
): ValidationResult<ReviewSession> {
  const imported = importReviewDocument(editor, input);
  if (imported.status !== "valid") {
    return imported;
  }
  const previousEditorState = editor.getEditorState();
  try {
    editor.setEditorState(imported.value);
  } catch (cause) {
    editor.setEditorState(previousEditorState);
    return invalid(
      cause instanceof Error
        ? cause.message
        : "Lexical could not install the review document.",
      "$",
    );
  }
  return {
    status: "valid",
    value: new LexicalReviewSession(editor),
  };
}
