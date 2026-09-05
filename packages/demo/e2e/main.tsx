import { FormattingFixture } from "./FormattingFixture";
import { createRoot } from "react-dom/client";
import ReviewEditorFixture from "./ReviewEditorFixture";

import { DeletionFixture } from "./DeletionFixture";
import { InsertionFixture } from "./InsertionFixture";

createRoot(document.getElementById("root")!).render(
  location.search === "?formatting" ? (
    <FormattingFixture />
  ) : location.search === "?deletions" ? (
    <DeletionFixture />
  ) : location.search === "?insertions" ? (
    <InsertionFixture />
  ) : (
    <ReviewEditorFixture />
  ),
);
