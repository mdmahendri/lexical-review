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

The review model tracks text changes. Formatting-only changes remain regular Lexical formatting changes, and accept/reject controls are not included in the package.

## Installation

The current package targets Lexical `0.49.0` and `@lexical/react` `0.49.0`:

```bash
npm install lexical-review lexical@0.49.0 @lexical/react@0.49.0 react react-dom
```

## Public entrypoints

| Import                  | Exports                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `lexical-review`        | `ReviewTextNode`, `$createReviewTextNode`, `$isReviewTextNode`, and `TextReviewType` |
| `lexical-review/client` | `ReviewTextPlugin` and `registerReviewText`                                          |

The root entrypoint is React-free, so it can be used for editor-state models and serialization. Use the client entrypoint for editor registration and the React plugin.

## Quick start

Register `ReviewTextNode` and replace Lexical's regular `TextNode` so review mode applies to all editable text:

```tsx
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { TextNode } from "lexical";
import { $createReviewTextNode, ReviewTextNode } from "lexical-review";
import { ReviewTextPlugin } from "lexical-review/client";

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

## Rendering and serialization

Inserted and deleted text uses `<ins>` and `<del>` as the outermost wrappers. Lexical formatting is nested inside them, for example:

```html
<ins><strong>inserted text</strong></ins>
```

Review nodes serialize as Lexical text nodes with `type: "review"` and review metadata for `original`, `insertion`, or `deletion` text.

## Development

The repository requires Node `>=22.12.0` and pnpm `11`.

```bash
pnpm install
pnpm dev                         # start the demo
pnpm test --run                  # run unit tests
pnpm test:e2e                    # run Playwright tests
pnpm build:demo                  # build the demo
pnpm --filter lexical-review build
pnpm lint
```

The library lives in `packages/lexical-review`, the demo lives in `packages/demo`, and focused tests are co-located with the library source.

Contributions and issue reports are welcome. Please include a focused reproduction or test when changing review behavior.
