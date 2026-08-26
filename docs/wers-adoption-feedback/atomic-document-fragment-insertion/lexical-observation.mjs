import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(
  new URL("../../../packages/lexical-review/package.json", import.meta.url),
);
const clipboardImport = await import(
  pathToFileURL(require.resolve("@lexical/clipboard")).href
);
const lexicalImport = await import(
  pathToFileURL(require.resolve("lexical")).href
);
const clipboard = clipboardImport.default ?? clipboardImport;
const lexical = lexicalImport.default ?? lexicalImport;

const { $insertDataTransferForRichText } = clipboard;
const {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} = lexical;

const editor = createEditor({
  namespace: "wer-atomic-document-fragment-insertion",
  onError(error) {
    throw error;
  },
});

await new Promise((resolve) => {
  editor.update(
    () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const text = $createTextNode("AB");
      paragraph.append(text);
      root.append(paragraph);
      text.select(1, 1);

      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        throw new Error("fixture did not create a collapsed range selection");
      }

      const dataTransfer = {
        getData(type) {
          return type === "text/plain" ? "x\ny" : "";
        },
      };
      $insertDataTransferForRichText(dataTransfer, selection, editor);
    },
    { onUpdate: resolve },
  );
});

const paragraphs = editor.getEditorState().read(() =>
  $getRoot()
    .getChildren()
    .map((paragraph) => paragraph.getTextContent()),
);

globalThis.process.stdout.write(
  `${JSON.stringify({
    lexicalVersion: "0.49.0",
    paragraphs,
  })}\n`,
);
