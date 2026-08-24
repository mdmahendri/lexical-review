# lexical-review

## Compatibility

The v3 compatibility baseline supports Lexical `0.45.0` through `0.49.x`.
`lexical`, `@lexical/react`, `@lexical/clipboard`, and `@lexical/utils` must
be installed at the same version within that range.

The tested React peer range is React 18 and React 19. `react` and `react-dom`
must use the same version. Browser compatibility checks cover Chromium,
Firefox, and Playwright WebKit; Playwright WebKit results do not certify native
Safari or iOS Safari.

## Entrypoints

- React-free core entrypoint: `import { ReviewTextNode } from "lexical-review"`.
- Client/editor integration: `import { ReviewTextPlugin, registerReviewText } from "lexical-review/client"`.

Core nodes, helpers, and types are exported only from the root entrypoint. The root entrypoint does not import React or `@lexical/react`, so it is suitable for server-side model and serialization code; DOM rendering and editor registration require a client environment.

## Editor-wide review mode

Review mode is intentionally editor-wide: editable text is represented by `ReviewTextNode`, not a mixture of review and ordinary Lexical `TextNode` instances. Register the node and replace Lexical text nodes in the editor configuration:

```tsx
import { TextNode } from "lexical";
import { $createReviewTextNode, ReviewTextNode } from "lexical-review";

const initialConfig = {
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
```

`ReviewTextPlugin` also normalizes ordinary text nodes created after registration to original review text. It throws during registration when `ReviewTextNode` is not registered.

Please visit the [homepage](https://github.com/mahendrimd/lexical-review).

## Rendering contract

For inserted and deleted text, the review marker is always the outermost DOM
element. Lexical formatting and inline styles are nested inside the marker,
for example: `<ins><strong>inserted text</strong></ins>`.
