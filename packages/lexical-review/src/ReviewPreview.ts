import { $getRoot, createEditor, type ParagraphNode } from "lexical";
import {
  ReviewBoundaryNode,
  $isReviewBoundaryNode,
} from "./ReviewBoundaryNode";
import {
  ReviewFragmentNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
} from "./ReviewNodes";
import { isReviewElementNode } from "./ReviewSelectionPreparation";
import { $resolveReviewProposals } from "./ReviewOperations";
import { openReviewSession } from "./ReviewSession";
import { type ReviewDocumentV3, type ValidationResult } from "./ReviewDocument";

/** A detached projection: neither the source document nor a live editor is resolved. */
export function createReviewPreview(
  input: ReviewDocumentV3,
  mode: "accepted-state" | "all-accepted",
): ValidationResult<ReviewDocumentV3> {
  if (mode !== "accepted-state" && mode !== "all-accepted")
    return {
      status: "invalid",
      issues: [
        {
          code: "invalid-document",
          path: "$",
          message: "Unknown preview mode.",
        },
      ],
    };
  const editor = createEditor({
    nodes: [
      ReviewFragmentNode,
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewBoundaryNode,
    ],
    onError(error) {
      throw error;
    },
  });
  const opened = openReviewSession(editor, input);
  if (opened.status !== "valid") return opened;
  try {
    editor.update(
      () => {
        const ids = $getRoot()
          .getChildren<ParagraphNode>()
          .flatMap((p) =>
            p
              .getChildren()
              .filter((n) => isReviewElementNode(n) || $isReviewBoundaryNode(n))
              .map((n) => n.getProposalId()),
          );
        const result = $resolveReviewProposals(
          ids,
          mode === "all-accepted" ? "accept" : "reject",
        );
        if (result.status !== "changed" && result.status !== "unchanged")
          throw new Error(
            result.status === "refused" ? result.message : result.error.message,
          );
      },
      { discrete: true },
    );
    return opened.value.exportDocument();
  } catch (cause) {
    if (mode === "all-accepted") throw cause;
    return {
      status: "invalid",
      issues: [
        {
          code: "invalid-document",
          path: "$",
          message:
            cause instanceof Error
              ? cause.message
              : "Preview could not be determined.",
        },
      ],
    };
  }
}
