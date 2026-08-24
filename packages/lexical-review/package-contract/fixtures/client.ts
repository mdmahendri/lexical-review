import type { JSX } from "react";
import type { LexicalEditor } from "lexical";
import { registerReviewText, ReviewTextPlugin } from "lexical-review/client";

// @ts-expect-error Core node APIs belong to the root entrypoint in v3.
import { ReviewTextNode } from "lexical-review/client";
// @ts-expect-error React/editor APIs belong to the client entrypoint in v3.
import { ReviewTextPlugin as RootReviewTextPlugin } from "lexical-review";

const plugin: (props: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
}) => JSX.Element = ReviewTextPlugin;
const register: (
  editor: LexicalEditor,
  granularity?: "word" | "character",
) => () => void = registerReviewText;

void plugin;
void register;
void ReviewTextNode;
void RootReviewTextPlugin;
