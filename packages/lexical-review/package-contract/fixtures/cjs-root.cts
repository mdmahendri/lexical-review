import review = require("lexical-review");
import lexical = require("lexical");

const nodeClass: typeof review.ReviewInsertionNode = review.ReviewInsertionNode;
const editor = lexical.createEditor({
  nodes: [review.ReviewInsertionNode, review.ReviewDeletionNode],
  onError: (error) => void error,
});
const opened: review.ValidationResult<review.ReviewSession> =
  review.openReviewSession(editor, {
    root: {
      children: [
        {
          children: [],
          direction: null,
          format: "",
          indent: 0,
          textFormat: 0,
          textStyle: "",
          type: "paragraph",
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
      $: { "lexical-review": { extensions: [], version: 3 } },
    },
  });

void nodeClass;
void opened;
