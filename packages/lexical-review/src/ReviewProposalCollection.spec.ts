import {
  $getRoot,
  createEditor,
  type ParagraphNode,
  type TextNode,
} from "lexical";
import {
  $insertReviewFragment,
  $insertReviewText,
  $splitReviewParagraph,
  $createReviewFragmentNode,
  $createReviewInsertionNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewBoundaryNode,
  openReviewSession,
} from "./index";
import {
  collectProposalNodes,
  inspectFragmentGroup,
} from "./ReviewProposalCollection";
import {
  paragraph,
  text,
  reviewDocument,
} from "./ReviewDocument.test-fixtures";

const id = (value: string) => ({ proposalIdFactory: () => value });
const fragment = (value: string, format = 0) =>
  value.split("\n").map((text) => ({
    runs: text ? [{ text, format }] : [],
    emptyFormat: format,
  }));

function setup() {
  const editor = createEditor({
    nodes: [
      ReviewFragmentNode,
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewBoundaryNode,
    ],
    onError(error) {
      throw error;
    },
  });
  const opened = openReviewSession(
    editor,
    reviewDocument([paragraph([text("AB")])]),
  );
  if (opened.status !== "valid") throw new Error(JSON.stringify(opened));
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  const read = <T>(fn: () => T) => editor.getEditorState().read(fn);
  const caret = (offset = 1) =>
    update(() => {
      $getRoot()
        .getFirstChildOrThrow<ParagraphNode>()
        .getFirstChildOrThrow<TextNode>()
        .select(offset, offset);
    });
  return { editor, update, read, caret };
}

describe("collectProposalNodes", () => {
  it("gathers insertion wrappers by identity", () => {
    const { caret, update, read } = setup();
    caret();
    update(() => {
      expect($insertReviewText("hello", id("a")).status).toBe("changed");
    });
    read(() => {
      const collected = collectProposalNodes("a");
      expect(collected.wrappers.length).toBe(1);
      expect(collected.fragments.length).toBe(0);
      expect(collected.boundaryIdentity).toBe(false);
    });
  });

  it("gathers fragment components across paragraphs", () => {
    const { caret, update, read } = setup();
    caret();
    update(() => {
      expect($insertReviewFragment(fragment("x\ny"), id("f")).status).toBe(
        "changed",
      );
    });
    read(() => {
      const collected = collectProposalNodes("f");
      expect(collected.wrappers.length).toBe(2);
      expect(collected.fragments.length).toBe(2);
      expect(collected.boundaryIdentity).toBe(false);
    });
  });

  it("flags a shared structural boundary identity", () => {
    const { caret, update, read } = setup();
    caret();
    update(() => {
      expect($splitReviewParagraph(id("s")).status).toBe("changed");
    });
    read(() => {
      expect(collectProposalNodes("s").boundaryIdentity).toBe(true);
    });
  });

  it("returns an empty collection for an unknown identity", () => {
    const { read } = setup();
    read(() => {
      const collected = collectProposalNodes("missing");
      expect(collected.wrappers).toEqual([]);
      expect(collected.fragments).toEqual([]);
      expect(collected.boundaryIdentity).toBe(false);
    });
  });
});

describe("inspectFragmentGroup", () => {
  it("validates a well-formed fragment", () => {
    const { caret, update, read } = setup();
    caret();
    update(() => {
      expect($insertReviewFragment(fragment("x\ny"), id("f")).status).toBe(
        "changed",
      );
    });
    read(() => {
      const group = inspectFragmentGroup("f");
      expect(group.status).toBe("ready");
      if (group.status === "ready") {
        expect(group.value.wrappers.length).toBe(2);
        expect(group.value.paragraphs.length).toBe(2);
      }
    });
  });

  it("refuses an identity shared with a text proposal", () => {
    const { update, read } = setup();
    update(() => {
      $getRoot()
        .getFirstChildOrThrow<ParagraphNode>()
        .append(
          $createReviewInsertionNode("x"),
          $createReviewFragmentNode("x"),
        );
    });
    read(() => {
      const group = inspectFragmentGroup("x");
      expect(group.status).not.toBe("ready");
      if (group.status !== "ready") {
        expect(group.code).toBe("unsafe-proposal-intersection");
      }
    });
  });
});
