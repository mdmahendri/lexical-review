# lexical-review

`lexical-review` adds review mode (also known as track changes) to [Lexical](https://lexical.dev/). It keeps original, inserted, and deleted text in the Lexical editor state and renders review markers in the DOM.

[Try the live demo](https://mahendrimd.github.io/lexical-review/) · [Read the package documentation](packages/lexical-review/README.md) · [View the npm package](https://www.npmjs.com/package/lexical-review)

## Features

- Editor-wide review mode for text edits.
- Typing and pasted text are recorded as insertions.
- Deleting original text marks it as deleted; deleting inserted text removes it; deleting deleted text restores the original text.
- Character-level or word-level deletion granularity.
- Lexical formatting and inline styles are preserved inside review markers.
- Review metadata survives Lexical JSON serialization and deserialization.
- Custom theme classes for inserted (`<ins>`) and deleted (`<del>`) text.

The native v3 session authors pending insertion proposals with identity on creation, correction in place, and explicit accept, reject, and removal operations. See the [session API](packages/lexical-review/README.md#pending-insertion-proposals). The editor-wide features below describe the legacy integration.

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

## Legacy quick start

Register `ReviewTextNode` and replace Lexical's regular `TextNode` so review mode applies to all editable text:

```tsx
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { TextNode } from "lexical";
import {
  $createLegacyReviewTextNode as $createReviewTextNode,
  LegacyReviewTextNode as ReviewTextNode,
} from "lexical-review";
import { LegacyReviewTextPlugin as ReviewTextPlugin } from "lexical-review/client";

const initialConfig = {
  namespace: "review-editor",
  onError(error: Error) {
    throw error;
  },
  nodes: [
    ReviewTextNode,
    {
      replace: TextNode,
      with: (node: TextNode) =>
        $createReviewTextNode(node.getTextContent(), "original"),
      withKlass: ReviewTextNode,
    },
  ],
};

export function ReviewEditor() {
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ReviewTextPlugin
        granularity="character"
        contentEditable={<ContentEditable aria-label="Review editor" />}
      />
    </LexicalComposer>
  );
}
```

`ReviewTextPlugin` registers the review commands and normalizes text nodes created after registration. For a non-React integration, call `registerReviewText(editor, "word")` directly and keep the returned cleanup function.

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
