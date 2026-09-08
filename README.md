# lexical-review

`lexical-review` adds review mode (also known as track changes) to [Lexical](https://lexical.dev/). It keeps original, inserted, and deleted text in the Lexical editor state and renders review markers in the DOM.

[Try the live demo](https://mahendrimd.github.io/lexical-review/) · [Read the package documentation](packages/lexical-review/README.md) · [View the npm package](https://www.npmjs.com/package/lexical-review)

## Features

- Node-backed v3 review session with stable proposal identity on creation.
- Pending insertion, deletion, replacement, formatting, paragraph split/merge, and atomic document-fragment proposals.
- Explicit accept, reject, and removal operations with no terminal history.
- No-mutation refusals that preserve content, pending work, projection, and selection.
- Content-only clipboard projections; untrusted clipboard content never confers proposal identity.
- Lexical formatting and inline styles are preserved inside review markers (`<ins>`/`<del>` outermost).
- Native review documents serialize accepted content plus current pending proposals only.

See the [session API](packages/lexical-review/README.md#pending-insertion-proposals).

## Installation

The package declares Lexical peer compatibility `>=0.45.0 <0.50.0`.
The `lexical`, `@lexical/react`, `@lexical/clipboard`, and `@lexical/utils`
packages must use the same version:

```bash
npm install lexical-review \
  'lexical@>=0.45.0 <0.50.0' \
  '@lexical/react@>=0.45.0 <0.50.0' \
  '@lexical/clipboard@>=0.45.0 <0.50.0' \
  '@lexical/utils@>=0.45.0 <0.50.0' \
  react react-dom
```

The package declares React peer compatibility for React 18 and React 19, and
`react` and `react-dom` must use the same version. CI exercises the supported
Lexical minors and browser boundary scenarios in Chromium, Firefox, and
Playwright WebKit. Playwright WebKit results do not certify native Safari or
iOS Safari.

## Quick start

Open a native v3 review document against a Lexical editor and register the session route:

```tsx
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  openReviewSession,
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
} from "lexical-review";
import { ReviewSessionPlugin } from "lexical-review/client";

const initialConfig = {
  namespace: "review-editor",
  onError(error: Error) {
    throw error;
  },
  nodes: [
    ReviewInsertionNode,
    ReviewDeletionNode,
    ReviewFormattingNode,
    ReviewFragmentNode,
    ReviewBoundaryNode,
  ],
};

const session = openReviewSession(editor, initialDocument);
if (session.status !== "valid") {
  throw new Error(session.issues[0]?.message ?? "Invalid review document.");
}

export function ReviewEditor() {
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ReviewSessionPlugin session={session.value} />
      <ContentEditable aria-label="Review editor" />
    </LexicalComposer>
  );
}
```

`ReviewSessionPlugin` routes typing, deletion, formatting, structural, clipboard, and composition input through the same v3 semantic operations. For a non-React integration, call `registerReviewSession(editor, session)` directly and keep the returned cleanup function.

## Development

The repository requires Node `^22.13.0` or `>=24` and pnpm `11`.

```bash
pnpm install
pnpm dev                         # start the demo
pnpm test --run                  # run unit tests
pnpm test:package                # build and verify the published package entrypoints
pnpm test:e2e                    # run Playwright tests
pnpm test:e2e:install            # install Chromium, Firefox, and Playwright WebKit on Linux
pnpm test:e2e:webkit             # run only the Playwright WebKit project
pnpm test:e2e:install:webkit     # install only Playwright WebKit on Linux
pnpm build:demo                  # build the demo
pnpm --filter lexical-review build
pnpm lint
pnpm compatibility               # run configured Lexical compatibility checks
pnpm compatibility -- --version 0.48.0 # run a focused exact-version lane
pnpm compatibility:e2e -- --version 0.45.0 --react-version 19.2.3
pnpm compatibility:e2e -- --version 0.45.0 --react-version 18.3.1 --project chromium
```

The Lexical compatibility workflow can also be dispatched with an exact
`version` input for a temporary browser-risk lane; it reuses the same boundary
workflow without adding a permanent matrix entry.

The library lives in `packages/lexical-review`, the demo lives in `packages/demo`, and focused tests are co-located with the library source.

Contributions and issue reports are welcome. Please include a focused reproduction or test when changing review behavior.
