## What happened
<One paragraph. The behavior, not the project. Example: "fix skipped the verifier when GitHub was
unreachable and the orchestrator verified its own change.">

## What the harness says should happen
<Quote the rule and cite the file: harness/skills/<name>/SKILL.md section, harness/agents/<name>.md,
DESIGN.md section.>

## Evidence
- Rockbuilt version: <from tools/rockbuilt/VERSION>
- Tools: <Claude Code | Cursor | Codex>; surface: <local session | cloud session | routine>
- Autonomy: <auto | supervised>; tier involved: <A | B | C | n/a>
- Skill / agent / command: <names>
- Observed: <transcript excerpt, rb output, digest line, escalation text, timing numbers,
  kickback count; sanitized>
- Impact: <time lost, defect that slipped, revert needed, unnecessary escalation, false block,
  cost>

## Reproduction (eval scenario)
<Smallest setup that reproduces it with the fixtures in evals/fixtures, the exact prompt, and the
check that should fail today. This becomes a new entry in evals/scenarios.json.>

## Suggested direction
<Optional. What to change and where.>
