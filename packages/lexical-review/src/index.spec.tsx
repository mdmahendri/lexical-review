import { useMemo, useEffect, createRef, act } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  BEFORE_INPUT_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_WORD_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  LexicalEditor,
  ParagraphNode,
  RangeSelection,
  TextNode,
} from "lexical";
import { createTestEditor } from "./test-utils";
import {
  $createReviewTextNode,
  $isReviewTextNode,
  ReviewTextNode,
} from "./ReviewTextNode";
import { registerReviewText } from "./client";
import { $markTypingInsert, $markForDelete } from "./ReviewSelection";

describe("Lexical Review Mode tests", () => {
  let container: HTMLElement;
  let reactRoot: Root;
  let editor: LexicalEditor;

  function useLexicalEditor(
    rootElementRef: React.RefObject<HTMLDivElement | null>,
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
                return $createReviewTextNode(node.getTextContent(), "original");
              },
              withKlass: ReviewTextNode,
            },
          ],
          onError: onError || vitest.fn(),
          theme: {
            text: {
              base: "editor-text-base",
              bold: "editor-text-bold",
              capitalize: "editor-text-capitalize",
              code: "editor-text-code",
              highlight: "editor-text-highlight",
              italic: "editor-text-italic",
              lowercase: "editor-text-lowercase",
              strikethrough: "editor-text-strikethrough",
              subscript: "editor-text-subscript",
              superscript: "editor-text-superscript",
              underline: "editor-text-underline",
              uppercase: "editor-text-uppercase",
            },
            ins: "review-insertion",
            del: "review-deletion",
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

  describe("ReviewTextNode Creation & Properties", () => {
    it("creates review text node with correct type", async () => {
      await update(() => {
        const origNode = $createReviewTextNode("test", "original");
        const insNode = $createReviewTextNode("test", "insertion");
        const delNode = $createReviewTextNode("test", "deletion");

        expect(origNode.hasReviewType("original")).toBe(true);
        expect(insNode.hasReviewType("insertion")).toBe(true);
        expect(delNode.hasReviewType("deletion")).toBe(true);
      });
    });

    it("$isReviewTextNode correctly identifies review nodes", async () => {
      await update(() => {
        const reviewNode = $createReviewTextNode("test");
        const paragraph = $createParagraphNode();

        expect($isReviewTextNode(reviewNode)).toBe(true);
        expect($isReviewTextNode(paragraph)).toBe(false);
        expect($isReviewTextNode(null)).toBe(false);
      });
    });

    it("defaults to insertion type when no type specified", async () => {
      await update(() => {
        const node = $createReviewTextNode("test");
        expect(node.hasReviewType("insertion")).toBe(true);
      });
    });

    it("getType returns 'review'", async () => {
      await update(() => {
        const node = $createReviewTextNode("test");
        expect(node.getType()).toBe("review");
      });
    });
  });

  describe("Review Type Changes", () => {
    it("changes review type from original to deletion", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        expect(origNode.hasReviewType("original")).toBe(true);
        origNode.setReviewType("deletion");
        expect(origNode.hasReviewType("deletion")).toBe(true);
      });
    });

    it("changes review type from deletion to original", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const delNode = paragraph.getChildAtIndex(2) as ReviewTextNode;

        expect(delNode.hasReviewType("deletion")).toBe(true);
        delNode.setReviewType("original");
        expect(delNode.hasReviewType("original")).toBe(true);
      });
    });

    it("setReviewType returns same node if type hasn't changed", async () => {
      await update(() => {
        const node = $createReviewTextNode("test", "original");
        const sameNode = node.setReviewType("original");
        expect(sameNode).toBe(node);
      });
    });
  });

  describe("JSON Serialization & Deserialization", () => {
    it("exports and imports JSON correctly", async () => {
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

        expect(parsedParagraph.getTextContent()).toBe(
          "this is original.this is insertion.this is deletion.",
        );
        expect(parsedOrigText.hasReviewType("original")).toBe(true);
        expect(parsedInsText.hasReviewType("insertion")).toBe(true);
        expect(parsedDelText.hasReviewType("deletion")).toBe(true);
      });
    });

    it("preserves text content in JSON export", async () => {
      await update(() => {
        const node = $createReviewTextNode("test content", "insertion");
        const json = node.exportJSON();

        expect(json.text).toBe("test content");
        expect(json.type).toBe("review");
      });
    });
  });

  describe("DOM Creation & Updates", () => {
    it("creates correct DOM structure for original text", async () => {
      // Clear existing content first
      await update(() => {
        $getRoot().clear();
        const node = $createReviewTextNode("test", "original");
        const paragraph = $createParagraphNode();
        paragraph.append(node);
        $getRoot().append(paragraph);
      });

      const spans = container.querySelectorAll("span");
      const testSpan = Array.from(spans).find(
        (span) => span.textContent === "test",
      );
      expect(testSpan).toBeTruthy();
      expect(testSpan?.textContent).toBe("test");
    });

    it("creates <ins> tag for insertion type", async () => {
      const dom = container.querySelector("ins");
      expect(dom).toBeTruthy();
      expect(dom?.textContent).toBe("this is insertion.");
    });

    it("creates <del> tag for deletion type", async () => {
      const dom = container.querySelector("del");
      expect(dom).toBeTruthy();
      expect(dom?.textContent).toBe("this is deletion.");
    });

    it("applies theme classes to ins/del tags", async () => {
      const insTag = container.querySelector("ins");
      const delTag = container.querySelector("del");

      expect(insTag?.classList.contains("review-insertion")).toBe(true);
      expect(delTag?.classList.contains("review-deletion")).toBe(true);
    });

    describe.each([
      ["insertion", "INS"],
      ["deletion", "DEL"],
    ] as const)("%s markup", (reviewType, reviewTag) => {
      it.each([
        ["bold", "STRONG", null],
        ["italic", "EM", null],
        ["underline", "SPAN", null],
        ["strikethrough", "SPAN", null],
        ["highlight", "MARK", "SPAN"],
        ["code", "CODE", "SPAN"],
        ["subscript", "SUB", "SPAN"],
        ["superscript", "SUP", "SPAN"],
        ["lowercase", "SPAN", null],
        ["uppercase", "SPAN", null],
        ["capitalize", "SPAN", null],
      ] as const)(
        "renders %s formatting inside review markup",
        async (format, outerTag, innerTag) => {
          let reviewNode: ReviewTextNode;

          await update(() => {
            reviewNode = $createReviewTextNode("formatted", reviewType);
            reviewNode.toggleFormat(format);
            const paragraph = $createParagraphNode();
            paragraph.append(reviewNode);
            $getRoot().clear().append(paragraph);
          });

          const reviewDOM = editor.getElementByKey(reviewNode!.getKey());
          const formattingDOM = reviewDOM?.firstElementChild as HTMLElement;
          const contentDOM = (
            innerTag === null ? formattingDOM : formattingDOM.firstElementChild
          ) as HTMLElement;

          expect(reviewDOM?.tagName).toBe(reviewTag);
          expect(formattingDOM?.tagName).toBe(outerTag);
          expect(contentDOM?.tagName).toBe(innerTag ?? outerTag);
          expect(contentDOM?.textContent).toBe("formatted");
          expect(contentDOM?.classList.contains(`editor-text-${format}`)).toBe(
            true,
          );
          expect(reviewNode!.getDOMSlot(reviewDOM!).element).toBe(contentDOM);
        },
      );
    });

    it("reconciles inline styles and preserves formatting after text updates", async () => {
      let reviewNode: ReviewTextNode;

      await update(() => {
        reviewNode = $createReviewTextNode("formatted", "insertion");
        reviewNode.toggleFormat("italic");
        reviewNode.setStyle("color: red; --custom: value;");
        const paragraph = $createParagraphNode();
        paragraph.append(reviewNode);
        $getRoot().clear().append(paragraph);
      });

      const reviewDOM = editor.getElementByKey(reviewNode!.getKey());
      expect(reviewDOM?.style.color).toBe("red");
      expect(reviewDOM?.style.getPropertyValue("--custom")).toBe("value");

      await update(() => {
        reviewNode!.setStyle("padding: 1px;");
        reviewNode!.setTextContent("updated");
      });

      const updatedReviewDOM = editor.getElementByKey(reviewNode!.getKey());
      expect(updatedReviewDOM?.tagName).toBe("INS");
      expect(updatedReviewDOM?.firstElementChild?.tagName).toBe("EM");
      expect(updatedReviewDOM?.textContent).toBe("updated");
      expect(updatedReviewDOM?.style.color).toBe("");
      expect(updatedReviewDOM?.style.getPropertyValue("--custom")).toBe("");
      expect(updatedReviewDOM?.style.padding).toBe("1px");
    });

    it("reconciles review text through the content slot", async () => {
      let originalNode: ReviewTextNode;
      let insertionNode: ReviewTextNode;
      let deletionNode: ReviewTextNode;

      await update(() => {
        originalNode = $createReviewTextNode("original", "original");
        insertionNode = $createReviewTextNode("inserted", "insertion");
        deletionNode = $createReviewTextNode("deleted", "deletion");

        const paragraph = $createParagraphNode();
        paragraph.append(originalNode, insertionNode, deletionNode);
        $getRoot().clear().append(paragraph);
      });

      const originalDOM = editor.getElementByKey(originalNode!.getKey());
      const insertionDOM = editor.getElementByKey(insertionNode!.getKey());
      const deletionDOM = editor.getElementByKey(deletionNode!.getKey());

      expect(originalDOM?.tagName).toBe("SPAN");
      expect(insertionDOM?.tagName).toBe("INS");
      expect(insertionDOM?.classList.contains("review-insertion")).toBe(true);
      expect(insertionDOM?.firstElementChild?.tagName).toBe("SPAN");
      expect(insertionDOM?.textContent).toBe("inserted");
      expect(deletionDOM?.tagName).toBe("DEL");
      expect(deletionDOM?.classList.contains("review-deletion")).toBe(true);
      expect(deletionDOM?.firstElementChild?.tagName).toBe("SPAN");
      expect(deletionDOM?.textContent).toBe("deleted");

      expect(originalNode!.getDOMSlot(originalDOM!).element).toBe(originalDOM);
      expect(insertionNode!.getDOMSlot(insertionDOM!).element).toBe(
        insertionDOM!.firstElementChild,
      );
      expect(deletionNode!.getDOMSlot(deletionDOM!).element).toBe(
        deletionDOM!.firstElementChild,
      );

      await update(() => {
        originalNode!.setTextContent("updated original");
        insertionNode!.setTextContent("updated insertion");
        deletionNode!.setTextContent("updated deletion");
      });

      expect(originalDOM?.textContent).toBe("updated original");
      expect(insertionDOM?.firstElementChild?.textContent).toBe(
        "updated insertion",
      );
      expect(deletionDOM?.firstElementChild?.textContent).toBe(
        "updated deletion",
      );
    });
  });

  describe("Text Insertion Operations", () => {
    it("requires ReviewTextNode to be registered", () => {
      const editorWithoutReviewNode = createTestEditor();

      expect(() => registerReviewText(editorWithoutReviewNode)).toThrow(
        "registerReviewText requires ReviewTextNode to be registered in the editor.",
      );
    });

    it("normalizes ordinary text nodes into review text nodes", async () => {
      await update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append(new TextNode("untracked"));
        $getRoot().append(paragraph);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getLastChild() as ParagraphNode;
        const textNode = paragraph.getFirstChild();

        expect($isReviewTextNode(textNode)).toBe(true);
        expect((textNode as ReviewTextNode).hasReviewType("original")).toBe(
          true,
        );
        expect(textNode?.getTextContent()).toBe("untracked");
      });
    });

    it("marks ordinary beforeinput text as a review insertion", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const originalNode = paragraph.getChildAtIndex(0) as ReviewTextNode;
        const domTextNode = editor.getElementByKey(
          originalNode.getKey(),
        )?.firstChild;
        const domSelection = window.getSelection();

        originalNode.select(0, 0);
        if (domTextNode == null || domSelection == null) {
          throw new Error("Expected a DOM text node and selection.");
        }

        const domRange = document.createRange();
        domRange.setStart(domTextNode, 0);
        domRange.collapse(true);
        domSelection.removeAllRanges();
        domSelection.addRange(domRange);

        const event = new InputEvent("beforeinput", {
          data: "i",
          inputType: "insertText",
        });

        expect(editor.dispatchCommand(BEFORE_INPUT_COMMAND, event)).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const insertedNode = paragraph.getFirstChild() as ReviewTextNode;

        expect(insertedNode.hasReviewType("insertion")).toBe(true);
        expect(insertedNode.getTextContent()).toBe("i");
      });
    });

    it("marks Unicode text inserted through Lexical's controlled insertion command", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const originalNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        originalNode.select(0, 0);
        expect(
          editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "é"),
        ).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const insertedNode = paragraph.getFirstChild() as ReviewTextNode;

        expect(insertedNode.hasReviewType("insertion")).toBe(true);
        expect(insertedNode.getTextContent()).toBe("é");
      });
    });

    it("marks selected text as deleted before inserting replacement text", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const originalNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        originalNode.select(0, 4);
        expect(
          editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "new"),
        ).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const children = paragraph.getChildren() as ReviewTextNode[];

        expect(children).toHaveLength(5);
        expect(children[0].getTextContent()).toBe("this");
        expect((children[0] as ReviewTextNode).hasReviewType("deletion")).toBe(
          true,
        );
        expect(children[1].getTextContent()).toBe("new");
        expect((children[1] as ReviewTextNode).hasReviewType("insertion")).toBe(
          true,
        );
        expect(children[2].getTextContent()).toBe(" is original.");
        expect((children[2] as ReviewTextNode).hasReviewType("original")).toBe(
          true,
        );
      });
    });

    it("marks text replaced through an InputEvent as a review replacement", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const originalNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        originalNode.select(0, 4);
        const event = new InputEvent("beforeinput", {
          data: "new",
          inputType: "insertReplacementText",
        });

        expect(
          editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, event),
        ).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const children = paragraph.getChildren() as ReviewTextNode[];

        expect(children[0].getTextContent()).toBe("this");
        expect((children[0] as ReviewTextNode).hasReviewType("deletion")).toBe(
          true,
        );
        expect(children[1].getTextContent()).toBe("new");
        expect((children[1] as ReviewTextNode).hasReviewType("insertion")).toBe(
          true,
        );
      });
    });

    it("inserts replacement text after a backwards selection", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const originalNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        originalNode.select(4, 0);
        expect(
          editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "new"),
        ).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const children = paragraph.getChildren() as ReviewTextNode[];

        expect(children[0].getTextContent()).toBe("this");
        expect((children[0] as ReviewTextNode).hasReviewType("deletion")).toBe(
          true,
        );
        expect(children[1].getTextContent()).toBe("new");
        expect((children[1] as ReviewTextNode).hasReviewType("insertion")).toBe(
          true,
        );
      });
    });

    it("inserts text at the beginning of original node", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        origNode.select(0, 0);
        const selection = $getSelection() as RangeSelection;
        $markTypingInsert(selection, "NEW ");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const children = paragraph.getChildren();

        expect(children.length).toBeGreaterThan(1);
        const firstChild = children[0] as ReviewTextNode;
        expect($isReviewTextNode(firstChild)).toBe(true);
        expect(firstChild.hasReviewType("insertion")).toBe(true);
        expect(firstChild.getTextContent()).toBe("NEW ");
      });
    });

    it("inserts text in the middle of original node", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        origNode.select(5, 5); // After "this "
        const selection = $getSelection() as RangeSelection;
        $markTypingInsert(selection, "INSERTED ");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const children = paragraph.getChildren();

        expect(children.length).toBeGreaterThan(3);
        // Should split: "this " + "INSERTED " + "is original."
        const insertedNode = children.find(
          (child) =>
            $isReviewTextNode(child) &&
            child.getTextContent().includes("INSERTED"),
        ) as ReviewTextNode;

        expect(insertedNode).toBeTruthy();
        expect(insertedNode.hasReviewType("insertion")).toBe(true);
      });
    });

    it("appends to existing insertion node", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const insNode = paragraph.getChildAtIndex(1) as ReviewTextNode;
        const textLength = insNode.getTextContent().length;

        insNode.select(textLength, textLength);
        const selection = $getSelection() as RangeSelection;
        $markTypingInsert(selection, " MORE");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const insNode = paragraph.getChildAtIndex(1) as ReviewTextNode;

        expect(insNode.getTextContent()).toBe("this is insertion. MORE");
      });
    });
  });

  describe("Paragraph Operations", () => {
    it("handles INSERT_PARAGRAPH_COMMAND like Enter", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const originalNode = paragraph.getFirstChild() as ReviewTextNode;

        originalNode.select(5, 5);
        expect(
          editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined),
        ).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraphs = $getRoot().getChildren() as ParagraphNode[];

        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[0]?.getTextContent()).toBe("this ");
        expect(paragraphs[1]?.getTextContent()).toBe(
          "is original.this is insertion.this is deletion.",
        );
      });
    });
  });

  describe("Text Deletion Operations", () => {
    it("deletes the preceding word at a word boundary", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        origNode.select(5, 8); // "is " before "original."
        expect(editor.dispatchCommand(DELETE_WORD_COMMAND, true)).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const deletedNode = paragraph
          .getChildren()
          .find(
            (child) =>
              $isReviewTextNode(child) &&
              child.hasReviewType("deletion") &&
              child.getTextContent() === "is ",
          );

        expect(deletedNode).toBeTruthy();
      });
    });

    it("deletes the following word at a word boundary", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        origNode.select(0, 5); // "this " before "is original."
        expect(editor.dispatchCommand(DELETE_WORD_COMMAND, false)).toBe(true);
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const deletedNode = paragraph
          .getChildren()
          .find(
            (child) =>
              $isReviewTextNode(child) &&
              child.hasReviewType("deletion") &&
              child.getTextContent() === "this ",
          );

        expect(deletedNode).toBeTruthy();
      });
    });

    it("routes Ctrl+Backspace through DELETE_WORD_COMMAND", async () => {
      let receivedDirection: boolean | null = null;
      const removeCommandListener = editor.registerCommand(
        DELETE_WORD_COMMAND,
        (isBackward) => {
          receivedDirection = isBackward;
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      );

      try {
        await update(() => {
          const paragraph = $getRoot().getFirstChild() as ParagraphNode;
          const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;
          const rootElement = editor.getRootElement();

          origNode.select(5, 8);
          if (rootElement == null) {
            throw new Error("Expected the editor root element.");
          }

          rootElement.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Backspace",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      } finally {
        removeCommandListener();
      }

      expect(receivedDirection).toBe(true);
    });

    it("routes Ctrl+Delete through DELETE_WORD_COMMAND", async () => {
      let receivedDirection: boolean | null = null;
      const removeCommandListener = editor.registerCommand(
        DELETE_WORD_COMMAND,
        (isBackward) => {
          receivedDirection = isBackward;
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      );

      try {
        await update(() => {
          const paragraph = $getRoot().getFirstChild() as ParagraphNode;
          const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;
          const rootElement = editor.getRootElement();

          origNode.select(0, 5);
          if (rootElement == null) {
            throw new Error("Expected the editor root element.");
          }

          rootElement.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Delete",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      } finally {
        removeCommandListener();
      }

      expect(receivedDirection).toBe(false);
    });

    it("handles DELETE_CHARACTER_COMMAND as a review deletion", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        origNode.select(0, 4);
        expect(editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true)).toBe(
          true,
        );
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const deletedNode = paragraph
          .getChildren()
          .find(
            (child) =>
              $isReviewTextNode(child) &&
              child.hasReviewType("deletion") &&
              child.getTextContent() === "this",
          );

        expect(deletedNode).toBeTruthy();
      });
    });

    it("routes KEY_BACKSPACE_COMMAND through DELETE_CHARACTER_COMMAND", async () => {
      let receivedDirection: boolean | null = null;
      const removeCommandListener = editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (isBackward) => {
          receivedDirection = isBackward;
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      );

      try {
        await update(() => {
          const paragraph = $getRoot().getFirstChild() as ParagraphNode;
          const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

          origNode.select(0, 4);
          editor.dispatchCommand(
            KEY_BACKSPACE_COMMAND,
            new KeyboardEvent("keydown", {
              key: "Backspace",
              cancelable: true,
            }),
          );
        });
      } finally {
        removeCommandListener();
      }

      expect(receivedDirection).toBe(true);
      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const firstNode = paragraph.getFirstChild() as ReviewTextNode;

        expect(firstNode.getTextContent()).toBe("this is original.");
        expect(firstNode.hasReviewType("original")).toBe(true);
      });
    });

    it("routes KEY_DELETE_COMMAND through DELETE_CHARACTER_COMMAND", async () => {
      let receivedDirection: boolean | null = null;
      const removeCommandListener = editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (isBackward) => {
          receivedDirection = isBackward;
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      );

      try {
        await update(() => {
          const paragraph = $getRoot().getFirstChild() as ParagraphNode;
          const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

          origNode.select(0, 4);
          editor.dispatchCommand(
            KEY_DELETE_COMMAND,
            new KeyboardEvent("keydown", {
              key: "Delete",
              cancelable: true,
            }),
          );
        });
      } finally {
        removeCommandListener();
      }

      expect(receivedDirection).toBe(false);
      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const firstNode = paragraph.getFirstChild() as ReviewTextNode;

        expect(firstNode.getTextContent()).toBe("this is original.");
        expect(firstNode.hasReviewType("original")).toBe(true);
      });
    });

    it("marks original text as deletion", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        origNode.select(0, 4); // Select "this"
        const selection = $getSelection() as RangeSelection;
        $markForDelete(selection, false, "character");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const hasDelNode = paragraph
          .getChildren()
          .some(
            (child) =>
              $isReviewTextNode(child) && child.hasReviewType("deletion"),
          );

        expect(hasDelNode).toBe(true);
      });
    });

    it("removes insertion text completely", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const insNode = paragraph.getChildAtIndex(1) as ReviewTextNode;

        const text = insNode.getTextContent();
        insNode.select(0, text.length);
        const selection = $getSelection() as RangeSelection;
        $markForDelete(selection, false, "character");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const children = paragraph.getChildren();

        // Insertion node should be removed or empty
        const hasInsertionWithOriginalText = children.some(
          (child) =>
            $isReviewTextNode(child) &&
            child.hasReviewType("insertion") &&
            child.getTextContent() === "this is insertion.",
        );

        expect(hasInsertionWithOriginalText).toBe(false);
      });
    });

    it("reverts deletion to original when deleting deletion node", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const delNode = paragraph.getChildAtIndex(2) as ReviewTextNode;

        const text = delNode.getTextContent();
        delNode.select(0, text.length);
        const selection = $getSelection() as RangeSelection;
        $markForDelete(selection, false, "character");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const lastNode = paragraph.getChildAtIndex(2) as ReviewTextNode;

        expect(lastNode.hasReviewType("original")).toBe(true);
      });
    });
  });

  describe("Node Splitting & Merging", () => {
    it("splits original node on insertion", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const origNode = paragraph.getChildAtIndex(0) as ReviewTextNode;

        origNode.select(8, 8); // After "this is "
        const selection = $getSelection() as RangeSelection;
        $markTypingInsert(selection, "NEW");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const children = paragraph.getChildren();

        // Should have more children after split
        expect(children.length).toBeGreaterThan(3);
      });
    });

    it("deleteInsertionText removes partial text from insertion node", async () => {
      await update(() => {
        const node = $createReviewTextNode("Hello World", "insertion");
        const paragraph = $createParagraphNode();
        paragraph.append(node);

        node.deleteInsertionText(6, 5); // Remove "World"
        expect(node.getTextContent()).toBe("Hello ");
      });
    });

    it("deleteOriginalText splits and marks middle as deletion", async () => {
      await update(() => {
        const node = $createReviewTextNode("Hello World Test", "original");
        const paragraph = $createParagraphNode();
        paragraph.append(node);
        $getRoot().append(paragraph);

        const resultNodes = node.deleteOriginalText(6, 5); // Remove "World"

        expect(resultNodes.length).toBe(3);
        expect(resultNodes[0]?.getTextContent()).toBe("Hello ");
        expect(resultNodes[1]?.getTextContent()).toBe("World");
        expect(resultNodes[1]?.hasReviewType("deletion")).toBe(true);
        expect(resultNodes[2]?.getTextContent()).toBe(" Test");
      });
    });
  });

  describe("Selection & Navigation", () => {
    it("selects node at end position", async () => {
      await update(() => {
        $getRoot().selectEnd();
      });

      editor.getEditorState().read(() => {
        const selection = $getSelection() as RangeSelection;
        const node = selection.getNodes()[0] as ReviewTextNode;

        expect($isReviewTextNode(node)).toBe(true);
        expect(node.hasReviewType("deletion")).toBe(true);
      });
    });

    it("selects node at start position", async () => {
      await update(() => {
        $getRoot().selectStart();
      });

      editor.getEditorState().read(() => {
        const selection = $getSelection() as RangeSelection;
        const node = selection.getNodes()[0] as ReviewTextNode;

        expect($isReviewTextNode(node)).toBe(true);
        expect(node.hasReviewType("original")).toBe(true);
      });
    });
  });

  describe("Edge Cases", () => {
    it("handles empty text nodes", async () => {
      await update(() => {
        const node = $createReviewTextNode("", "original");
        const paragraph = $createParagraphNode();
        paragraph.append(node);

        expect(node.getTextContent()).toBe("");
        expect($isReviewTextNode(node)).toBe(true);
      });
    });

    it("handles special characters in text", async () => {
      await update(() => {
        const specialText = "Test\n\tSpecial™️ 🎉 chars";
        const node = $createReviewTextNode(specialText, "original");

        expect(node.getTextContent()).toBe(specialText);
      });
    });

    it("prevents insertion into middle of deletion node", async () => {
      await update(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const delNode = paragraph.getChildAtIndex(2) as ReviewTextNode;

        delNode.select(5, 5); // Middle of deletion
        const selection = $getSelection() as RangeSelection;
        $markTypingInsert(selection, "TEST");
      });

      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild() as ParagraphNode;
        const delNode = paragraph.getChildAtIndex(2) as ReviewTextNode;

        // Should not have inserted into deletion node
        expect(delNode.getTextContent()).not.toContain("TEST");
      });
    });
  });

  describe("Clone & Copy", () => {
    it("clones node with same review type", async () => {
      await update(() => {
        const original = $createReviewTextNode("test", "insertion");
        const cloned = ReviewTextNode.clone(original);

        expect(cloned.getTextContent()).toBe("test");
        expect(cloned.hasReviewType("insertion")).toBe(true);
        expect(cloned.getKey()).not.toBe(original.getKey());
      });
    });
  });
});
