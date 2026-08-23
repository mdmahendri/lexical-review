---
name: lexical-compatibility
description: Inspect exact tagged Lexical source for implementation, API, and debugging work, or investigate Lexical upgrades, peer ranges, support baselines, CI matrices, and lexical-review semver decisions. Use read-only reference mode for source questions and decision mode only when a support decision is requested.
---

# Lexical source and compatibility

Select the mode from the user's requested outcome before running
version-specific commands.

## Select a mode

### Reference mode

Use reference mode for Lexical API questions, implementation/debugging against
an exact version, upstream source checks, or code suggestions based on tagged
source. Analysis is read-only for GitHub and sibling repositories; missing
source setup may be provisioned through the permission gate below. After setup,
source inspection remains read-only and produces findings and proposed
code/test seams, not a release sweep or support verdict.

### Decision mode

Use decision mode for a new Lexical version/range, a changed peer range, a
support-floor or CI baseline, or a package semver/migration decision.

Do not turn a reference question into a compatibility decision. A release or
source inspection becomes decision mode only when the requested outcome is an
accepted, rejected, or not-proven support statement.

## GitHub write gate

Use read-only GitHub commands for issue inspection and release history. Treat
issue creation and comments as external writes:

- Never run `gh issue create` automatically.
- Use the issue number supplied by a decision task; never create a second issue.
- If no issue is supplied, stop before any write and ask whether to use an
  existing issue, create one, or continue in reference mode.
- Implementing or investigating a named decision issue authorizes recording
  its evidence; advice and source inspection do not authorize issue updates.
- Reference mode never creates an issue or posts a comment.

Complete read-only preflight before asking this question when useful. Do not
claim a compatibility decision without its issue record and evidence.

## Resolve the repository's exact versions

Before reading Lexical source, release notes, or upstream API documentation,
resolve the package graph from the lexical-review checkout. This skill has no
supported-version list; never copy a version from it or an earlier investigation.

Inventory every relevant workspace `package.json` and matching importer and
snapshot entries in `pnpm-lock.yaml`, including `lexical`, `@lexical/react`,
`@lexical/clipboard`, `@lexical/utils`, and every runtime `@lexical/*` package.
Record each declared specifier, exact lockfile resolution, and installed
version when dependencies are present.

Useful read-only checks are:

```bash
rg -n '"(@lexical/[^" ]+|lexical)"|(@lexical/[^: ]+|lexical):' \
  package.json packages/*/package.json pnpm-lock.yaml
pnpm list --recursive --depth -1 --json
```

If the manifest, lockfile, and installed graph disagree, resolve that before
using evidence. In decision mode, record the repository commit, Node/pnpm
versions, baseline/candidate, and aligned Lexical packages in the issue.

## Preflight the local tagged source

Use one tag-aware sibling source repository and detached worktrees on demand:

```text
<lexical-review checkout>/
../lexical-source/                       # one upstream clone with tags
../lexical-worktrees/lexical-vX.Y.Z/     # one detached worktree per exact tag
```

Worktree presence does not define support. Resolve versions from the repository
and task, then preflight each needed exact tag. Do not use an unversioned
checkout or a legacy per-version clone as version authority.

For a requested `X.Y.Z`, use read-only checks first:

```bash
lexical_source=../lexical-source
lexical_worktree=../lexical-worktrees/lexical-vX.Y.Z
lexical_tag=vX.Y.Z

git -C "$lexical_source" rev-parse --git-dir
git -C "$lexical_source" remote get-url origin
git -C "$lexical_source" worktree list --porcelain
tag_commit="$(git -C "$lexical_source" rev-parse --verify "refs/tags/$lexical_tag^{commit}")"
git -C "$lexical_worktree" rev-parse --git-dir
worktree_commit="$(git -C "$lexical_worktree" rev-parse HEAD)"
test "$tag_commit" = "$worktree_commit"
test "$(git -C "$lexical_worktree" describe --tags --exact-match)" = "$lexical_tag"
test -z "$(git -C "$lexical_worktree" symbolic-ref --short -q HEAD)"
test -z "$(git -C "$lexical_worktree" status --porcelain)"
```

The block must succeed. Compare `origin` with the expected upstream remote
before using or fetching the clone. Verify the Lexical package version in the
worktree, and record the exact tag, commit, absolute paths, and remote in
decision mode.

If the source repository, exact tag, or required worktree is missing or points
to a different commit, stop before version-specific inspection. State the exact
tag, source path, and worktree path and ask permission before any command that
writes outside the workspace:

```text
I need tag refs/tags/vX.Y.Z from <upstream remote> in
<absolute sibling source path>, with a detached worktree at
<absolute worktree path>. May I fetch/provision these paths outside the
workspace?
```

Never overwrite or reset a mismatched worktree; ask for another path or
explicit repair permission.

After explicit permission, provision only the named paths. Clone the source if
absent, otherwise fetch its tags; create the detached worktree and repeat the
preflight commands above. These are setup writes only; inspect the verified
source and worktree read-only afterward:

```bash
git clone <upstream remote> "$lexical_source"  # only when the clone is absent
git -C "$lexical_source" fetch --tags --prune
git -C "$lexical_source" worktree add --detach "$lexical_worktree" "refs/tags/$lexical_tag"
```

If permission is denied, the tag cannot be fetched, or the package version is
wrong, record that version as untested and do not assume its source.

Read lexical-review usage/tests before the tagged source/tests. Use online
documentation only for information unavailable in the tag, such as release
history or behavior introduced elsewhere.

## Reference mode workflow

Resolve the exact version or named tag, complete its source preflight, inspect
lexical-review usage/tests before the matching tagged source/tests, and return
the evidence, affected mechanism, and proposed code/test seam.

Do not infer a supported range, change package metadata, or create an issue
from reference-mode findings alone.

## Decision mode workflow

### 1. Establish the investigation record

Use the existing issue named by the task. If none is named, stop at the GitHub
write gate. The initial record should include:

```markdown
## Lexical compatibility investigation

- Repository commit:
- Request and target:
- Baseline exact versions:
- Candidate exact versions:
- Lexical packages checked:
- Node / pnpm:
- Source repository:
- Worktrees:

### Decision

- Accepted Lexical range:
- Rejected versions or range:
- lexical-review semver impact: patch / minor / major / none
- Semver rationale:
- Reason:

### Known untested surfaces

-
```

Keep evidence append-only enough to preserve changes. Record every release,
pull request, tag, command, result, adaptation, and limitation needed to
reproduce the decision.

### 2. Define the exact interval

Resolve the current graph before choosing a baseline or candidate. Define a
contiguous interval with every intermediate minor, the exact lower boundary,
the latest patch of each supported minor, and the candidate. For a downward
baseline, verify the task's starting version against manifests and lockfile,
then enumerate every release to the proposed floor. Include the current
development version when the request or release triage requires it.

### 3. Review every upstream release

Build an ordered list of every published stable release in the interval,
including patches. Read each complete body, including non-breaking sections,
package notes, fixes, performance, chores, and linked changes. A missing
`Breaking Changes` section does not make a release irrelevant. Include
prereleases that affect the graph or are named by the request; otherwise record
their explicit exclusion.

Use reproducible read-only release inventory commands such as:

```bash
gh api --paginate repos/facebook/lexical/releases \
  --jq '.[] | [.tag_name, .name, .published_at, .html_url] | @tsv'
```

For every release:

1. follow every linked pull request in the release body;
2. classify its relevance to the package graph or a risk category;
3. record the release tag, section, pull request number and URL, affected
   packages/files, and classification in the issue; and
4. record links and sections reviewed and found irrelevant.

Classify relevant changes under one or more of:

- Public types and APIs;
- Node state and serialization;
- DOM and reconciliation;
- Selection and editing;
- Input, IME, and composition;
- Browser behavior; and
- Package and runtime requirements.

Release notes are triage input, not compatibility proof. Validate relevant
changes against exact tagged source and lexical-review's observable contract.

### 4. Inspect every exact tag

After the interval is known, preflight every exact tag required by the release
sweep and evidence plan before inspecting its declarations, implementation, or
tests. Name each affected lexical-review mechanism, such as review-node JSON,
`<ins>`/`<del>` DOM nesting, selection normalization, composition handling, or
package entrypoint resolution.

### 5. Gather isolated evidence

Use the repository's compatibility runner when available. Every lane must:

- align `lexical` and every `@lexical/*` package to one exact version;
- install once and run the same lexical-review commit;
- leave tracked manifests and the committed lockfile unchanged;
- verify the resolved package graph before accepting results; and
- avoid a duplicate compatibility-only test suite.

At minimum, collect:

1. library compilation, declarations, package exports, root/client consumer
   imports, and React-free root importability;
2. the existing authoritative editor-backed unit suite for affected behavior;
3. focused browser behavior in the engines required by the identified risk;
4. failure diagnosis tied to the release entry, exact source, and
   lexical-review mechanism; and
5. results for the lower bound, latest patch of each supported minor, every
   intermediate version, and the candidate.

Accept a clean adaptation only when one lexical-review implementation works
across the interval. Stop lowering the floor if support needs version
detection, conditional branches, duplication, or a weaker public design.

### 6. Decide and record

Accept a candidate or range only when release triage, source inspection,
compilation/package surface, unit behavior, and risk-appropriate browser
evidence pass for every exact version. Otherwise reject, retain the range, or
mark `not proven`; release notes, source inspection, and compilation alone are
not observable-behavior evidence.

The issue must record:

- accepted and rejected exact versions or ranges;
- release tags and linked pull requests reviewed;
- source repository, exact tags, worktree paths, and inspected tests;
- compilation, consumer, unit, and browser commands with results;
- affected or cleared lexical-review mechanisms;
- known untested surfaces; and
- the proposed Lexical peer-range and `lexical-review` semver impact.

Change package metadata, the committed lockfile, or the supported range only
after the decision and evidence are recorded.
