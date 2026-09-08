import type { JSX } from "react";
import {
  registerReviewSession,
  ReviewSessionPlugin,
} from "lexical-review/client";
import type { ReviewSession } from "lexical-review";

// @ts-expect-error Core node APIs belong to the root entrypoint, not the client entrypoint.
import { ReviewInsertionNode } from "lexical-review/client";
// @ts-expect-error Client/editor APIs belong to the client entrypoint, not the root.
import { ReviewSessionPlugin as RootReviewSessionPlugin } from "lexical-review";

const v3Plugin: (props: { session: ReviewSession }) => JSX.Element | null =
  ReviewSessionPlugin;
const v3Register: (
  editor: import("lexical").LexicalEditor,
  session: ReviewSession,
) => () => void = registerReviewSession;
void v3Plugin;
void v3Register;
void ReviewInsertionNode;
void RootReviewSessionPlugin;
