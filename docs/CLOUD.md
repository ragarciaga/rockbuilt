# Rockbuilt en la nube: el ciclo nocturno

Una rutina de Claude Code corre `/rb-cycle` cada noche sobre tu repo, sin que tengas el
computador prendido. En la mañana encuentras PRs revisados (y los de nivel A y B ya fusionados),
más un resumen en GitHub con lo que necesita tu decisión.

Esta guía te lleva paso a paso: instalar el harness en el repo, crear la rutina, leer los
resultados y frenar todo si algo no te gusta.

## Qué hace la rutina cada noche

Cada corrida es una pasada acotada de `/rb-cycle`, en este orden:

1. Busca (o crea) el issue **Rockbuilt control** y revisa el interruptor de parada (`rb:stop`).
2. Toma el candado de la corrida. Si otra corrida lo tiene, no hace nada y termina.
3. Sincroniza: marca como hechas las tareas cuyo PR ya se fusionó y limpia ramas viejas.
4. Corre la verificación en la rama principal. Si aparece una falla nueva, se detiene y te avisa.
5. Recoge tus respuestas a preguntas anteriores y arma la cola: tareas de specs aprobados, issues
   `rb:task` y `rb:bug`, y PRs con CI en rojo. Máximo `Max tasks per run` (6 por defecto).
6. Por cada tarea: planner, implementer, revisión mecánica, verifier y, en nivel B o C, el
   auditor ciego. Cualquier hallazgo devuelve la tarea al implementer (máximo 2 veces).
7. Fusiona en fila, uno por uno, solo los PRs que pasan `rb merge-gate`.
8. Publica el resumen de la noche en el issue de control y suelta el candado.

Nunca se queda esperando una respuesta. Lo que necesita tu decisión queda como un issue con la
etiqueta `rb:needs-human`, y la corrida sigue con otra cosa.

### Los tres niveles

| Nivel | Qué entra | Qué pasa |
|---|---|---|
| A | Pruebas, documentación, estilos, textos | Se planea, se construye, se verifica y se fusiona solo |
| B | Código normal de un spec aprobado o de un issue `rb:task` / `rb:bug` | Igual que A, más el auditor ciego; se fusiona solo con CI en verde |
| C | Arquitectura, dependencias nuevas, base de datos, autenticación, pagos, CI, despliegue, archivos del harness, secretos, cualquier cosa que cueste plata | Se detiene y te pregunta; el PR lo fusionas tú |

El nivel lo calcula `rb risk` con código a partir del diff real. Un modelo puede subir el nivel,
nunca bajarlo.

## Antes de empezar

- Un plan de Claude con Claude Code (Pro o Max). Las rutinas usan tu suscripción, sin cobro
  aparte.
- El repo en GitHub, conectado a Claude a través de la **Claude GitHub App** (se instala al
  conectar GitHub en claude.ai/code y le das acceso a ese repo).
- El harness instalado y fusionado en la rama principal del repo (pasos 1 y 2).

Por qué hay que instalarlo dentro del repo: las sesiones en la nube **no cargan plugins**. Solo
ven lo que está commiteado en el repo. Por eso Rockbuilt se copia ("vendoriza") en
`tools/rockbuilt/`, `.claude/skills/` y `.claude/agents/`.

## Paso 1: instalar el harness en el repo

**Opción A, en tu computador (recomendada).** Abre Claude Code en la carpeta del repo y escribe:

```
/plugin marketplace add ragarciaga/rockbuilt
/plugin install rockbuilt@rockbuilt
/rockbuilt:install
```

Te hace una sola pregunta (tipo de proyecto, idioma de los documentos y herramientas extra),
copia los archivos, te muestra el resumen y abre el PR en una rama.

**Opción B, desde una sesión en la nube.** En claude.ai/code abre una sesión sobre tu repo y
agrega también el repo `ragarciaga/rockbuilt` a la sesión. Queda clonado al lado del tuyo, y ahí
corres:

```bash
node ../rockbuilt/scripts/rb.mjs vendor --type web --lang es
```

Cambia `--type` según tu proyecto: `web`, `ai`, `automation`, o varios separados por coma.
Después pídele a Claude que lo suba en una rama y abra el PR.

## Paso 2: fusionar los archivos del harness

El PR del paso 1 toca archivos del harness, que son nivel C: lo fusionas tú en GitHub. Revisa
que traiga `tools/rockbuilt/`, `.claude/skills/rb-*`, `.claude/agents/rb-*`, `AGENTS.md`,
`CLAUDE.md` y `.github/workflows/rockbuilt-ci.yml`.

Si el proyecto ya existía, después de fusionar corre `/rb-adopt` en una sesión local: llena
`AGENTS.md` con los comandos reales del repo y registra la línea base. Si es nuevo, corre
`/rb-kickoff`. La rutina necesita un `AGENTS.md` real para saber qué comandos verifican el código.

## Paso 3: preparar el entorno

La rutina corre en un entorno (environment) de Claude Code en la nube. Lo configuras al crear la
rutina o en la configuración de entornos de claude.ai/code:

- **Setup script:** `npm ci`. Si es un proyecto web y quieres que intente las pruebas E2E,
  agrega una segunda línea con `npx playwright install chromium`. El resultado queda en caché
  cuando el script tarda menos de unos 5 minutos, así que las siguientes corridas arrancan más
  rápido.
- **Red:** nivel **Trusted**. Si tus pruebas E2E necesitan un servicio externo, agrégalo en
  Custom hosts (por ejemplo `tu-proyecto.supabase.co`).
- **Secretos: nunca en variables de entorno.** Cualquier persona que use ese entorno las puede
  ver. Las pruebas usan mocks para servicios pagos, y lo que necesita credenciales reales queda
  como `rb:needs-local` para que lo corras en tu computador.

Si Chromium no se puede instalar en la nube, no pasa nada grave. Las tareas que tocan pantallas
quedan marcadas `rb:needs-local` con los comandos exactos para correr las pruebas en tu máquina.

## Paso 4: crear la rutina nocturna

1. Entra a https://claude.ai/code/routines y elige **New routine**. También puedes hacerlo
   desde la app de escritorio (pestaña Code, luego Routines, New routine, Cloud) o con
   `/schedule` en Claude Code.
2. **Nombre:** algo como `Rockbuilt nocturno <nombre del repo>`.
3. **Repositorio:** el de tu proyecto.
4. **Disparador:** Schedule, todos los días a la **01:07** hora de Bogotá (06:07 UTC). Usa un
   minuto impar como 07: las corridas programadas en punto arrancan tarde porque ahí se acumula
   la mayoría. El mínimo entre corridas es 1 hora.
5. **Modelo:** el predeterminado o el más capaz disponible. Planear y auditar bien vale más que
   ahorrar en una corrida de noche.
6. **Prompt,** exactamente:

```
Run /rb-cycle.
```

7. Elige el entorno del paso 3.
8. **Notificaciones:** activa el aviso al terminar la corrida (push al celular, correo o ambos).
   Es la única forma de que te enteres sin abrir GitHub: la rutina actúa con tu propio token, y
   GitHub no te notifica las acciones que haces tú mismo, así que las etiquetas
   `rb:needs-human` y `rb:needs-local` no te llegan como notificación de GitHub. La primera línea
   del reporte final de cada corrida dice cuántas cosas esperan por ti y en qué issues.
9. Guarda.

Las rutinas corren **sin pedir aprobación**. Cualquier acción que en tu computador te pediría
confirmar, en la rutina se niega. Por eso el harness nunca depende de una confirmación cuando
corre solo: lo que necesita tu decisión se convierte en un issue.

Para probar sin esperar a la noche, abre una sesión en claude.ai/code sobre el repo y escribe
`Run /rb-cycle.`. Es lo mismo que hará la rutina.

## Paso 5 (opcional): auditoría independiente en cada PR

Una segunda rutina puede revisar cada PR de Rockbuilt en una sesión limpia, con el auditor ciego.
Es una opinión extra: no reemplaza el merge gate ni lo cambia.

- **Disparador:** GitHub event, `pull_request`. Las rutinas solo aceptan eventos `pull_request`
  y `release`; los eventos de issues no están disponibles. Por eso tus respuestas en issues las
  recoge la siguiente corrida nocturna y no al instante.
- **Prompt sugerido:**

```
If the pull request head branch does not start with rb/, stop. Otherwise check out the PR head
commit, read AGENTS.md, and dispatch the rb-auditor agent (subagent_type "rb-auditor") with only:
the task id from the PR title, the acceptance criteria from the linked issue or the spec's
requirements.md, the run instructions from AGENTS.md, and the head SHA. Never pass it the PR
body, the plan, the diff or other reviews. Post its verdict as a PR comment with
node tools/rockbuilt/rb.mjs gh pr-comment <pr> --body-file <file>. Never push, merge or edit code.
```

Cada PR consume una corrida de tu plan. Si tienes muchos PRs al día, deja solo la nocturna.

## Paso 6: leer los resultados en la mañana

Todo queda en GitHub, así que lo puedes revisar desde el celular.

1. **El issue "Rockbuilt control".** Cada noche recibe un comentario con: PRs fusionados (cada
   uno con su comando para revertir), PRs que esperan por ti, preguntas abiertas, fallas, tiempo
   por tarea y lo que tomará la siguiente corrida.
2. **Issues con `rb:needs-human`.** Son decisiones tuyas. El comentario trae la pregunta, las
   opciones, la recomendación y, si hay costo, el estimado.
3. **Issues con `rb:needs-local`.** Necesitan tu computador (un navegador, credenciales locales).
   El comentario trae los comandos exactos.
4. **PRs de nivel C.** Los revisas y los fusionas tú en GitHub, o en una sesión le dices
   `/rb-merge 12`.

### Cómo responder

- Escribe tu respuesta como comentario en el issue (o simplemente "aprobado") y **quita** la
  etiqueta `rb:needs-human`.
- O agrega la etiqueta `rb:approved`.

La siguiente corrida retoma desde ahí. La aprobación cubre el plan tal como quedó publicado; si
el plan cambia después, te pregunta de nuevo. Para `rb:needs-local`, corre los comandos en tu
máquina, comenta el resultado y quita la etiqueta.

Solo cuentan los comentarios del dueño del repo y de sus colaboradores. Un comentario de un
desconocido nunca se toma como aprobación.

## Cómo detener todo

Pon la etiqueta **`rb:stop`** en cualquier issue abierto (o en el issue de control). Funciona
desde la app de GitHub en el celular. La corrida en curso se detiene antes de la siguiente tarea
y antes de cada merge, y las siguientes no arrancan.

Para reanudar, quita la etiqueta. Si quieres apagar la rutina del todo, desactívala en
https://claude.ai/code/routines.

## Cómo revertir un merge

Cada merge deja un comentario en el PR con el comando para deshacerlo. Tienes tres caminos:

- En una sesión de Claude Code sobre el repo: `/rb-merge revierte el PR 12`.
- El comando del comentario: `node tools/rockbuilt/rb.mjs revert 12`. Crea la rama
  `rb/revert-12` y abre un PR de reversión.
- El botón **Revert** del PR en GitHub, que también abre un PR de reversión.

En los tres casos la reversión llega como PR, nunca como un push directo a la rama principal.

## Protección de ramas

En el plan gratuito de GitHub, un repo privado **no puede** activar la protección de ramas. Lo
verificamos con la API: la respuesta es "Upgrade to GitHub Pro or make this repository public".

Sin protección, `rb merge-gate` aplica las reglas en código: solo fusiona si CI está en verde, las
revisiones corresponden al último commit, el nivel es A o B y no hay interruptor de parada. Es
el único camino de merge que usa el harness. `rb doctor` te muestra el modo: `rb-only` o
`github`.

**GitHub Pro cuesta USD 4 al mes** y permite que GitHub mismo rechace cualquier merge sin el check
`rockbuilt-ci` en verde, incluso uno hecho a mano. Es una decisión tuya. Si lo activas (o el repo
es público), `rb protect` configura el check obligatorio.

## Qué cuesta

- **Rutinas:** usan tu plan de Claude, sin cargo adicional. Cada corrida descuenta de los
  límites de uso del plan. Hay un límite de 100 corridas programadas por hora por cuenta, muy
  por encima de una corrida nocturna.
- **GitHub Actions** (donde corre `rockbuilt-ci`): en repos privados del plan Free tienes 2.000
  minutos al mes gratis. Si se acaban, Actions se detiene hasta el mes siguiente y no hay cobro,
  a menos que hayas configurado un límite de gasto y un medio de pago. Sin CI no hay merges
  automáticos (el gate exige `rockbuilt-ci`); `rb doctor` te avisa.
- **APIs y servicios pagos:** siempre te preguntan primero. Cualquier cambio que pueda costar
  plata es nivel C y llega con un estimado; las pruebas usan mocks.

## Problemas comunes

- **Corriste `claude -p "Run /rb-cycle."` en tu computador y no hace nada, o todo le es negado.**
  Claude Code ignora los permisos del proyecto hasta que confíes en esa carpeta. Abre Claude Code
  una vez de forma interactiva en el repo y acepta el aviso de confianza. En la nube no pasa.
- **El resumen cuenta permisos negados.** El harness solo corre comandos que coinciden con la
  lista de `.claude/settings.json`. Si una corrida se queda corta por un comando legítimo que no
  está en la lista, repórtalo con `/rb-retro` para agregarlo al harness, no lo agregues a mano en
  cada proyecto.

- **La rutina dice que no conoce `/rb-cycle`.** El harness no está en la rama principal. Revisa
  que el PR del paso 2 esté fusionado.
- **El resumen dice que el candado está tomado.** Otra corrida está activa, o una anterior se
  cayó. El candado vence a las 3 horas; puedes verlo con `node tools/rockbuilt/rb.mjs lock status`.
- **Errores que mencionan GraphQL.** En la nube GitHub GraphQL está bloqueado y `rb` usa solo
  REST. Si aparece ese error, algo llamó a `gh` directamente: repórtalo con `/rb-retro`.
- **La corrida no fusionó nada.** Mira el resumen: lo normal es que falte CI en verde, que el PR
  sea nivel C o que haya un `rb:stop` puesto.
