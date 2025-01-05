import { useMemo, useEffect, createRef, act } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  LexicalEditor,
  ParagraphNode,
  RangeSelection,
  TextNode,
} from "lexical";
import { createTestEditor } from "./test-utils";
import { $createReviewTextNode, ReviewTextNode } from "./ReviewTextNode";
import { registerReviewText } from ".";

describe("Lexical Review Mode tests", async () => {
  let container: HTMLElement;
  let reactRoot: Root;
  let editor: LexicalEditor;

  function useLexicalEditor(
    rootElementRef: React.RefObject<HTMLDivElement>,
    onError?: (error: Error) => void,
  ) {
    const editor = useMemo(
      () =>
        createTestEditor({
          nodes: [
            ReviewTextNode,
            {
              replace: TextNode,
              with: (node: TextNode) => {
                return new ReviewTextNode(node.getTextContent());
              },
              withKlass: ReviewTextNode,
            },
          ],
          onError: onError || vitest.fn(),
          theme: {
            text: {
              bold: "editor-text-bold",
              italic: "editor-text-italic",
              underline: "editor-text-underline",
            },
          },
        }),
      [onError],
    );

    useEffect(() => {
      const rootElement = rootElementRef.current;

      editor.setRootElement(rootElement);
    }, [rootElementRef, editor]);

    return editor;
  }

  beforeEach(async () => {
    container = document.createElement("div");
    reactRoot = createRoot(container);
    document.body.appendChild(container);
    const ref = createRef<HTMLDivElement>();

    function TestBase() {
      editor = useLexicalEditor(ref);

      return <div ref={ref} contentEditable={true} />;
    }

    act(() => {
      reactRoot.render(<TestBase />);
    });

    registerReviewText(editor);
    await update(() => {
      const paragraph = $createParagraphNode();
      const origText = $createReviewTextNode("this is original.", "original");
      const insText = $createReviewTextNode("this is insertion.", "insertion");
      const delText = $createReviewTextNode("this is deletion.", "deletion");
      paragraph.append(origText, insText, delText);
      $getRoot().append(paragraph);
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vitest.restoreAllMocks();
  });

  async function update(fn: () => void) {
    editor.update(fn);

    return Promise.resolve().then();
  }

  it("exportJSON API - parses review text", async () => {
    const stringifiedEditorState = editor.getEditorState().toJSON();
    const parsedEditorState = editor.parseEditorState(stringifiedEditorState);
    parsedEditorState.read(() => {
      const parsedParagraph = $getRoot().getFirstChild() as ParagraphNode;
      const parsedOrigText = parsedParagraph.getChildAtIndex(
        0,
      ) as ReviewTextNode;
      const parsedInsText = parsedParagraph.getChildAtIndex(
        1,
      ) as ReviewTextNode;
      const parsedDelText = parsedParagraph.getChildAtIndex(
        2,
      ) as ReviewTextNode;

      expect(parsedParagraph.getTextContent()).toMatch(
        "this is original.this is insertion.this is deletion.",
      );
      expect(parsedOrigText.hasReviewType("original")).toBeTruthy();
      expect(parsedInsText.hasReviewType("insertion")).toBeTruthy();
      expect(parsedDelText.hasReviewType("deletion")).toBeTruthy();
    });
  });

  it("change the deletion to original", async() => {
    // for reminder (buggy test), because it will always return true
    await update(() => {
      const textContent = "Hello, world!";
      expect(textContent).toMatch("asdasdsdsadvcxv");
    });

    await update(() => {
      $getRoot().selectEnd();
    })

    editor.getEditorState().read(() => {
      const selection = $getSelection() as RangeSelection;
      const delNode = selection.getNodes().at(0) as ReviewTextNode; 
      expect(delNode.hasReviewType("deletion")).toBeTruthy();
    })
  })
});
