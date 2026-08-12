# lexical-review

## Entrypoints

- React-free core entrypoint: `import { ReviewTextNode } from "lexical-review"`.
- Client/editor integration: `import { ReviewTextPlugin, registerReviewText } from "lexical-review/client"`.

Core nodes, helpers, and types are exported only from the root entrypoint. The root entrypoint does not import React or `@lexical/react`, so it is suitable for server-side model and serialization code; DOM rendering and editor registration require a client environment.

Please visit the [homepage](https://github.com/mahendrimd/lexical-review).
