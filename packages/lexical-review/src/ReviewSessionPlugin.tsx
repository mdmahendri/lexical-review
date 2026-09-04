import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { registerReviewSession } from "./registerReviewSession";
import type { ReviewSessionRegistrationOptions } from "./registerReviewSession";
import type { ReviewSession } from "./ReviewSession";

export function ReviewSessionPlugin({
  onDeletionOutcome,
  onInsertionOutcome,
  onOutcome,
  proposalIdFactory,
  session,
}: ReviewSessionRegistrationOptions & {
  session: ReviewSession;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const unregister = registerReviewSession(editor, session, {
      onDeletionOutcome,
      onInsertionOutcome,
      onOutcome,
      proposalIdFactory,
    });
    return unregister;
  }, [
    editor,
    onDeletionOutcome,
    onInsertionOutcome,
    onOutcome,
    proposalIdFactory,
    session,
  ]);

  return null;
}
