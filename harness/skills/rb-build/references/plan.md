# Plans: stale check, the plan file, the security read

Loaded by rb-build steps 1 to 3, rb-fix and rb-cycle. `rb <cmd>` means
`node tools/rockbuilt/rb.mjs <cmd>`.

## Stale check

Take the newest trusted comment whose first line starts `<!-- rockbuilt:plan `; parse `base=` and
`tier=`. **Reuse it** only when all hold:

- `git cat-file -e <base>` succeeds;
- `git diff --name-only <base> origin/<default> -- <its Affected files>` prints nothing;
- no newer trusted comment without a `<!-- rockbuilt:` marker **changes** the task (a new
  requirement, a non-recommended option, a correction);
- `git diff <base> origin/<default> -- <tasks.md>` changes nothing inside this task's block except
  `Status:` and decision-log lines.

A human answer that approves the plan as posted ("aprobado", "ok", "go", the recommended option)
keeps the plan: it is the approval step 4 looks for, never a reason to re-plan. Bookkeeping commits
(status, progress, lessons) never make a plan stale. Otherwise (re)plan. A re-plan of an issue
carrying `rb:approved` removes that label (`rb gh label-remove <n> rb:approved`): approval covers
the plan as posted.

## The plan file

The planner's final message goes to `.rockbuilt/plans/<id>.md` as soon as it returns (Write tool),
and every later step reads that file: the issue comment (`--body-file`), the implementer prompt,
the verifier prompt. The same for each implementer report: `.rockbuilt/reports/<id>-<k>.md`.
3d_brain (2026-10-16) had to recover 30k to 44k character plans from an agent transcript. A plan
that long is also a task that is too big: the planner says so under Risks and proposes the split.

## Security read

Dispatch `rb-security-reviewer` with `Mode: plan`, the plan file and every `RESOLVED` line, the
spec folder and `.claude/skills/rb-verify/references/security.md` (1 to 2 minutes). It checks
each `RESOLVED` decision against requirements.md and the plan's data paths against the checklist.
Post its verdict on the issue (`rb gh issue-comment <n> --body-file <f>`) with its status line
`<!-- rockbuilt:status stage=rb-security-reviewer task=<id> outcome=<pass|fail> mode=plan -->`;
`rb escalate --kind human` refuses a tier C plan without it. Degraded mode: run it all the same and
put the verdict in the report.

A blocker or major: revise the plan (re-dispatch the planner with the finding) or make it part of
the escalation's question. It runs **before** the open questions are escalated: the planner's
open question about a dependency or a design choice is exactly what the human approves, and the
security findings belong in that question (eval `build-tier-c-escalates`: 0.6.0 and 0.7.0
escalated the question and never reached the security read).
