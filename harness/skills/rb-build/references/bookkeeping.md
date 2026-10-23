# Bookkeeping files (rb-build, rb-fix, rb-cycle)

`docs/specs/*/tasks.md`, `docs/progress.md` and `.claude/LESSONS.md` never enter task commits:
after every `git add -A` or `git reset --soft`, `git restore --staged` them. They stay uncommitted
and follow you across branches. With GitHub reachable, `rb bookkeeping save --run <run id>` after
each task pushes them to the day's `rb/bookkeeping-<YYYY-MM-DD>` PR from a temporary worktree (a
session that ends early loses nothing; a stop hook asking to commit them gets this, never a task
commit). At run end `--final` also restores them in the checkout; tell the user in one line.
`/rb-cycle` merges that PR through the gate, or the user with `/rb-merge`. In tasks.md change only
`Status:` lines and add one-line decision-log entries (`- YYYY-MM-DD: ...`): the gate refuses
any other edit in a bookkeeping PR.
