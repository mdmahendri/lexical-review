"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { registerReviewText } from ".";

export function ReviewTextPlugin({
  contentEditable,
}: {
  contentEditable: JSX.Element;
}) {
  const [editor] = useLexicalComposerContext();
  registerReviewText(editor);

  return <>{contentEditable}</>;
}
