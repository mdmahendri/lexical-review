/* eslint-disable @typescript-eslint/no-require-imports */

import review = require("lexical-review");
import client = require("lexical-review/client");
import type { JSX } from "react";
import type { LexicalEditor } from "lexical";

const reviewType: review.TextReviewType = "original";
const reviewNode: review.ReviewTextNode = review.$createReviewTextNode(
  "commonjs consumer",
  reviewType,
);
const isReviewNode: boolean = review.$isReviewTextNode(reviewNode);
const plugin: (props: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
}) => JSX.Element = client.ReviewTextPlugin;
const register: (
  editor: LexicalEditor,
  granularity?: "word" | "character",
) => () => void = client.registerReviewText;

void isReviewNode;
void plugin;
void register;
