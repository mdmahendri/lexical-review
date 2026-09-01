# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `gh issue edit <number> --remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Wayfinder maps and tickets use GitHub's native sub-issue and issue-dependency
relationships. The commands below require a recent `gh` release with the
`--parent`, `--add-sub-issue`, and `--add-blocked-by` flags (2.97 or newer is
known to work in this repository).

### Labels

Every map has `wayfinder:map`. Every child ticket has exactly one ticket-type
label: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or
`wayfinder:task`.

Create or reconcile those labels during repository setup with `gh label create
<label> --color <color> --description <description> --force`. Do not replace a
ticket-type label with a triage label; the two label sets describe different
things.

### Maps and child tickets

- **Find maps**: `gh issue list --state open --label "wayfinder:map" --json number,title,url`.
- **Read a map**: `gh issue view <map-number> --json number,title,body,url,subIssues`.
- **Create a child ticket**: `gh issue create --parent <map-number> --label "wayfinder:<type>" --title "<name>" --body "<body>"`.
- **Attach an existing ticket**: `gh issue edit <ticket-number> --parent <map-number>`.
- **List children in map order**: `gh issue view <map-number> --json subIssues --jq '.subIssues[] | [.number, .title, .state, .url] | @tsv'`.

Create all currently specifiable tickets first. Add dependency relationships in
a second pass so every referenced issue already has a number.

### Blocking and the frontier

- **Make one ticket block another**: `gh issue edit <blocked-ticket> --add-blocked-by <blocking-ticket>`.
- **Inspect dependencies**: `gh issue view <ticket-number> --json blockedBy,blocking`.
- **Remove a stale dependency**: `gh issue edit <blocked-ticket> --remove-blocked-by <blocking-ticket>`.

The frontier is the first open child, in the map's sub-issue order, that has no
assignee and no open `blockedBy` issue. Read the ordered children from the map,
then inspect each open candidate with:

```sh
gh issue view <ticket-number> --json number,title,url,assignees,blockedBy \
  --jq 'select((.assignees | length) == 0 and ([.blockedBy[] | select(.state == "OPEN")] | length) == 0)'
```

Do not infer the frontier from labels or issue-body checklists. GitHub's parent,
assignee, and dependency fields are authoritative.

### Claiming and resolving tickets

- **Claim before reading or working the ticket**: `gh issue edit <ticket-number> --add-assignee "@me"`.
- **Read the claimed ticket**: `gh issue view <ticket-number> --comments --json number,title,body,url,labels,assignees,blockedBy,comments`.
- **Record the resolution**: `gh issue comment <ticket-number> --body "<answer>"`, then `gh issue close <ticket-number>`.

Immediately before updating a map's **Decisions so far**, fetch its current body
again and merge the new named link into that version. This avoids overwriting a
concurrent Wayfinder session. Keep the full decision in the ticket's resolution
comment; the map receives only its one-line gist and link.
