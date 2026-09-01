import { JSX, useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { registerReviewText } from "./registerReviewText";
import {
  registerReviewSession,
  type ReviewSessionRegistrationOptions,
} from "./registerReviewSession";
import type { ReviewSession } from "./LegacyReviewSession";

export function ReviewTextPlugin({
  contentEditable,
  granularity = "character",
  onDeletionOutcome,
  onInsertionOutcome,
  onOutcome,
  session,
}: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
  onDeletionOutcome?: ReviewSessionRegistrationOptions["onDeletionOutcome"];
  onInsertionOutcome?: ReviewSessionRegistrationOptions["onInsertionOutcome"];
  onOutcome?: ReviewSessionRegistrationOptions["onOutcome"];
  session?: ReviewSession;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const unregisterReviewText = registerReviewText(editor, granularity);
    const unregisterReviewSession =
      session === undefined
        ? undefined
        : registerReviewSession(editor, session, {
            onDeletionOutcome,
            onInsertionOutcome,
            onOutcome,
          });
    return () => {
      unregisterReviewSession?.();
      unregisterReviewText();
    };
  }, [
    editor,
    granularity,
    onDeletionOutcome,
    onInsertionOutcome,
    onOutcome,
    session,
  ]);

  return <>{contentEditable}</>;
}
