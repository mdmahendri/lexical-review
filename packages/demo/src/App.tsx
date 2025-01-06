import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { TextNode } from "lexical";
import { ReviewTextNode } from "lexical-review";
import "./index.css";
import ReviewEditor from "./ReviewEditor";

function App() {
  const initialConfig = {
    "namespace": "demo",
    onError(error: Error) {
      throw error;
    },
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
    theme: {
      ins: "bg-green-300 no-underline",
      del: "bg-red-300 no-underline"
    },
  };

  return (
    <div className="bg-gray-100 h-screen flex items-center justify-center">
      <div className="bg-white shadow-lg rounded-lg p-6 w-full max-w-4xl">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">lexical-review</h1>
          <p className="text-gray-600">
            A custom lexical plugin provides suggestion, review, or track
            changes mode—whatever you want to call it—similar to those found in
            popular word processing applications like Microsoft Word and Google
            Docs.
          </p>
        </header>
        <div className="border rounded-lg overflow-hidden">
          <div className="p-2 bg-white h-96">
            <LexicalComposer initialConfig={initialConfig}>
              <ReviewEditor />
            </LexicalComposer>
          </div>
        </div>
        <footer className="mt-4 flex justify-between text-gray-600">
          <a
            href="https://github.com/mdmahendri/lexical-review"
            className="text-blue-500 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
          <p>&copy; 2024 mdmahendri</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
