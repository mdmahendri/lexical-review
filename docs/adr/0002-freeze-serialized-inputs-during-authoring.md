# Freeze serialized inputs during authoring

`lexical-review` opens an authoring session from a validated native Lexical-shaped review document. The separately published `lexical-review-wer` adapter maps WER interchange input to a serialized native document before core import and maps an exported native successor back to WER afterward; it never receives live authoring state. The session treats its serialized native input as immutable while review state evolves, and saving settles the active draft before exporting a successor native document rather than mutating or rebasing the input.
