# Cómo se mejora Rockbuilt

Rockbuilt se mejora con evidencia, no con impresiones. Hay cuatro fuentes y cada cambio sigue el
mismo ciclo: reproducir el problema como eval, cambiar lo mínimo y volver a medir.

## De dónde salen las mejoras

| Fuente | Qué detecta | Cuándo |
|---|---|---|
| Evals (`node evals/run.mjs`) | Si cada comando hace lo que promete con prompts reales, con y sin el harness | Antes de cada versión y después de cada cambio |
| CI (GitHub Actions) | Que el hook, `rb` y las plantillas funcionen en Windows, Mac y Linux | En cada push y PR, automático |
| `/rb-retro` en tus proyectos | Pasos que fallaron, se saltaron, tardaron de más o atraparon un error real | Al cerrar cada funcionalidad |
| Resúmenes nocturnos (issue "Rockbuilt control") | Tareas bloqueadas, reintentos, escalamientos que no hacían falta, tiempos por tarea | Cada mañana; lo raro se convierte en retro |
| Lo que tú y el equipo notan | Fricción que ningún dato muestra | Cuando pase; se convierte en retro |

El feedback de los usuarios es una fuente, pero no la principal. Mucho de lo que importa nadie lo
nota: un verifier que aprobó algo que se rompió después, un paso que se saltó en silencio o una
fase que siempre tarda el triple. Esos datos ya quedan registrados (tiempos en `progress.md`,
rechazos en los decision logs, hallazgos del verifier y del auditor en los PRs, resúmenes en el
issue de control) y `/rb-retro` los lee.

## Qué cuenta como "sirve" y "no sirve"

- **Sirve:** un control que atrapó un defecto real (el verifier rechazó algo con razón, el E2E
  detectó una regresión), o un paso que te ahorró una decisión.
- **No sirve:** un paso que nunca atrapa nada en varios proyectos, un bloqueo falso, una pregunta
  que el spec ya respondía, o algo que tarda más de lo que aporta.
- **Está roto:** un control que se salta, un comando que actúa sin tu aprobación, un merge que no
  pasó por `rb merge-gate`, un gasto que no se preguntó, o un resultado distinto entre Windows y
  Mac.

Quitar un paso que no aporta también es una mejora.

## El ciclo

1. **En el proyecto donde notas el problema,** corre `/rb-retro`. Separa lo que es del
   proyecto (va a `LESSONS.md` o `AGENTS.md`) de lo que es del harness. Lo del harness lo
   convierte en un issue en `ragarciaga/rockbuilt` con evidencia y sin datos del cliente.
2. **Abre una sesión de Claude Code en el repo de Rockbuilt,** no en el proyecto. Ese repo tiene
   su propio `.claude/CLAUDE.md` con las reglas de mantenimiento. Pídele: "Arregla el issue #N".
3. **Claude primero escribe un eval que falle** con el problema, luego hace el cambio mínimo y
   corre `npm test`, la validación del plugin y los evals.
4. **PR con la tabla de resultados** de los evals. Tú lo revisas y haces el merge.
5. **Se sube la versión** en `plugin.json` y `package.json`, con su entrada en `CHANGELOG.md`.
   Como el harness vive copiado dentro de cada proyecto, la mejora llega cuando corres
   `/rockbuilt:install` en ese repo y fusionas el PR que abre. Hasta entonces el proyecto sigue con
   su versión (`tools/rockbuilt/VERSION`), incluida la rutina nocturna.

## Dónde hacer los cambios

| Opción | Cuándo usarla |
|---|---|
| Sesión de Claude Code en el repo de Rockbuilt (en tu PC o en la nube) | Siempre para cambios. El repo tiene `.claude/CLAUDE.md`, tests y evals listos |
| Esta conversación de claude.ai | Para discutir o diseñar un cambio grande. Ya no hace falta para el día a día |
| Dentro de un proyecto | Nunca para editar el harness. Ahí solo se corre `/rb-retro` |

## Dónde vive cada cosa en este repo

| Qué | Dónde |
|---|---|
| Skills que se copian a los proyectos (`/rb-build`, `/rb-cycle`, ...) | `harness/skills/rb-*/` |
| Agentes (`rb-planner`, `rb-auditor`, ...) | `harness/agents/rb-*.md` |
| Plantillas del proyecto (`AGENTS.md`, settings, CI) | `harness/project/` |
| Capa web (Playwright) y adaptadores de Cursor y Codex | `harness/web/`, `harness/adapters/` |
| El CLI `rb` y el guard | `scripts/`, `hooks/guard.mjs` |
| El único skill del plugin (`/rockbuilt:install`) | `skills/install/` |

Para probar un cambio antes de publicarlo, cópialo a un proyecto de prueba con
`node <ruta a tu copia de rockbuilt>/scripts/rb.mjs vendor --from <ruta a tu copia de rockbuilt>`
y abre Claude Code ahí. Es exactamente lo que recibe un proyecto real.

Los evals hacen lo mismo: el brazo "con harness" copia el harness al espacio de trabajo con
`rb vendor` y lo commitea antes de correr el prompt; ya no usan `--plugin-dir`. Así miden lo que
corre en una rutina en la nube, donde no hay plugins.

## Consumo de referencia

Los montos en USD que reportan los evals no son un cobro. Son el estimado que calcula Claude Code
de lo que costarían esos tokens a precios de la API (`total_cost_usd`). Con la sesión de tu
cuenta (plan Pro o Max), las corridas se descuentan de los límites de uso del plan y no generan
cargos aparte. Solo hay cobro en dinero si se corren con una `ANTHROPIC_API_KEY`, o si el plan
tiene activado el uso adicional pagado y se pasa el límite.

En la primera corrida (9 de octubre de 2026), un escenario simple consumió el equivalente a USD
0.08 a 0.30. Un `fix` completo, con planner, implementer, verifier y una corrección, el
equivalente a USD 1.23 en 5 minutos. La suite completa, del orden de USD 5, parecido a una sesión
mediana de trabajo. Córrela antes de cada versión, no en cada cambio pequeño.
