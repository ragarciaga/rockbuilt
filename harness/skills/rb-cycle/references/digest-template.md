# Run digest template

One digest per run, appended to the control issue with `rb digest post --file <f>`
(`node tools/rockbuilt/rb.mjs digest post --file <f>`). Written in the docs language. The template
below is in Spanish (the default docs language); for another language translate the headings and
keep the structure, the marker line and the commands as they are. The phone is the main reader:
short lines, numbers first, every waiting item with the exact action.

Rules:

- `rb digest post` adds its own `<!-- rockbuilt:digest at=<time> -->` marker; the file starts
  with `<!-- rockbuilt:run <run id> -->`.
- Every issue and PR is written as `#<n>` so GitHub links it, and the cycle can read the
  Escalaciones section of the last digests back (rb-cycle section 3.2).
- Omit a section that would be empty, except "Resumen" and "Próxima corrida".
- Times come from `rb timing report`, never estimated.
- Never paste secrets, tokens, `.env` values or full logs; quote at most 10 log lines.

~~~~markdown
<!-- rockbuilt:run <run id> -->
## Rockbuilt: corrida <run id>

**Resumen:** <n> PR fusionados, <n> esperan tu revisión, <n> escalaciones nuevas, <n> bloqueadas.
Baseline: <verde | rojo (ver abajo) | <k> fallas conocidas>. Navegador: <sí | no (E2E pendiente en local)>.
Duración: <min> min. Harness: <contents of tools/rockbuilt/VERSION>. Modo: <normal | degradado (sin GitHub API)>.

### Fusionados
| PR | Tarea | Nivel | Minutos | Para revertir |
|---|---|---|---|---|
| #31 | T3 Login con correo | B | 42 | `node tools/rockbuilt/rb.mjs revert 31` |

### Esperan tu decisión
- #34 (T5, nivel C): <una línea: qué decidir>. Acción: <comenta "aprobado" o elige una opción en #<issue>, o di "/rb-merge #34">.
- #35 bookkeeping (docs: progress): revísalo y fusiónalo con `/rb-merge #35` cuando quieras.

### Escalaciones
- #12 (decisión): <pregunta en una línea>. Recomendación: <opción>. Costo: <estimado | ninguno>.
- #14 (paso local): <qué correr>. Comando en el issue.

### Bloqueadas
- #16 (T7): <motivo en una línea>. Rama `rb/T7-...`. Reintento: quita `rb:blocked`.

### Fallas y avisos
- CI de #33 en rojo sin relación con el PR (<check>): <una línea>.
- Issues no tomados (autor sin permisos): #40, #41.
- <stop switch encendido a mitad de corrida | lock perdido | patch de bookkeeping anterior no aplicó>.

### Tiempo por tarea
| Tarea | Plan | Implementación | Chequeo | Revisión | PR | Merge | Total |
|---|---|---|---|---|---|---|---|
| T3 | 4 | 18 | 3 | 11 | 1 | 5 | 42 |

### Próxima corrida
Tomará: <#n CI, T6, T8, #20 bug>. Necesita de ti antes: <#12 respuesta, #14 paso local | nada>.
Para pausar: agrega la etiqueta `rb:stop` a #<ctl>.
~~~~

English headings, for `Docs language: en`: Summary, Merged, Waiting for your decision,
Escalations, Blocked, Failures and notices, Time per task, Next run. Columns: PR, Task, Tier,
Minutes, To revert.
