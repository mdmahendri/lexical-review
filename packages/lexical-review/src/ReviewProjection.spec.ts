import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setState,
  createEditor,
} from "lexical";
import { $createReviewProjection, REVIEW_SEGMENT } from "./ReviewProjection";
import { $createReviewTextNode, ReviewTextNode } from "./ReviewTextNode";

function createReviewEditor() {
  return createEditor({
    nodes: [ReviewTextNode],
    onError: (error) => void error,
  });
}

describe("reviewProjection", () => {
  it("maps points and ranges through insertion segments", () => {
    const editor = createReviewEditor();

    editor.update(
      () => {
        const insertion = $createReviewTextNode("X", "insertion");
        $setState(insertion, REVIEW_SEGMENT, { type: "draft-insertion" });
        const paragraph = $createParagraphNode().append(
          $createReviewTextNode("Al", "original"),
          insertion,
          $createReviewTextNode("pha", "original"),
        );
        $getRoot().append(paragraph);
        insertion.select(1, 1);
      },
      { discrete: true },
    );

    const point = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection)
        ? $createReviewProjection().inspect({
            kind: "selection-point",
            point: "anchor",
          })
        : null;
    });
    expect(point).toEqual({ offset: 2, paragraph: 0 });

    const range = editor.getEditorState().read(() =>
      $createReviewProjection().inspect({
        kind: "accepted-range",
        target: {
          end: { offset: 4, paragraph: 0 },
          start: { offset: 1, paragraph: 0 },
        },
      }),
    );
    expect(range).toEqual({
      requestedRuns: [{ format: 0, text: "lph" }],
      withinBounds: true,
    });
  });

  it("marks and restores a range without changing accepted formatting", () => {
    const editor = createReviewEditor();

    editor.update(
      () => {
        const text = $createReviewTextNode("Alpha", "original");
        text.setFormat(2);
        $getRoot().append($createParagraphNode().append(text));

        expect(
          $createReviewProjection().reconcile({
            kind: "mark-deletion",
            segment: { type: "draft-deletion" },
            target: {
              end: { offset: 3, paragraph: 0 },
              start: { offset: 1, paragraph: 0 },
            },
          }),
        ).toEqual({ status: "changed" });
      },
      { discrete: true },
    );

    expect(
      editor
        .getEditorState()
        .read(
          () => $createReviewProjection().inspect({ kind: "state" }).accepted,
        ),
    ).toEqual({ paragraphs: [{ runs: [{ format: 2, text: "Alpha" }] }] });
    expect(
      editor.getEditorState().read(() =>
        $createReviewProjection().inspect({
          kind: "accepted-range",
          target: {
            end: { offset: 3, paragraph: 0 },
            start: { offset: 1, paragraph: 0 },
          },
        }),
      ),
    ).toEqual({ requestedRuns: null, withinBounds: true });

    editor.update(
      () => {
        expect(
          $createReviewProjection().reconcile({
            kind: "restore-deletion-draft",
          }),
        ).toEqual({ status: "changed" });
      },
      { discrete: true },
    );

    expect(
      editor
        .getEditorState()
        .read(
          () => $createReviewProjection().inspect({ kind: "state" }).accepted,
        ),
    ).toEqual({ paragraphs: [{ runs: [{ format: 2, text: "Alpha" }] }] });
  });
});
