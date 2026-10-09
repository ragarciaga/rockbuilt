# Blind audit dispatch (rb-build step 9)

Loaded by rb-build, rb-fix and rb-cycle for tiers B and C, after the verifier passes. The point
of the audit is independence: the auditor judges behavior against the spec without knowing how
the change was built (self-preference bias).

## Start the app first

When a criterion is `[e2e]` or `[manual]`, a browser is available and AGENTS.md has `## Run`: run
its command in the background with `PORT=<3000 + offset>`, wait up to 60 s for
`curl -s -o /dev/null http://localhost:<port>` to answer, pass that `App URL`, and stop the
process after the audit (`kill <pid>`). The auditor cannot start servers itself (its allowlist
denies it). An auditor `incomplete` with "app not reachable" is an environment problem, not a
kickback: start the app and re-dispatch once, then escalate `--kind local`.

## The prompt contains ONLY

```
Task: <id>
Reviewed head: <sha>
Working directory: <path>   Port offset: <k or 0>
Browser: <available | unavailable>   Session: <cloud | local>
Docs language: <code>   Dispatch attempt: <k>
Acceptance criteria: (verbatim, by ID with tags, from <requirements.md path | issue #n>)
<R1.1 [unit]: ...>  (bugs: the issue's Expected and Steps; standalone without criteria in
the issue: only the ID and text lines of the plan's Acceptance criteria, nothing else)
Run instructions: (AGENTS.md Setup, Verification, E2E)
App URL: <http://localhost:<port> | none>
[Re-audit: your own previous verdict, verbatim. Judge every criterion again.]
Judge each criterion by observed behavior. Return pass, fail or not-observable per criterion.
```

**Never pass** the plan or any part of it besides criteria text, the implementer report, the
verifier verdict, the diff, diff stat or changed-file list, commit messages, the PR body, or
findings from other reviewers. (The auditor may run `git diff --stat` itself to find which
screens or commands to exercise; it never sees why they changed.)

## Reading the verdict

- `pass` with `head=<reviewed head>`: goes into the PR body as is.
- `fail`: a kickback (budget shared with the other reviewers).
- `needs-local`: the PR gets `rb:hold` and an `rb:needs-local` escalation (template in
  `.claude/skills/rb-cycle/references/escalation-templates.md`, section 2). Only the human merges
  it, after checking locally (`rb merge-gate <pr> --human-approved`).
- `incomplete`: see "Start the app first"; any other reason is a retry per `kickback.md`.
