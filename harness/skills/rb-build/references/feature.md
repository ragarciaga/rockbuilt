# Review per feature (PLAN-1.0 G3, DESIGN 33.3)

With `Feature review: on` in AGENTS.md on the default branch (the gate reads it there), the level 2 tasks of a spec merge into one feature branch
with CI and the verifier, and the blind auditor and the security reviewer review the whole
feature once, in the feature's PR to the default branch. It trades one late, larger review for one
review per task. Standalone issues, bugs, quick batches, level 3 tasks and any task whose plan
needs the owner (schema, architecture, auth model, cost, irreversible) never use it.

## The feature branch and issue

Once per spec (`docs/specs/NN-slug`), before its first level 2 task:

1. Branch `rb/feature-NN-slug`. If it is not on origin:
   `git push origin origin/<default>:refs/heads/rb/feature-NN-slug`.
2. Feature issue, if none is open: `rb gh issue-create --title "Feature NN-slug: review" --label
   rb:feature --body-file <f>`, the body starting `<!-- rockbuilt:feature rb/feature-NN-slug
   spec=docs/specs/NN-slug -->` and listing the spec's tasks. `rb:feature` keeps it out of the
   task queue.

## Each task

- The **planned level** decides the base before implementing: level 2 starts from
  `origin/rb/feature-NN-slug` (`git checkout -b rb/<id>-<slug> origin/rb/feature-NN-slug`), level
  1 and 3 from the default branch as always.
- If step 7 raises a feature-based task to level 3: `git rebase --onto origin/<default>
  origin/rb/feature-NN-slug`, then go on with the default branch as the base. The gate refuses a
  level 3 PR into a feature branch.
- Reviews: the verifier, plus the security reviewer when `rb risk` says `security.required`. No
  auditor: the feature PR gets it. The PR's base is the feature branch (`rb gh pr-create --base
  rb/feature-NN-slug`); the merge gate merges it there (never through `rb queue`), closes the task
  issue and posts its merge comment, which the feature PR later checks.
- A task that depends on one merged only into the feature branch is ready for another level 2
  task of the same feature; a level 3 task waits until the feature PR merges.

## The feature PR

When every level 2 task of the spec is merged into the feature branch and none is open against it:

1. Open the PR (`rb gh pr-create --head rb/feature-NN-slug --base <default> --title "feat:
   <feature> (feature NN)"`, body `Closes #<feature issue>`), then, if it is behind, `rb gh
   pr-update-branch <pr>`. That is the only way to bring the default branch in: the gate accepts
   a merge commit on a feature branch only when GitHub made it (signed `web-flow`); a local merge,
   rebase or force push blocks the feature.
2. Blind auditor on the whole feature: every criterion of the tasks merged into it, the app
   started from the feature head (`references/audit.md`), task id `F<NN>`.
3. Security reviewer, `Mode: task`, task id `F<NN>`, diff `origin/<default>...origin/rb/feature-NN-slug`.
4. Post both verdicts on the feature issue; their lines go to the PR body with the reviewed head.
   A finding is a kickback: a fix task into the feature branch (verifier, gate), then both reviews
   again on the new head. `Kickback budget` applies to the feature as one task.
5. The merge train merges it through `rb merge-gate`: every commit on the branch must be a task PR
   the gate merged there or GitHub's own update from the default branch, the issue it closes must
   be the `rb:feature` issue, and the whole feature diff must be level 1 or 2 with no owner
   approval (size aside). A direct push blocks the feature.
