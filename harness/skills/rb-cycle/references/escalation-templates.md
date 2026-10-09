# Escalation templates

Used by rb-cycle, rb-build, rb-fix and the merge train whenever the human is needed. Post with:

```
node tools/rockbuilt/rb.mjs escalate <issue> --kind human|local --title "<title>" --body-file <f>
```

`rb escalate` labels the issue (`rb:needs-human` or `rb:needs-local`) and posts one comment: its
own marker line `<!-- rockbuilt:escalation kind=<kind> -->`, the title as a `###` heading, then
your body file (`rb escalate new ...` opens a new issue instead). It never waits. Write the body in the docs language (templates below are Spanish, the default;
translate headings for another language, keep marker lines, labels and commands as they are).

Rules for every escalation:

- The body file starts with exactly `<!-- rockbuilt:reason <slug> -->` and has no heading (rb adds
  the title). The cycle detects answers as a trusted comment newer than the escalation marker.
- Reason slugs (closed list): `tier-c-plan`, `tier-c-diff`, `tier-rose-at-merge`,
  `blocking-question`, `cost`, `blocked-task`, `manual-repro`, `missing-info`, `needs-local-e2e`,
  `needs-local-step`, `ci-red-after-fix`, `ci-red-unrelated`, `secret-scan`, `no-ci`,
  `merge-conflict`, `branch-prior-work`, `red-baseline`, `red-after-merge`, `dirty-tree`.
- One escalation per issue per run; skip it when the issue already carries the label.
- Say what releases it: a reply, "aprobado", the label `rb:approved`, or removing the label.
- Quote evidence (findings, command output) verbatim, at most 15 lines; never secrets.
- Costs always carry a number: monthly and one-off, the source of the price and its date, and
  whether it was verified (`Fuente: <url>, consultada <fecha>`) or is an estimate.
- Commands for the human are complete and copy-pasteable, for Windows (PowerShell) and for
  macOS/Linux, and start from a fresh terminal in the repo folder.

## 1. Human decision (tier C plan, tier C diff, blocking question, cost)

Kind `human`. Title: `Decisión: <tema corto>`.

~~~~markdown
<!-- rockbuilt:reason <tier-c-plan|tier-c-diff|blocking-question|cost|tier-rose-at-merge> -->
**Contexto.** <Tarea <id> (<título>). Qué se intenta lograr, en una o dos frases.>
**Por qué te pregunto.** <Regla que lo exige: dependencia nueva, migración, costo, auth, decisión
que el spec no resolvió, etc. Para nivel C: las razones de `rb risk` y del planner, una por línea.>

**Opciones**
1. **<Opción A>**: <qué implica>. Costo: <USD/mes, USD único, o "ninguno">. Riesgo: <una línea>.
2. **<Opción B>**: <qué implica>. Costo: <...>. Riesgo: <...>.
3. **No hacerlo ahora**: <qué queda pendiente>.

**Recomendación:** opción <n>, porque <razón concreta con evidencia: archivo, ADR, medición>.
**Costo estimado de la recomendación:** <monto y supuestos | ninguno>. Fuente: <url, fecha | estimado>.

**Plan afectado:** <link al comentario del plan> (base `<sha corto>`).

**Cómo responder:** comenta el número de la opción (o "aprobado" para la recomendación) y quita la
etiqueta `rb:needs-human`, o agrega `rb:approved`. La próxima corrida lo toma. Si el plan cambia
después de tu aprobación, te lo vuelvo a pedir.
~~~~

## 2. Local step (E2E without a browser, manual check, local credentials)

Kind `local`. Title: `Paso local: <qué>`.

~~~~markdown
<!-- rockbuilt:reason <needs-local-e2e|needs-local-step|manual-repro> -->
**Por qué.** <El entorno de la nube no tiene navegador / necesita tus credenciales locales / el bug
solo se ve a mano.> <Qué está bloqueado mientras tanto: el PR #<pr> tiene `rb:hold` | nada, el PR
puede fusionarse y esto es una verificación extra.>

**macOS / Linux (Terminal):**
```bash
git fetch origin
git checkout <rama>
npm ci
npx playwright install chromium
<comando exacto, p. ej. npm run test:e2e -- e2e/login.spec.ts>
```

**Windows (PowerShell):**
```powershell
git fetch origin
git checkout <rama>
npm ci
npx playwright install chromium
<mismo comando; variables de entorno como $env:PORT="3000"; antes del comando>
```

**Qué esperar:** <salida de éxito, p. ej. "5 passed">. <Pasos manuales numerados, si aplica, con
el resultado esperado de cada uno.>

**Cómo responder:** comenta "ok" o pega las últimas líneas de la salida si falló, y quita
`rb:needs-local`<, y `rb:hold` del PR #<pr> si pasó>. Luego vuelve a tu rama de trabajo
(`git checkout <rama por defecto>`).
~~~~

## 3. Short templates (same rules, same reason line)

- **Blocked task** (`blocked-task`, human): "La tarea <id> se bloqueó después de <k> devoluciones.
  Hallazgos: <citados>. Rama `<rama>` (trabajo guardado). Opciones: 1. aclarar el criterio
  <ID> (recomendado si <...>), 2. dividir la tarea, 3. dejarla. Para reintentar: quita
  `rb:blocked` (y `rb:needs-human`) después de responder."
- **Missing information for a bug** (`missing-info`, human): the exact questions (steps,
  expected vs actual, input, environment), one per line.
- **CI red after fix** (`ci-red-after-fix`, human): check name, 10 log lines, what the one fix
  attempt changed; options: rerun, take over, close the PR.
- **CI red, unrelated** (`ci-red-unrelated`, human, on the control issue when no task issue
  fits): which check also fails on the default branch head `<sha>`.
- **Secret scan** (`secret-scan`, human): file and line (never the value); "rota la credencial
  primero, luego cierra el PR #<pr>; no lo fusiones".
- **No CI** (`no-ci`, human): `rockbuilt-ci` did not report on `<sha>`; check `.github/workflows`
  and the Actions quota; nothing merges without it.
- **Merge conflict** (`merge-conflict`, human): PR, conflicting files; recommendation: "respóndeme
  `reconstruir` y la próxima corrida cierra el PR y rehace la tarea desde la rama por defecto".
- **Branch with prior work** (`branch-prior-work`, human): branch, its non-wip commits; options:
  use it as is, discard it (the harness starts `rb/<id>-<slug>-r<k>`), or take it over.
- **Default branch red** (`red-baseline`, human, control issue): the failing commands and 10
  lines; "ninguna tarea corre hasta que esté en verde; sugiero `/rb-fix`".
- **Default branch red after merge** (`red-after-merge`, human): the merged PR, the failing
  commands, the revert PR already opened by `rb revert`; recommendation "fusiona el PR de revert
  #<n> (di 'fusiona el PR <n>') o corrige con `/rb-fix`".
- **Dirty tree** (`dirty-tree`, human, control issue): the changed paths; nothing was touched.
