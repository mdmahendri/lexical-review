import { JSX } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { registerReviewText } from "./registerReviewText";

export function ReviewTextPlugin({
  contentEditable,
  granularity = "character",  
}: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
}) {
  const [editor] = useLexicalComposerContext();
  registerReviewText(editor, granularity);

  return <>{contentEditable}</>;
}
