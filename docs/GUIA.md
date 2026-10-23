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
`LESSONS.md`) nunca se sobrescriben. Revisa el [CHANGELOG](../CHANGELOG.md): algunas versiones
piden un paso a mano. Desde la 0.4.0, por ejemplo, el prompt de cada rutina termina en
`[rockbuilt:unattended]`, y las rutinas creadas antes hay que editarlas.

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
| Ver tus horas por proyecto, feature y tarea | "reporte de horas" (`/rb-status`) |
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
3. Cada decisión de nivel C, cuando llega. Antes de que te llegue, el revisor de seguridad lee
   el plan y coteja cada decisión con los requisitos (también en planes con datos personales).
   Esa lectura ya no depende de que el agente la recuerde: `rb` no deja escalar un plan de nivel C
   sin ella, y lo que encuentre viene en la misma pregunta.
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
(`rockbuilt-ci`, y `rockbuilt-e2e` si el proyecto tiene pruebas E2E) está en verde, el verifier y
el auditor aprobaron el último commit, no hay interruptor de parada y la corrida tiene el candado.
Cuando hay dos o más PRs listos, pasan por una **cola de merges**: el harness los apila sobre
`main` uno tras otro y sube cada paso a su propia rama (`rb/queue-...`), así el CI prueba todos los
pasos al mismo tiempo, y después cada PR se fusiona en orden sin actualizarse. El gate solo lo
acepta si la fusión de prueba que calcula GitHub tiene exactamente el contenido que probó el CI, y
lo vuelve a revisar después del merge (si no coincide, se revierte de inmediato). Si algo rompe
esa cadena (otro merge entró antes, un PR cambió, un paso falló en CI), vuelve al camino de uno por
uno. Un PR apilado sobre otro de la cola no entra a la cola.

Fuera de la cola, los PRs se fusionan uno por uno. Si después de un merge lo único nuevo en `main` es el registro
(estados en tasks.md, progreso, lecciones), el siguiente PR se fusiona tal como está, sin otra
vuelta de CI. Si `main` trajo código, el PR se actualiza y el CI corre de nuevo.

Después de esa actualización no siempre se repite toda la revisión. Si los archivos de la tarea
quedaron iguales (solo entró lo nuevo de `main`), `rb` lo confirma sin despachar ningún agente y
el CI vuelve a correr las pruebas, sin repetir al auditor. Lo mismo pasa cuando una devolución solo cambió
archivos de prueba: la app que vio el auditor no cambió, así que su resultado se conserva. El gate
no le cree al verificador: compara él mismo el contenido en GitHub antes de aceptar la revisión
anterior. Si cambió cualquier archivo de la app, la revisión completa se repite. Una corrección
después de abierto el PR entra como un commit más encima (el merge los junta en uno), nunca como
un PR nuevo.

En local, los agentes corren solo las pruebas E2E que la tarea tocó; la suite completa la corre
el CI. Una prueba que falla y pasa al repetirla queda registrada como posible inestable
(`rb flaky list`) para la retro, nunca se salta.

Los PRs de nivel C los fusionas tú en GitHub, o le dices a Claude "haz merge del PR 12". Cada
merge deja en el PR el comando para revertirlo.

En un repo privado con el plan gratuito de GitHub no se puede activar la protección de ramas, así
que las reglas las aplica `rb merge-gate`. Con GitHub Pro (USD 4 al mes, decisión tuya) o un repo
público, `rb protect` hace que GitHub mismo exija la CI: el check `rockbuilt-ci` (y `rockbuilt-e2e`
cuando el proyecto tiene E2E), sin exigir que el PR esté al día con main, porque esa regla
bloquearía la cola de merges; el gate ya revisa el árbol que se va a fusionar.

## Playwright (pruebas en el navegador)

En proyectos web, Playwright viene desde el issue del esqueleto. La instalación deja la
configuración, una prueba de humo y el servidor MCP de Playwright en `.mcp.json`, que le permite
a Claude abrir y recorrer tu app en un navegador real.

Después de que el esqueleto instale las dependencias:
1. Reinicia Claude Code (los MCP solo cargan al arrancar).
2. Aprueba el servidor `playwright` cuando lo pregunte.
3. Escribe `/mcp` y confirma que aparece conectado.

Cada tarea que toque pantallas corre las pruebas E2E antes de abrir el PR. En la nube, si el
navegador no arranca, primero intenta con el Chromium que ya trae la nube
(`node tools/rockbuilt/rb.mjs browser` imprime su ruta y la corrida la pasa como
`PW_CHROMIUM_PATH`; la configuración que escribe el harness lo lee).
Si tampoco arranca, la tarea queda con `rb:needs-local` y los comandos para correrlas en tu
computador.

**Cuando la suite crece.** El CI le da 30 minutos a cada corrida de E2E. Si tu suite pasa de unos
15 minutos, agrega en la cabecera de `AGENTS.md` la línea `E2E shards: 2` (o 3, hasta 8). El CI la
parte en ese número de trabajos en paralelo, cada uno con su propio límite de 30 minutos, y el
check `rockbuilt-e2e` sale en verde solo si todos pasan. En un repo público no cuesta nada; en uno
privado gasta más minutos de Actions, porque cada parte repite la instalación.

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

Cada tarea registra cuánto tardó en cada fase: planear, implementar, verificar, auditar,
seguridad, devoluciones, espera del CI y merge. La línea de tiempos de cada PR se va completando
aunque el merge pase en otra corrida, la tabla queda al final de `docs/progress.md` y el resumen
nocturno trae una tabla por fase. Ese es el tiempo de la máquina, no el tuyo.

El auditor tiene un presupuesto de unos 5 minutos por criterio (25 en total). Cuando vuelve a
auditar después de una devolución, revisa lo que falló y lo que el cambio puede afectar, no todo.
Su veredicto queda como comentario en el issue de la tarea, así que eso funciona aunque la
re-auditoría pase en otra sesión.
Si el verificador encuentra un error que solo está en el reporte (una cifra mal contada), lo
anota para corregir el PR y no devuelve la tarea.

## Calidad

El resumen nocturno trae una línea de calidad de los últimos 7 días, y `/rb-retro` la usa para el
periodo que revise. Sale de `node tools/rockbuilt/rb.mjs quality --since <fecha>`:

- **Devoluciones por revisor.** Cada PR guarda cuántas veces lo devolvió cada uno. Si el auditor
  devuelve, encontró algo que el verificador dejó pasar; si devuelve el CI, algo que pasó todos
  los chequeos locales.
- **Reverts** del periodo.
- **Bugs que vienen de PRs fusionados.** Cuando `/rb-fix` encuentra que la causa está en código
  de un PR del harness, lo anota en el issue (`Introduced by #<pr>`).

Si los tiempos mejoran pero esos números suben, el harness está ganando velocidad a costa de la
calidad, y eso es un hallazgo para la retro.

Al cerrar una funcionalidad, `/rb-verify` termina con el **chequeo del objetivo**. Un auditor que
no vio las tareas ni el código lee el objetivo del brief y usa la funcionalidad como lo haría ese
usuario. Si no cumple lo prometido y los requisitos sí lo pedían, se vuelve una tarea; si los
requisitos no lo cubrían, te llega como pregunta, porque cambiar el spec es decisión tuya.

**Tamaño de las tareas.** `rb tasks` rechaza tareas con más de 8 archivos o más de 4 criterios, y
una de tamaño L sin la razón por la que no se puede partir. Una tarea que nadie puede revisar
completa termina con una revisión superficial.

Las notas de progreso y las lecciones van en un solo PR de registro por día
(`rb/bookkeeping-<fecha>`). La corrida lo sube después de cada tarea, así que si la sesión se cae
no se pierde nada; las corridas siguientes lo actualizan y la próxima lo fusiona sola.

## Tus horas (para costear y para el ROI)

Di "reporte de horas" (o "cuántas horas llevo en este proyecto", con un periodo si quieres) y
sale una tabla por proyecto, por feature y por tarea con:

- **Tus horas.** Se estiman por atención: cada mensaje que le escribes a Claude en ese repo y
  cada comentario tuyo en sus issues y PRs dejan una marca con la hora. Las marcas a menos de 10
  minutos se unen en un bloque, y el bloque termina 5 minutos después de la última. Si en el mismo
  rato tocaste dos o tres proyectos, ese tiempo se reparte entre ellos, así que dos horas saltando
  entre tres proyectos suman dos horas y no seis.
- **Minutos del agente** por tarea.
- **Línea base:** la tuya por feature (te la pregunto cuando apruebas los requisitos: cuántas
  horas te tomaría sin agentes) y la del planner por tarea, una al lado de la otra.

Lo que no deja marca (una llamada con el cliente, una sesión en el tablero) lo agregas diciendo,
por ejemplo, "anota 45 minutos de llamada con el cliente en la feature 02". La tarifa por hora
nunca va en el repo: pide el CSV y haz la cuenta en tu hoja de cálculo.

Las marcas viven en el issue `Rockbuilt hours` de cada repo (un comentario por sesión). Nunca se
guarda el texto de tus mensajes, solo la hora y la rama. La rutina nocturna no cuenta como tiempo
tuyo porque su prompt lleva la etiqueta `[rockbuilt:unattended]`; cualquier otra rutina que crees
debe llevarla también.

**Repos de clientes o públicos.** Quien vea el repo ve ese issue (horas y nombres de rama), y
quien lo siga recibe un aviso por cada sesión nueva. En un repo de cliente pon `Hours: local` en
la cabecera de `AGENTS.md`: las marcas y lo que anotes a mano quedan solo en tu computador (en la
nube se pierden al cerrar la sesión). En un repo público eso pasa solo, salvo que pongas
`Hours: github`. `Hours: off` lo apaga. Solo cuentan tus comentarios: si otra persona usa
Rockbuilt en el mismo repo, sus horas no se suman a las tuyas.

Para que el reparto entre proyectos funcione, el reporte tiene que ver todos tus proyectos a la
vez. Desde tu computador los encuentra solo. En una sesión en la nube solo ve los repos que le
agregaste a esa sesión: agrégalos todos o pídelo desde tu computador.

Antes de cotizar con estas cifras, calibra: lleva tus horas a mano una semana y compara.

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
