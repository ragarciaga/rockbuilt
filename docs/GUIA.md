# Guía de Rockbuilt

Rockbuilt lleva un proyecto desde la idea hasta código verificado y fusionado, y desde la versión
0.3 trabaja solo. Planea, construye, revisa y fusiona por su cuenta, y te llama únicamente para
decisiones de diseño, para cualquier cosa que cueste plata y para cambios delicados.

Tú apruebas el qué (el brief y cada spec). Los agentes hacen el cómo, y un agente distinto revisa
lo que hizo el que programó, sin ver su plan ni su reporte.

## Instalación

Necesitas Node.js 20 o superior, git y GitHub CLI con sesión iniciada (`gh auth login`). En
Windows, instala Git for Windows para que Claude Code use Git Bash.

El plugin es solo el instalador. Una vez por computador, dentro de Claude Code:

```
/plugin marketplace add ragarciaga/rockbuilt
/plugin install rockbuilt@rockbuilt
```

Luego, en cada proyecto, abre Claude Code en la carpeta y escribe `/rockbuilt:install` (o
"instala rockbuilt"). Te hace una sola pregunta con tres partes: tipo de proyecto, idioma de los
documentos y si usas Cursor o Codex además de Claude Code.

Rockbuilt se copia dentro del repo (`tools/rockbuilt/`, `.claude/skills/rb-*`,
`.claude/agents/rb-*`, `AGENTS.md`, la CI). Así lo encuentran las rutinas en la nube, que no
cargan plugins, y también Cursor. Al final te muestra qué cambió, lo sube en una rama y abre el
PR; ese PR lo fusionas tú.

**Actualizar** es lo mismo: `/rockbuilt:install` (o "actualiza rockbuilt"). No pregunta nada,
copia la versión nueva y abre el PR. Tus archivos (`AGENTS.md`, `CLAUDE.md`, `docs/`,
`LESSONS.md`) nunca se sobrescriben.

Mientras el repo de Rockbuilt sea privado, cada persona del equipo necesita acceso de lectura a
`ragarciaga/rockbuilt` para instalar el plugin.

## Proyecto nuevo

**En la nube (lo normal).**

1. En GitHub crea el repo vacío, privado y **con README** (así existe la rama `main`).
2. Dale acceso a la app de Claude: GitHub, Settings, Applications, Claude, Configure,
   Repository access, agrega el repo, Save. Sin esto la sesión no puede clonarlo ni empujar.
   En el repo, Settings, General, activa **Automatically delete head branches**: la nube no
   puede borrar ramas, y sin esto se acumula una rama por cada PR fusionado.
3. Abre una sesión en claude.ai/code con dos repos: el nuevo y `ragarciaga/rockbuilt` (de ahí
   sale el harness que se instala en el proyecto).
4. Escribe "arranquemos un proyecto", "quiero construir ..." o `/rb-kickoff`; las tres hacen lo mismo. Si tienes notas, pégalas; si no,
   describe la idea. Puedes dictar por voz.
5. Responde la entrevista, en rondas de preguntas con la opción recomendada primero. Incluye una
   recomendación honesta de seguir o no, y si el proyecto necesita IA.
6. Aprueba el brief. Rockbuilt instala el harness, llena `AGENTS.md`, escribe el brief y los
   ADRs, crea las etiquetas, el issue de control y el issue del esqueleto (la app arrancando con
   sus pruebas en verde), y abre el PR de arranque. Ese PR lo fusionas tú.
7. Crea la rutina nocturna (docs/CLOUD.md, paso 4). Esa noche construye el esqueleto.
8. `/rb-spec` en una sesión para la primera funcionalidad. Desde ahí la rutina construye cada
   noche y tú solo respondes lo que te pregunte.

**En tu computador.** Crea una carpeta vacía, abre Claude Code ahí, corre `/rockbuilt:install`,
abre una sesión nueva y sigue desde el paso 4. Ahí Rockbuilt sí puede crear el repo con `gh`.

## Proyecto en curso

1. Abre Claude Code en el repo, corre `/rockbuilt:install` y fusiona el PR.
2. Corre `/rb-adopt`. Un agente lee el código y deja el mapa en `docs/current-state.md`. Con eso
   arma `AGENTS.md` con los comandos reales del repo y te lo muestra para aprobarlo.
3. Corre las pruebas actuales. Si algo falla, te propone dos caminos: registrar esas fallas como
   conocidas (no bloquean, pero la lista solo puede bajar) y abrir un issue para estabilizar, o
   estabilizar primero antes de construir. Tú decides.
4. Te pregunta qué quieres lograr y propone el camino.

Si el proyecto venía de la versión 0.2 (el contrato estaba en `CLAUDE.md`), `/rb-adopt` lo pasa a
`AGENTS.md` y deja `CLAUDE.md` con `@AGENTS.md`.

## Qué comando usar

| Quieres | Comando |
|---|---|
| Instalar o actualizar Rockbuilt en el repo | `/rockbuilt:install` |
| Funcionalidad nueva o cambio grande | `/rb-spec` (el resto lo hace solo) |
| Arreglar un bug | `/rb-fix` |
| Cambio pequeño y acotado | Crea un issue con la etiqueta `rb:task`; el ciclo lo toma |
| Avanzar el backlog ahora | `/rb-build` (o `/rb-cycle` para una pasada completa) |
| Probar una funcionalidad completa (E2E, evals, seguridad) | `/rb-verify` |
| Fusionar un PR de nivel C, o el que tú digas | "haz merge del PR 12" o `/rb-merge 12` |
| Deshacer un merge | `/rb-merge revierte el PR 12` |
| Retomar al día siguiente | `/rb-status` |
| Cerrar una funcionalidad o reportar algo del harness | `/rb-retro` |

Si no sabes cuál aplica, describe lo que quieres. Rockbuilt propone el camino y tú confirmas.

## Los tres niveles de autonomía

Cada tarea recibe un nivel, calculado con código (`rb risk`) a partir de los archivos que cambia.
El planner también declara uno, y gana el más alto. Un modelo puede subir el nivel, nunca bajarlo.

| Nivel | Qué entra | Qué hace Rockbuilt |
|---|---|---|
| A | Pruebas, documentación, estilos, textos | Planea, construye, verifica y fusiona solo |
| B | Código normal de un spec aprobado o de un issue `rb:task` / `rb:bug` | Igual que A, más el auditor ciego; fusiona solo con CI en verde |
| C | Arquitectura, dependencias nuevas, base de datos, autenticación, pagos, CI, despliegue, archivos del harness, secretos, borrados grandes | Se detiene, te pregunta con opciones y recomendación, sigue con otra cosa; el PR lo fusionas tú |

**Todo lo que pueda costar plata te pregunta primero,** con un estimado: APIs pagas, servicios
nuevos, infraestructura, planes pagos (incluido GitHub Pro) y pruebas contra servicios pagos. Las
pruebas usan mocks.

Si prefieres revisar todo como antes, pon `Autonomy: supervised` en `AGENTS.md`: cada PR espera
por ti.

## Dónde apruebas

1. El brief (kickoff).
2. Los requisitos y luego el diseño de cada funcionalidad (spec).
3. Cada decisión de nivel C, cuando llega.
4. Los PRs de nivel C y los del harness.

Las tareas que salen de un spec aprobado no piden una segunda aprobación.

## El ciclo y el issue de control

`/rb-cycle` hace una pasada completa sin esperar a nadie: revisa el interruptor de parada, toma
el candado, sincroniza, verifica la rama principal, construye hasta 6 tareas, fusiona en fila lo
que pasa el merge gate y deja un resumen. Es lo que corre la rutina nocturna; cómo crearla está
en [CLOUD.md](CLOUD.md).

Todo queda en GitHub, en el issue **Rockbuilt control**:

- Un comentario por corrida con lo fusionado (cada PR con su comando para revertir), lo que
  espera por ti, las preguntas abiertas, las fallas y lo que sigue.
- Las preguntas para ti quedan en issues con `rb:needs-human`. Respondes con un comentario (o
  "aprobado") y quitas la etiqueta, o agregas `rb:approved`.
- Lo que necesita tu computador (un navegador, credenciales locales) queda con `rb:needs-local`
  y los comandos exactos.

## Cómo parar todo

Pon la etiqueta `rb:stop` en cualquier issue abierto, también desde el celular. Rockbuilt se
detiene antes de la siguiente tarea y antes de cada merge. Para seguir, quita la etiqueta.

Para frenar **un solo PR** sin parar lo demás, ponle la etiqueta `rb:hold`. El merge gate no lo
fusiona mientras la tenga; quítala cuando quieras que siga. Un comentario en el PR no lo frena.

## El merge

Solo hay un camino para fusionar: `rb merge-gate`. Fusiona si el PR es nivel A o B, la CI
(`rockbuilt-ci`) está en verde, el verifier y el auditor aprobaron el último commit, no hay
interruptor de parada y la corrida tiene el candado. Los PRs se fusionan uno por uno, y después
de cada merge el siguiente se actualiza y se vuelve a revisar.

Los PRs de nivel C los fusionas tú en GitHub, o le dices a Claude "haz merge del PR 12". Cada
merge deja en el PR el comando para revertirlo.

En un repo privado con el plan gratuito de GitHub no se puede activar la protección de ramas, así
que las reglas las aplica `rb merge-gate`. Con GitHub Pro (USD 4 al mes, decisión tuya) o un repo
público, `rb protect` hace que GitHub mismo exija la CI.

## Playwright (pruebas en el navegador)

En proyectos web, Playwright viene desde el issue del esqueleto. La instalación deja la
configuración, una prueba de humo y el servidor MCP de Playwright en `.mcp.json`, que le permite
a Claude abrir y recorrer tu app en un navegador real.

Después de que el esqueleto instale las dependencias:
1. Reinicia Claude Code (los MCP solo cargan al arrancar).
2. Aprueba el servidor `playwright` cuando lo pregunte.
3. Escribe `/mcp` y confirma que aparece conectado.

Cada tarea que toque pantallas corre las pruebas E2E antes de abrir el PR. En la nube, si no hay
navegador, esa tarea queda con `rb:needs-local` y los comandos para correrlas en tu computador.

## Cursor y Codex

Si usas Cursor, elige `cursor` al instalar. Cursor lee `AGENTS.md`, los skills y los agentes del
mismo lugar que Claude Code, y el mismo guard bloquea lo peligroso. Codex también está
disponible, pero es experimental: no se ha probado en proyectos reales.

## Paralelo

Si hay varias tareas que tocan archivos distintos y ninguna toca la base de datos, las
dependencias o la configuración, Rockbuilt las corre al tiempo en copias separadas del repo
(worktrees), máximo 3. Para apagarlo, pon `Parallel: off` en `AGENTS.md` o di "una por una".

Ten en cuenta que 3 agentes en paralelo consumen el límite del plan 3 veces más rápido.

## Tiempos

Cada tarea registra cuánto tardó en planear, implementar, verificar, auditar y corregir. La tabla
queda al final de `docs/progress.md` y el resumen nocturno incluye el tiempo por tarea. Sirve
para cotizar proyectos con datos reales.

## Archivos que verás en tu proyecto

| Archivo | Para qué |
|---|---|
| `AGENTS.md` | Las reglas del proyecto: objetivo, stack, convenciones, comandos de verificación y autonomía |
| `CLAUDE.md` | Importa `AGENTS.md` y agrega notas solo para Claude |
| `tools/rockbuilt/` | El CLI `rb` y el guard; no se edita a mano, se actualiza con `/rockbuilt:install` |
| `.claude/skills/rb-*`, `.claude/agents/rb-*` | Los comandos y los agentes de Rockbuilt |
| `docs/progress.md` | Dónde quedamos y qué sigue, más la tabla de tiempos |
| `docs/specs/NN-nombre/` | Requisitos, diseño, tareas y reportes de cada funcionalidad |
| `docs/adr/` | Decisiones de arquitectura con su porqué |
| `docs/rockbuilt/known-failures.json` | Fallas conocidas aceptadas; la lista solo puede bajar |
| `.claude/LESSONS.md` | Errores que no se deben repetir |
| `.claude/settings.json` | Permisos y el guard: qué corre sin preguntar y qué está prohibido |
| `.github/workflows/rockbuilt-ci.yml` | La CI que exige el merge gate, con escaneo de secretos |

## Qué cuesta

- Rockbuilt y las rutinas usan tu plan de Claude, sin cobro aparte.
- GitHub Actions en repos privados del plan Free: 2.000 minutos gratis al mes. Si se acaban,
  Actions se detiene y no hay cobro, salvo que hayas puesto un límite de gasto y un medio de
  pago. `rb doctor` te avisa.
- Cualquier gasto nuevo te lo pregunta primero, con un estimado.

## Problemas comunes

- **No aparecen los comandos `/rb-*`.** El harness no está instalado en ese repo, o la sesión
  arrancó antes de instalarlo. Corre `/rockbuilt:install` y abre una sesión nueva.
- **En Windows no encuentra Bash.** Instala Git for Windows o define `CLAUDE_CODE_GIT_BASH_PATH`.
- **Rutas demasiado largas en Windows.** `rb worktree add` activa `core.longpaths`. Si el error
  aparece en otro lado: `git config --global core.longpaths true`.
- **Un E2E falla de repente.** Revisa primero si venció una credencial en `.env.local`.
- **Nada se fusionó anoche.** Lee el resumen en el issue de control: casi siempre falta CI en
  verde, el PR es nivel C o hay un `rb:stop` puesto.
- **El diagnóstico general.** Pídele a Claude que corra `node tools/rockbuilt/rb.mjs doctor`.

## Mejorar el harness

Cómo se detecta qué sirve y qué no, y cómo se hacen los cambios: [MEJORAR.md](MEJORAR.md).
