import type { JSX } from "react";
import type { LexicalEditor } from "lexical";
import {
  registerLegacyReviewText,
  LegacyReviewTextPlugin,
  registerReviewSession,
  ReviewSessionPlugin,
} from "lexical-review/client";
import type { ReviewSession } from "lexical-review";

// @ts-expect-error Core node APIs belong to the root entrypoint in v3.
import { ReviewTextNode } from "lexical-review/client";
// @ts-expect-error React/editor APIs belong to the client entrypoint in v3.
import { ReviewTextPlugin as RootReviewTextPlugin } from "lexical-review";

const plugin: (props: {
  contentEditable: JSX.Element;
  granularity?: "word" | "character";
}) => JSX.Element = LegacyReviewTextPlugin;
const register: (
  editor: LexicalEditor,
  granularity?: "word" | "character",
) => () => void = registerLegacyReviewText;
const v3Plugin: (props: { session: ReviewSession }) => JSX.Element | null =
  ReviewSessionPlugin;
const v3Register: (
  editor: LexicalEditor,
  session: ReviewSession,
) => () => void = registerReviewSession;
void plugin;
void register;
void v3Plugin;
void v3Register;
void ReviewTextNode;
void RootReviewTextPlugin;
