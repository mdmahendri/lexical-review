/* eslint-disable @typescript-eslint/no-require-imports */

import client = require("lexical-review/client");
import type { JSX } from "react";
import type { LexicalEditor } from "lexical";

const plugin: (props: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
}) => JSX.Element = client.ReviewTextPlugin;
const register: (
  editor: LexicalEditor,
  granularity?: "word" | "character",
) => () => void = client.registerReviewText;

void plugin;
void register;
