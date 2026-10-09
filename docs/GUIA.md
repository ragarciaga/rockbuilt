# Guía de Rockbuilt

Rockbuilt lleva un proyecto desde la idea hasta código verificado y listo para merge. Tú apruebas
el qué (brief, spec, backlog) y cada PR. Los agentes hacen el cómo, y un agente distinto revisa
lo que hizo el que programó.

## Instalación (una vez por computador)

Necesitas Node.js 20 o superior, git y GitHub CLI con sesión iniciada (`gh auth login`). En
Windows, instala Git for Windows para que Claude Code use Git Bash.

Dentro de Claude Code:

```
/plugin marketplace add ragarciaga/rockbuilt
/plugin install rockbuilt@rockbuilt
```

Mientras el repo sea privado, cada persona del equipo necesita acceso de lectura a
`ragarciaga/rockbuilt` y su propio `gh auth login`.

## Proyecto nuevo

1. Crea una carpeta vacía, abre Claude Code ahí y escribe `/rb-kickoff` o simplemente
   "quiero construir ...". Si tienes notas o un documento, pégalo; si no, describe la idea. Puedes
   dictar por voz.
2. Responde la entrevista. Viene en rondas de preguntas con la opción recomendada primero.
   Incluye una recomendación honesta de seguir o no, y si el proyecto necesita IA.
3. Aprueba el brief. Rockbuilt crea el repo privado en GitHub, escribe `CLAUDE.md`, el brief, los
   ADRs y el issue #1 (el esqueleto que deja la app arrancando con sus tests en verde).
4. Haz el commit y el push inicial tú mismo; Claude tiene bloqueado el push directo a main.
5. `/rb-build` sobre el issue #1, revisa el PR y pide el merge.
6. `/rb-spec` para la primera funcionalidad, luego `/rb-tasks` y `/rb-build`.

## Proyecto en curso

1. Abre Claude Code en el repo y corre `/rb-adopt`.
2. Un agente lee el código y deja el mapa en `docs/current-state.md`. Con eso escribe o corrige
   `CLAUDE.md`.
3. Corre los tests actuales. Si algo está en rojo o no hay tests, propone primero un issue para
   estabilizar la base. No se construye sobre una base rota.
4. Te pregunta qué quieres lograr y propone el camino.

## Qué comando usar

| Quieres | Comando |
|---|---|
| Funcionalidad nueva o cambio grande | `/rb-spec`, luego `tasks` y `build` |
| Arreglar un bug | `/rb-fix` |
| Cambio pequeño y acotado | Crea el issue y corre `/rb-build` sobre él |
| Probar una funcionalidad completa (E2E, evals, seguridad) | `/rb-verify` |
| Hacer merge de un PR | "haz merge del PR 12" o `/rb-merge 12` |
| Retomar al día siguiente | `/rb-status` |
| Cerrar una funcionalidad o reportar algo del harness | `/rb-retro` |

Si no sabes cuál aplica, describe lo que quieres. Rockbuilt propone el camino y tú confirmas.

## Playwright (pruebas en el navegador)

En proyectos web, Playwright viene desde el issue #1. `rb init` deja la configuración, una prueba
de humo y el servidor MCP de Playwright en `.mcp.json`, que es lo que le permite a Claude abrir y
recorrer tu app en un navegador real.

Después de que el issue #1 instale las dependencias:
1. Reinicia Claude Code (los MCP solo cargan al arrancar).
2. Aprueba el servidor `playwright` cuando lo pregunte.
3. Escribe `/mcp` y confirma que aparece conectado.

Desde ahí, cada tarea que toque pantallas corre las pruebas E2E antes de abrir el PR, y
`/rb-verify` escribe las pruebas nuevas de cada funcionalidad (un camino feliz y dos de
fallo por flujo). En un proyecto existente sin Playwright, `adopt` propone un issue para
agregarlo antes de construir.

## Dónde apruebas

1. El brief (kickoff).
2. Los requisitos y luego el diseño (spec).
3. El backlog completo (tasks).
4. Cada PR.

Entre el punto 3 y el 4, `build` trabaja solo. Si un plan tiene una pregunta que no puede
responder con el código o el spec, marca ese issue con `rb:blocked`, te deja la pregunta y sigue
con el siguiente.

## El merge

Claude nunca hace merge por su cuenta. Lo hace cuando se lo pides y, aun así, Claude Code te pide
confirmar el comando. Antes revisa que el PR tenga el visto bueno del verifier sobre el último
commit y que CI esté en verde.

## Modo objetivo

Al final de `tasks`, `build` te da una línea `/goal ...` para pegar. Con eso recorre todo el
backlog sin que escribas "continúa". Para detenerlo: `/goal clear`.

## Paralelo

Si hay varias tareas que tocan archivos distintos y ninguna toca la base de datos, las
dependencias o la configuración, `build` las corre al tiempo en copias separadas del repo
(worktrees), máximo 3. Te avisa en una línea antes de arrancar. Para apagarlo, pon
`Parallel: off` en `CLAUDE.md` o di "una por una".

Ten en cuenta que 3 agentes en paralelo consumen el límite del plan 3 veces más rápido.

## Tiempos

Cada tarea registra cuánto tardó en planear, implementar, verificar y corregir. La tabla queda al
final de `docs/progress.md`. Sirve para ver si el paralelo ahorra tiempo y para cotizar proyectos
con datos reales.

## Archivos que verás en tu proyecto

| Archivo | Para qué |
|---|---|
| `CLAUDE.md` | Las reglas del proyecto: objetivo, stack, convenciones y comandos de verificación |
| `docs/progress.md` | Dónde quedamos y qué sigue, más la tabla de tiempos |
| `docs/specs/NN-nombre/` | Requisitos, diseño, tareas y reportes de cada funcionalidad |
| `docs/adr/` | Decisiones de arquitectura con su porqué |
| `.claude/LESSONS.md` | Errores que no se deben repetir |
| `.claude/settings.json` | Permisos: qué corre sin preguntar y qué está prohibido |

## Problemas comunes

- **"rb: command not found".** Rockbuilt usa la ruta completa como respaldo. Si persiste, revisa
  que el plugin esté activo con `/plugin`.
- **En Windows no encuentra Bash.** Instala Git for Windows o define `CLAUDE_CODE_GIT_BASH_PATH`.
- **Rutas demasiado largas en Windows.** `rb worktree add` activa `core.longpaths`. Si el error
  aparece en otro lado: `git config --global core.longpaths true`.
- **Un E2E falla de repente.** Revisa primero si venció una credencial en `.env.local`.
- **El diagnóstico general.** Pídele a Claude que corra `rb doctor`.

## Mejorar el harness

Cómo se detecta qué sirve y qué no, y cómo se hacen los cambios: [MEJORAR.md](MEJORAR.md).
