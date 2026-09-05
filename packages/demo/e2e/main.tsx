import { createRoot } from "react-dom/client";
import ReviewEditorFixture from "./ReviewEditorFixture";

import { InsertionFixture } from "./InsertionFixture";

createRoot(document.getElementById("root")!).render(
  location.search === "?insertions" ? (
    <InsertionFixture />
  ) : (
    <ReviewEditorFixture />
  ),
);
