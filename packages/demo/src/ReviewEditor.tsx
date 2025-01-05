import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ReviewTextPlugin } from "lexical-review";

const placeholder = "";

const dataDummy = `
{
  "root": {
    "children": [
      {
        "children": [
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "Lorem Ipsum Generator",
            "type": "review",
            "review": 1,
            "version": 1
          }
        ],
        "direction": "ltr",
        "format": "",
        "indent": 0,
        "type": "paragraph",
        "version": 1,
        "textFormat": 0,
        "textStyle": ""
      },
      {
        "children": [
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "Lorem ipsum dolor sit amet, ",
            "type": "review",
            "review": 1,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "consectetur adipiscing elit, ",
            "type": "review",
            "review": 2,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "sed do eiusmod tempor ",
            "type": "review",
            "review": 1,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "incididunt ut labore ",
            "type": "review",
            "review": 4,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "dolore magna aliqua.",
            "type": "review",
            "review": 1,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": " Ut enim ad minim veniam, ",
            "type": "review",
            "review": 4,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "quis nostrud exercitation ullamco",
            "type": "review",
            "review": 1,
            "version": 1
          }
        ],
        "direction": "ltr",
        "format": "",
        "indent": 0,
        "type": "paragraph",
        "version": 1,
        "textFormat": 0,
        "textStyle": ""
      }
    ],
    "direction": "ltr",
    "format": "",
    "indent": 0,
    "type": "root",
    "version": 1
  }
}
`;

export default function ReviewEditor() {
  const  [editor] = useLexicalComposerContext();
  const stateJson = JSON.parse(dataDummy);
  editor.setEditorState(editor.parseEditorState(stateJson));

  return (
    <div className="w-full h-full p-2 border-none outline-none resize-none">
      <ReviewTextPlugin
        contentEditable={
          <ContentEditable
            className="caret-black outline-none relative"
            aria-placeholder={placeholder}
            placeholder={
              <div className="text-gray-400 absolute truncate top-4 left-2 select-none pointer-events-none">
                {placeholder}
              </div>
            }
          />
        }
      />
      <HistoryPlugin />
    </div>
  );
}
