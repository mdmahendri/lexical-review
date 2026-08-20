import { fileURLToPath } from "node:url";

const e2eRoot = fileURLToPath(new URL(".", import.meta.url));
const lexicalReviewSource = fileURLToPath(
  new URL("../../lexical-review/src", import.meta.url),
);

export default {
  root: e2eRoot,
  resolve: {
    alias: [
      {
        find: "lexical-review/client",
        replacement: `${lexicalReviewSource}/client.ts`,
      },
      {
        find: "lexical-review",
        replacement: `${lexicalReviewSource}/index.ts`,
      },
    ],
  },
};
