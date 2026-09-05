# Native fragment export boundary

This package currently implements only #57's final, mutation-free WER v1 refusal
for serialized native documents containing atomic fragments. It is not yet the
general import/export adapter tracked by #82/#69.

`exportAtomicFragmentToWERv1(document, { inputRef })` validates native input and
returns `unsupported` with a mapping report and no output artifact when a current
fragment is present. The caller supplies an exact artifact identifier or semantic
fingerprint for `inputRef`. No live editor is accepted, and fragments are never
split into independently resolvable proposals.

If native editing has already normalized the fragment to another kind, the result
is `not-applicable`. The general mapper must then assess that current kind and
portable identity under #82; this result is not an equivalence claim. Invalid
input or a missing artifact reference returns `failed` before mapping.

The refusal report follows section 14 and the mapping-report schema from WER v1
at `e6ac89287257646888a4eadf692d836eb8feb41b`. Its narrow refusal profile does not
replace the general identity mapping profile.
