import client = require("lexical-review/client");
import type { JSX } from "react";
import type { ReviewSession } from "lexical-review";

const v3Plugin: (props: { session: ReviewSession }) => JSX.Element | null =
  client.ReviewSessionPlugin;
void v3Plugin;
