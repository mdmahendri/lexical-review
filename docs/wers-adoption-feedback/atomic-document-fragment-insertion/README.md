# Atomic document-fragment insertion boundary proof

## Finding

One collapsed paste of `x\ny` into accepted paragraph `AB` at offset 1 is an
atomic document-fragment insertion. Exact Lexical 0.49 produces two paragraphs,
`Ax` and `yB`. Web Editor Revisions (WER) v1 has no one core proposal whose
acceptance produces those paragraphs and whose rejection preserves `AB`.

A WER `insert` can carry the three text code points, but acceptance keeps the
newline inside one paragraph. A `paragraph-split` creates the required second
paragraph identity but carries no inserted content. Directly targeting that new
identity from another pending proposal is invalid because pending targets are
accepted-state-relative. A legal split plus two accepted-state-relative
insertions can eventually reach `Ax` / `yB`, but selective resolution also
exposes `A` / `B`, `Ax` / `B`, and `A` / `yB`. Those are not truthful outcomes
of the user's one paste intention.

The current WER v1-compatible boundary is therefore a mutation-free
`unsupported` mapping report. The smallest future-standard remedy is one atomic
document-fragment insertion proposal kind with a point target, ordered paragraph
fragments, and reserved identities for every paragraph it creates. Acceptance
must apply the whole fragment; rejection must preserve the base document; no
child proposal may be independently resolved.

## Boundaries

- Lexical Review baseline:
  `c6c79d8d05da8875ba3e2674c5e8d327260f02d2`, package `2.0.0`.
- Lexical: `v0.49.0` / `ffe90924bd55b5d450c88de0f9f1c8b228c4a221`.
- WER v1: `e6ac89287257646888a4eadf692d836eb8feb41b`.
- First-adopter action: accepted `p1 = "AB"`, collapsed caret at UTF-16
  offset 1, selected clipboard representation `text/plain = "x\ny"`.
- Required acceptance: `p1 = "Ax"`, `paste-right = "yB"`.
- Required rejection: `p1 = "AB"`.

The exact machine, runtime, package graph, repository head, and dirty-worktree
observation used for the recorded run are in `observed.json`. The baseline
commit, rather than the evidence-only commit containing this directory, is the
Lexical Review implementation boundary under test.

## Reproduce

From the Lexical Review repository root, with the clean sibling
`../web-editor-revisions` checkout detached or checked out at the pinned commit:

```bash
python3 -m venv /tmp/lexical-review-wer-proof-venv
/tmp/lexical-review-wer-proof-venv/bin/python -m pip install jsonschema==4.20.0
/tmp/lexical-review-wer-proof-venv/bin/python docs/wers-adoption-feedback/atomic-document-fragment-insertion/reproduce.py --check
```

The script refuses a different or dirty WER checkout, verifies that the
installed `lexical`, `@lexical/clipboard`, `@lexical/react`, and
`@lexical/utils` packages are all 0.49.0, executes the actual Lexical rich-text
plain-paste path, loads the published WER validator and resolver, runs all of
its core checks, and replays the minimized candidates in `fixture.json`.

Use `--write-observed` to refresh the environment-bearing `observed.json` after
reviewing an intentional boundary change. Semantic output is checked separately
against `expected.json` so another machine does not need to match the recorded
OS or tool patch versions.

## Why this is not harness misuse

- The published WER core oracle passes all of its own checks in the same
  process before the boundary conclusion is accepted.
- Both one-proposal candidates are schema-valid and semantically valid. Their
  observed results follow their normative proposal semantics: insertion splices
  paragraph-local text; split creates structure without content.
- The invalid decomposition fails the normative accepted-state targeting rule
  with `unknown target paragraph`; this is not a Lexical Review restriction.
- The valid decomposition uses the WER split remapping rule (`before` remains
  left, `after` moves right) and reaches the required accepted projection. Its
  extra partial outcomes are therefore demonstrated using supported WER
  behavior, not inferred from a rejected fixture.
- The conclusion is not that WER forbids multiline editor input. WER leaves UI
  and clipboard behavior out of scope. The gap is specifically one portable,
  independently reviewable proposal for the atomic document-fragment intention.

## Compatibility impact

This is a future-standard gap, not an evaluator defect and not a valid WER v1
core extension. Adding the proposal kind changes the closed core kind
vocabulary, payload schema, producer/consumer/resolver requirements,
canonical fixtures, and profile capability matrices. Existing v1 consumers
must continue to reject an unknown required extension or unknown later model
version without mutation. Lexical Review v3 can implement the richer native
proposal while exporting this case as `unsupported` at the v1 boundary until a
new standard version defines it.
