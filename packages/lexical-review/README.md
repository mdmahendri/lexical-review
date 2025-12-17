# lexical-review

## Entrypoints

- Default/server-safe: `import { ReviewTextNode } from "lexical-review"`.
- Client/React: `import { ReviewTextPlugin, registerReviewText } from "lexical-review/client"`.

`registerReviewText` lives only in the client subpath because it wires Lexical editor commands and should not be invoked in RSC/server environments. The default export remains React-free for server/RSC safety.

Please visit the [homepage](https://github.com/mdmahendri/lexical-review).