import client = require("lexical-review/client");
import type { JSX } from "react";
import type { LexicalEditor } from "lexical";

const plugin: (props: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
}) => JSX.Element = client.LegacyReviewTextPlugin;
const register: (
  editor: LexicalEditor,
  granularity?: "word" | "character",
) => () => void = client.registerLegacyReviewText;
void plugin;
void register;
