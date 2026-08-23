import { JSX, useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { registerReviewText } from "./registerReviewText.js";

export function ReviewTextPlugin({
  contentEditable,
  granularity = "character",
}: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () => registerReviewText(editor, granularity),
    [editor, granularity],
  );

  return <>{contentEditable}</>;
}
