import { FragmentFixture } from "./FragmentFixture";
import { RouteWiringFixture } from "./RouteWiringFixture";
import { StructureFixture } from "./StructureFixture";
import { FormattingFixture } from "./FormattingFixture";
import { createRoot } from "react-dom/client";
import ReviewEditorFixture from "./ReviewEditorFixture";

import { DeletionFixture } from "./DeletionFixture";
import { InsertionFixture } from "./InsertionFixture";

createRoot(document.getElementById("root")!).render(
  location.search.startsWith("?route-wiring") ? (
    <RouteWiringFixture />
  ) : location.search.startsWith("?fragment") ? (
    <FragmentFixture />
  ) : location.search.startsWith("?structure") ? (
    <StructureFixture />
  ) : location.search === "?formatting" ? (
    <FormattingFixture />
  ) : location.search === "?deletions" ? (
    <DeletionFixture />
  ) : location.search === "?insertions" ? (
    <InsertionFixture />
  ) : (
    <ReviewEditorFixture />
  ),
);
