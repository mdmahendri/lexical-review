import { LexicalComposer } from "@lexical/react/LexicalComposer";
import {
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewInsertionNode,
} from "lexical-review";
import "./index.css";
import ProposalEvidenceDemo from "./ProposalEvidenceDemo";
import RouteWiringDemo from "./RouteWiringDemo";

function App() {
  const initialConfig = {
    onError(error: Error) {
      throw error;
    },
    nodes: [ReviewInsertionNode, ReviewDeletionNode, ReviewFormattingNode],
    theme: {
      ins: "bg-green-300 no-underline",
      del: "bg-red-300 no-underline",
      text: {
        bold: "font-bold",
        italic: "italic",
        underline: "underline",
        strikethrough: "line-through",
      },
    },
  };

  return (
    <div className="flex min-h-screen min-w-0 justify-center overflow-x-hidden bg-gray-100">
      <div className="w-full min-w-0 max-w-4xl rounded-lg bg-white p-6 shadow-lg">
        <header className="mb-4 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800">lexical-review</h1>
          <p className="text-gray-600">
            Route-wiring and proposal-evidence capability steps.
          </p>
        </header>
        <div className="min-w-0 overflow-hidden rounded-lg border">
          <div className="min-w-0 bg-white p-2">
            <LexicalComposer
              initialConfig={{
                ...initialConfig,
                namespace: "route-wiring-demo",
              }}
            >
              <RouteWiringDemo />
            </LexicalComposer>
          </div>
        </div>
        <div className="mt-4 min-w-0 overflow-hidden rounded-lg border">
          <div className="min-w-0 bg-white p-2">
            <LexicalComposer
              initialConfig={{
                ...initialConfig,
                namespace: "proposal-evidence-demo",
              }}
            >
              <ProposalEvidenceDemo />
            </LexicalComposer>
          </div>
        </div>
        <footer className="mt-4 flex min-w-0 justify-between text-gray-600">
          <a
            href="https://github.com/mahendrimd/lexical-review"
            className="text-blue-500 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
          <p>created by Mahendri Dwicahyo</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
