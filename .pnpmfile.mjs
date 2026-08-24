/* global process */

const compatibilityVersion = process.env.LEXICAL_COMPATIBILITY_VERSION?.trim();
const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (compatibilityVersion && !exactVersionPattern.test(compatibilityVersion)) {
  throw new Error(
    `LEXICAL_COMPATIBILITY_VERSION must be an exact version, received ${compatibilityVersion}.`,
  );
}

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function isLexicalPackage(name) {
  return name === "lexical" || name.startsWith("@lexical/");
}

export const hooks = {
  readPackage(pkg) {
    if (!compatibilityVersion) {
      return pkg;
    }

    for (const field of dependencyFields) {
      const dependencies = pkg[field];
      if (dependencies == null) {
        continue;
      }

      for (const name of Object.keys(dependencies)) {
        if (isLexicalPackage(name)) {
          dependencies[name] = compatibilityVersion;
        }
      }
    }

    return pkg;
  },
};
