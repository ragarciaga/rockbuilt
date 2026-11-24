# Plan Rockbuilt 1.0: ayudar en lugar de frenar

Plan de trabajo acordado con Andrés el 2026-11-24. Este archivo es la fuente de verdad del
avance: cada sesión lo lee antes de empezar, toma la siguiente casilla abierta de la fase en
curso, y al terminar marca lo hecho y agrega una línea en la bitácora del final.

**Objetivo.** Que Rockbuilt acelere la construcción sin perder calidad: menos agentes en lo
trivial, menos interrupciones al dueño, specs que no dejen huecos, y el ciclo completo solo donde
están los defectos graves. Si algo queda mal, se ajusta con la regla de retroceso (sección 3).

**Estado.** Versión en `main`: 1.3.0. Fase en curso: **5 (trabajo complejo)**. Ver la tabla de fases.

## Cómo arrancar una sesión nueva

Abrir una sesión en claude.ai/code con `ragarciaga/rockbuilt` adjunto y pegar:

```text
Sigue con el plan de Rockbuilt.

Lee primero .claude/CLAUDE.md y luego docs/PLAN-1.0.md completo: ahí están la evidencia, las
decisiones que ya tomé y las fases con casillas. No vuelvas a discutir lo que ya está decidido
en la sección 2.

Toma la fase en curso (dice "Fase en curso" arriba) y su primera casilla sin marcar. Sigue el
proceso del repo: evidencia, eval que falla, cambio mínimo, pruebas, suite de evals, PR.

Para leer otros repos usa el conector de GitHub de Composio con la cuenta "rag"
(github_pave-oxbow); la cuenta "bfa-ag" no ve los repos privados de ragarciaga. La receta está
en mi cerebro: "Encontrar qué repos usan Rockbuilt y sacar sus métricas desde Composio".

Al terminar cada punto, marca su casilla en docs/PLAN-1.0.md y agrega una línea en la bitácora.
Antes de correr evals pagados, dime el costo estimado y espera mi visto bueno. No me preguntes lo
que tenga un default razonable: decide, regístralo y sigue.
```

Para las sesiones siguientes basta con "Sigue con el plan de Rockbuilt".

## Cómo trabajar con este plan

1. Leer `.claude/CLAUDE.md` (proceso del repo) y `DESIGN.md`.
2. Abrir este archivo, ir a la fase en curso y tomar la primera casilla sin marcar.
3. Seguir el proceso del repo: evidencia, eval que falla, cambio mínimo, `npm test`,
   `claude plugin validate . --strict`, suite de evals (aprox. 12 a 15 USD, consumo del plan;
   pedir aprobación del costo), PR con la tabla de resultados.
4. Al fusionar: marcar las casillas, mover "Fase en curso" si la fase terminó y anotar en la
   bitácora (fecha, PR, versión, costo de evals, qué quedó pendiente).
5. Escribir en este archivo en español, sin guion largo.

## 1. Evidencia (por qué este plan)

Revisión de 5 repos que usan Rockbuilt (2026-11-24): `agarcia-bfa/Doorcas-Africa-Farm-Assistant`
(0.14.0), `bfa-global/bfa-signal-engine` (0.14.0), `ragarciaga/2brain-logic` (0.14.0),
`ragarciaga/maysa-shop-ops` (0.14.0) y `ragarciaga/3d_brain` (0.9.0). Unos 535 PRs fusionados.

| Hallazgo | Dato |
|---|---|
| Casi todo cae en nivel C | Doorcas 88% de los PRs con nivel, signal-engine 76%, 2brain 55%, maysa 52% |
| Interrupciones al dueño | Doorcas unas 22 al día (aprobaciones más merges de nivel C), signal-engine unas 8, 2brain unas 6 |
| Por qué se le pregunta (54 aprobaciones de Doorcas y signal-engine) | 44% huecos del spec, 22% trámite (nada nuevo que decidir), 17% estructural, 9% costo, 7% externo |
| Devoluciones | Entre 55% y 76% de los PRs tuvo al menos una; la mayoría del verifier, por pruebas que faltaban en reglas de seguridad |
| Modo rápido sin uso | 0 PRs con la marca `rockbuilt:quick` en los 5 repos |
| "Aprobación permanente" improvisada | En 3 repos el agente fusiona nivel C con `--human-approved` porque el dueño lo autorizó en el chat; el gate no lo puede distinguir |
| Tiempos engañosos | La fase "ci" incluye la espera del merge humano (p90 de 296 min en Doorcas, 698 en signal-engine); en 2brain y maysa hay fases abiertas y totales en 0 |
| Revisores pisándose | En 3 repos el auditor o seguridad vio mutantes del verifier; archivos de sondas terminaron en commits |
| Lo que sí funcionó | Las fallas graves de Doorcas (servicio congelado, admin bloqueado, borrado no cancelado, texto prohibido con caracteres invisibles) salieron de revisiones independientes en rutas sensibles; 2brain: 55 PRs del ciclo con 0 reversiones y 0 bugs escapados |

Ideas tomadas de `msummer/trail-blazer-flow` (v3.8.0, revisado el 2026-11-24): full auto con
alcance nombrado, reglas leídas desde la base del PR, los hallazgos de su auditoría externa
(v3.7.1), la clase de hallazgo `wording`, triage de seguimientos con etiquetas, estado en JSON,
CI después del merge con arreglo hacia adelante, decision record con chequeo mecánico,
presupuesto de devoluciones configurable, corridas sin avisos de permiso y el tracker en vivo. Se
toman las ideas, no el código; la atribución pública sigue siendo solo a trail-blazer-flow.

Fuentes adicionales: el feedback de la sesión de Doorcas (archivo `Feedback_Rockbuilt.md` que
compartió Andrés) y el ciclo de seguridad de Maysa Chart (`ragarciaga/tradetutor-ai`, issues #27
y #52, PRs #26 y #46).

## 2. Decisiones tomadas

- **Tres niveles de revisión**, calculados por código sobre el diff real:
  - Nivel 1, Lote: docs, textos, estilos, config no sensible, pruebas que solo agregan. Se
    fusiona sin agentes, con pruebas y lint en verde.
  - Nivel 2, Normal: código de producto no sensible. Plan corto, implementer, verifier con
    mutación. Auditor solo si cambia algo visible para el usuario. Seguridad si el diff la exige.
  - Nivel 3, Sensible: rutas sensibles, auth, pagos, datos personales, borrado. Ciclo completo.
- **Aprobación del dueño solo para:** estructural (esquema y migraciones, arquitectura o ADR,
  dependencias nuevas fuera del diseño que cuesten, tengan licencia problemática o fallen el
  chequeo automático, modelo de auth), costo sobre el tope e irreversible (borrados grandes,
  datos de producción). Se aprueba el plan; el merge sale solo cuando pasan los gates.
- **Aprobación delegada:** si el dueño lo dice (chat o comentario en el issue de control), el
  gate fusiona solo lo que entre en el alcance que nombró, hasta una fecha. Por defecto 14 días y
  fuera de alcance los costos sobre el tope y lo irreversible, salvo que el dueño los incluya.
  Queda registrada con sus palabras, cada PR dice "fusionado por delegación" y el digest la
  muestra arriba mientras esté vigente. Dos formas: por fecha ("delego todo hasta el viernes") y
  por alcance, a la manera del full auto de trail-blazer-flow ("full auto del milestone X" o
  "full auto #12 #15"): vale para esa corrida y esas issues, nunca para corridas desatendidas ni
  por texto que venga de un issue o comentario.
- **Dependencias:** las del diseño aprobado quedan aprobadas; las de desarrollo y pruebas, libres;
  las demás pasan un chequeo automático (licencia, vulnerabilidades, mantenimiento).
- **Evals:** una vez por funcionalidad y solo si el cambio toca comportamiento de IA.
- **Calidad:** las pruebas entran al nivel 1 solo si agregan; auditoría por muestreo en 1 de cada
  5 PRs de nivel 2; línea base y regla de retroceso (sección 3).
- **Interrupciones:** meta de máximo 2 interrupciones al día; las decisiones se agrupan en un
  mensaje por punto de control; no se pregunta lo que tiene un default razonable.
- **Spec:** inventario de decisiones obligatorio; una ronda de preguntas con defaults; huecos en
  construcción se resuelven con el default seguro y se reportan, sin detenerse salvo lo
  irreversible o estructural.
- **Trabajo complejo:** modo exploración, modo calibración, revisión por funcionalidad en nivel
  2, y perfil recomendado (completo, mínimo o ninguno) en kickoff y adopt.
- **Seguridad anti hackeo (`/rb-attack`):** corre una sola vez, antes de salir con usuarios
  reales. Después, solo si el dueño lo pide.
- **Descartado:** base de datos de prueba por tarea en el harness (es script de cada proyecto);
  paralelismo sin tope (el tope de 3 se queda y se documenta que es configurable); límites del
  modo rápido configurables (sin evidencia de que estorben).
- **Versión:** 1.0.0 en la fase 1, porque cambia el formato de archivos del proyecto (AGENTS.md,
  etiquetas) y lo que exige el gate.

## 3. Regla de retroceso (calidad)

- Línea base (fase 0): devoluciones por revisor, reversiones y bugs escapados de los 5 repos.
- Después del cambio se miden por nivel (1, 2 y 3) por separado.
- Si un nivel supera su línea base dos semanas seguidas, o la auditoría por muestreo encuentra
  fallas reales en más del 10% de los PRs de nivel 2, ese nivel recupera la revisión que se le
  quitó. `/rb-retro` lo propone con la evidencia.

## 4. Fases

| Fase | Versión | Contenido | Estado |
|---|---|---|---|
| 0. Preparación | sin versión | Issues con evidencia, línea base, reproducción de la regla nueva | Hecha |
| 1. Niveles y aprobación | 1.0.0 | Bloques A y B, y C1 | Hecha (PR #83, release v1.0.0) |
| 2. No interrumpir y lotes | 1.1.0 | Bloques C (sin C1) y D | Hecha |
| 3. Spec | 1.2.0 | Bloque E | Hecha (release v1.2.0) |
| 4. Menos devoluciones y contexto | 1.3.0 | Bloque F | Hecha |
| 5. Trabajo complejo | 1.4.0 | Bloque G | Pendiente |
| 6. Seguridad anti hackeo | 1.5.0 | Bloque H | Pendiente |
| 7. Despliegue y medición | sin versión | Actualizar proyectos, medir dos semanas, retro | Pendiente |
| 8. Tracker en vivo | 1.6.0 | Bloque I (después de medir 1.0 a 1.5) | Pendiente |

Nota de orden: la fase 4 (informes en archivo) es la que más tokens ahorra por sesión. Si el
costo pesa más que las interrupciones, puede subir al segundo lugar sin romper nada.

### Fase 0. Preparación (sin cambios al harness)

- [x] 0.1 Abrir issues en `ragarciaga/rockbuilt` con la evidencia de la sección 1, uno por bloque
      (A a H), enlazados a este plan. Hecho: A #75, B #76, C #77, D #78, E #79, F #80, G #81,
      H #82.
- [x] 0.2 Línea base de calidad e interrupciones de los 5 repos: PRs por nivel C, devoluciones
      por revisor, reversiones, bugs escapados, intervenciones del dueño por día. Guardarla en
      `evals/results/` como archivo fechado.
      Hecho: `evals/results/2026-11-24-field-baseline.md`, calculada con
      `evals/tools/field-baseline.mjs`.
- [x] 0.3 Script de reproducción (en `evals/tools/`) que clasifica los PRs fusionados de los 5
      repos con la regla nueva (nivel y motivo de aprobación) usando la lista real de archivos de
      cada PR. Resultado: qué porcentaje pediría aprobación y cuántos agentes se ahorran. La
      fase 1 solo se publica si cumple la meta de interrupciones.
      Hecho: `evals/tools/replay-levels.mjs` y `evals/results/2026-11-24-replay-levels.md`. No
      cumple la meta en Doorcas sin agrupar decisiones (ver bitácora).

### Fase 1. Niveles y aprobación (1.0.0)

Bloque A, niveles y aprobación:
- [x] A1 `rb risk` devuelve nivel (1, 2, 3) y la lista de motivos de aprobación (lista cerrada
      de la sección 2), en lugar de un solo nivel A, B o C. Hecho: junto al tier, que sigue
      decidiendo el merge hasta A5 (DESIGN 29).
- [x] C1 (adelantado desde la fase 2, decisión del 2026-11-24) Agrupar las decisiones en un solo
      mensaje por punto de control. Ver su texto completo en la fase 2.
- [x] A2 El límite de tamaño no cuenta pruebas ni fixtures.
- [x] A3 Archivos de contabilidad (LESSONS, progress, tasks.md) dentro de un PR de tarea no suben
      el nivel.
- [x] A4 El planner puede subir la profundidad de revisión, pero no pedir aprobación fuera de la
      lista cerrada. Un servicio pago aprobado con tope en `Paid services` no pide aprobación.
- [x] A5 Merge gate: exige las revisiones según el nivel; para lo que pide aprobación, verifica
      el comentario del dueño sobre el plan (autor y fecha), nunca una bandera que pase el agente.
      Las reglas (`Sensitive paths`, delegación, presupuesto) se leen de AGENTS.md en la base del
      PR, nunca en su head, para que un PR no afloje la regla con la que lo juzgan.
- [x] A6 Aprobación delegada: registro en el issue de control con palabras textuales, alcance y
      vencimiento; el gate la acepta dentro del alcance; marca en cada PR; aviso en el digest.
      Incluye la forma por alcance de una corrida ("full auto" de un milestone o de issues
      nombradas), que nunca aplica a corridas desatendidas.
- [x] A7 Dependencias: preaprobadas si están en el diseño; libres las de desarrollo y pruebas;
      chequeo automático (licencia, vulnerabilidades, mantenimiento) para las demás.
- [x] A8 Etiquetas nuevas de nivel (level-1, level-2, level-3) y de aprobación pendiente; el gate
      acepta las etiquetas de nivel viejas durante la transición.
- [x] A9 Nivel 1 se fusiona sin agentes; nivel 2 sin auditor cuando no cambia algo visible.
- [x] A10 Conversión en "actualiza rockbuilt": campos nuevos en AGENTS.md y recalibración de
      `Sensitive paths` que el dueño revisa una vez por proyecto.
- [x] A11 Revisión adversarial del gate nuevo por dos revisores independientes antes de publicar.
      Casos obligatorios, tomados de la auditoría externa de trail-blazer-flow v3.7.1: un veredicto
      del verifier publicado por una cuenta distinta a la autora del PR, y nombres de rama con
      caracteres fuera de `[A-Za-z0-9._/-]` que puedan llegar a una línea de comandos.
- [x] A12 Presupuesto de devoluciones configurable en AGENTS.md (0 a 3, por defecto 2).

Bloque B, calidad medida:
- [x] B1 Pruebas en nivel 1 solo si agregan (el diff no quita ni cambia aserciones existentes y el
      número de pruebas no baja); si no, nivel 2.
- [x] B2 Auditoría por muestreo: 1 de cada 5 PRs de nivel 2 lleva auditor.
- [x] B3 `rb quality` y el digest muestran métricas por nivel e intervenciones del dueño por día.
- [x] B4 `/rb-retro` aplica la regla de retroceso de la sección 3.
- [x] B5 Reescribir los evals que exigen auditor o nivel C y ya no aplican; agregar escenarios
      por nivel y de aprobación delegada.
- [x] B6 DESIGN (sección nueva con evidencia), CHANGELOG, README, GUIA.

### Fase 2. No interrumpir y lotes (1.1.0)

Bloque C, interrupciones:
- [x] C1 (hecho en la fase 1) Las decisiones se apartan sin bloquear: la sesión sigue con otro trabajo y manda un solo
      mensaje con todo lo pendiente por punto de control o al final de la corrida. Base mecánica:
      estado en JSON con dos mitades, lo que el harness hará solo y lo que espera al dueño (planes
      por aprobar, PRs, bloqueados, seguimientos, escalaciones), marcado como incompleto si falla
      una consulta a GitHub. La misma salida alimenta la métrica de interrupciones (B3).
- [x] C2 Regla en los skills: no preguntar lo que tiene un default razonable ("¿lo subo?",
      "¿sigo?").
- [x] C3 Hook que registra cada aviso de permiso de Claude Code en el proyecto; reporte para
      ampliar la lista de comandos permitidos. En corridas sin supervisión, documentar en CLOUD
      el modo en que un aviso de permiso se vuelve una negación reportada como escalación, en vez
      de congelar la corrida.
- [x] C4 Fase de "espera humana" separada en los tiempos; arreglo de fases abiertas y totales en 0.

Bloque D, lotes:
- [x] D1 `/rb-quick` acepta una lista de issues existentes como un lote.
- [x] D2 El ciclo agrupa los pendientes de nivel 1 en un solo PR.
- [x] D3 `/rb-build` avisa cuando recibe algo de nivel 1 o 2 pequeño y sugiere el lote.
- [x] D4 Tareas de spec más grandes (revisar límites de `rb tasks`).
- [x] D5 Seguimientos que abren las revisiones: fuera del objetivo actual hasta que el dueño los
      promueva; `rb-status` los lista aparte. Diseño de trail-blazer-flow: nacen con una etiqueta
      de "sin plan" que los saca de toda cola, otra etiqueta los estaciona, y cerrarlos como no
      planeados los descarta.

### Fase 3. Spec (1.2.0)

Bloque E:
- [x] E1 Inventario de decisiones obligatorio por requisito: números y umbrales, tiempos, qué pasa
      si (fallas, cancelaciones, duplicados, topes), quién puede, datos (retención, borrado,
      redacción) y definiciones (métricas). `rb` verifica que no quede vacío antes de aprobar,
      con el mismo patrón del decision record de trail-blazer-flow (secciones obligatorias y
      con contenido, revisadas por código).
- [x] E2 Una sola ronda de preguntas con defaults propuestos ("acepto todo salvo 3 y 7").
- [x] E3 Huecos durante la construcción: default seguro, registrado como decisión por defecto,
      reportado en el digest; detenerse solo si es irreversible o estructural.
- [x] E4 Prueba con el spec de Doorcas: las 18 preguntas de huecos deberían quedar cubiertas.

### Fase 4. Menos devoluciones y menos contexto (1.3.0)

Bloque F:
- [x] F1 Agentes escriben su informe en `.rockbuilt/reports/` y devuelven un resumen corto; el
      orquestador publica desde el archivo.
- [x] F2 Subcomando nuevo de rb `criteria`: imprime los criterios vigentes, literales, desde su
      fuente; las enmiendas se editan en la fuente.
- [x] F3 Chequeo de Safety steps antes del verifier: cada paso del plan con su prueba y la
      evidencia de que falla sin él.
- [x] F4 Cada revisor en su propia copia; el verifier nunca muta el directorio de trabajo; nada de
      archivos de sondas en el árbol.
- [x] F5 Subir la rama apenas se colapsa (heads revisados alcanzables, menos PRs reemplazados).
- [x] F6 `rb parallel` trata la carpeta de migraciones como archivo compartido.
- [x] F7 El ciclo no escribe entradas vacías en progress.md.
- [x] F8 Aviso de versión del harness desactualizada en doctor y digest.
- [x] F9 Investigar: cola de merge atascada en `queue-pending` (maysa) y si el guard sigue
      bloqueando scripts con argumentos a verifier y auditor (visto en 3d_brain con 0.9.0).
- [x] F10 Vigilar: `rb-fix` dejó una corrección como segundo commit en un eval (2026-11-11).
- [x] F11 CI después del merge y arreglo hacia adelante: si las pruebas del PR no corren toda la
      suite, cada merge espera la CI de la rama principal; si queda en rojo por un merge de la
      corrida, se abre un issue de arreglo que se construye y fusiona una vez bajo los mismos
      gates; un segundo rojo detiene la corrida y se revierte.
- [x] F12 El doctor avisa cuando las acciones de la CI no están fijadas a un commit (SHA) y cuando
      la protección de rama no exige ramas al día.
- [x] F13 Clase de hallazgo `wording` en el verifier: si todo lo que falla es texto, trae el
      reemplazo exacto y tiene una ronda de corrección que no gasta presupuesto de devoluciones.
- [x] F14 Agentes sin esperas en bucle: comandos largos en primer plano o esperando la
      notificación, nada queda corriendo al terminar.

### Fase 5. Trabajo complejo (1.4.0)

Bloque G:
- [ ] G1 Modo exploración: rama con tiempo fijo, sin revisores, nunca a `main`; entrega una
      conclusión que alimenta el spec.
- [ ] G2 Modo calibración: la eval es el gate; cada iteración con tope de costo y se queda solo si
      mejora; una revisión normal al final.
- [ ] G3 Revisión por funcionalidad en nivel 2: tareas a una rama de la funcionalidad con pruebas
      y verifier; auditor y seguridad una vez sobre la funcionalidad completa.
- [ ] G4 Kickoff y adopt recomiendan perfil: completo, mínimo (solo CI y pruebas) o ninguno.

### Fase 6. Seguridad anti hackeo (1.5.0)

Bloque H, `/rb-attack` (modelo: lo que se hizo en Maysa Chart):
- [ ] H1 Hito "salida con usuarios reales" en el kickoff; `rb-status` y el digest lo recuerdan.
- [ ] H2 Modelo de amenaza desde el brief y el código.
- [ ] H3 Sección `## Security probes` en AGENTS.md: diagnósticos de solo lectura del entorno vivo
      (permisos y RLS, grants de funciones, secretos en herramientas externas, qué expone el
      navegador, diferencias entre el repo y producción).
- [ ] H4 Intentos de explotación con cuentas de prueba, sin dañar datos reales; cada intento queda
      como prueba automatizada cuando se puede.
- [ ] H5 Un issue por hallazgo con severidad y exploit reproducible; los críticos bloquean el
      lanzamiento.
- [ ] H6 Alcance aprobado por el dueño una sola vez; solo sistemas propios; nunca terceros.

### Fase 7. Despliegue y medición

- [ ] 7.1 Actualizar Doorcas, signal-engine, 2brain, maysa y 3d_brain (salta desde 0.9.0).
- [ ] 7.2 Quitar las "reglas de velocidad" del CLAUDE.md de Doorcas, ya cubiertas por el harness.
- [ ] 7.3 Medir dos semanas contra la línea base de la fase 0.
- [ ] 7.4 `/rb-retro` y ajustes con la regla de retroceso.

### Fase 8. Tracker en vivo (1.6.0)

Bloque I, página privada en claude.ai para seguir el proyecto desde el celular (modelo: el tracker
de trail-blazer-flow v3.8.0). Va después de medir 1.0 a 1.5, porque se alimenta del estado en JSON
(C1) y de las métricas por nivel (B3).
- [ ] I1 Página con resumen primero: avance por milestone, qué puede moverse ya y qué espera al
      dueño.
- [ ] I2 Bloques "Esperando por ti" (planes, PRs, decisiones, seguimientos) y "Publicado en los
      últimos 14 días", marcando los merges que no tuvieron segunda revisión.
- [ ] I3 Franja de salud: CI de la rama principal, baseline (fecha, commit y si va detrás) y
      aprobación delegada vigente.
- [ ] I4 El ciclo refresca la página como último paso; también a pedido ("actualiza el tracker").
- [ ] I5 Secciones escritas a mano (pasos, tarjetas, matriz de estado) y tablas proyectadas desde
      archivos del repo.
- [ ] I6 Resumen escrito por el modelo, opcional y apagado por defecto (cuesta tokens en cada
      ciclo y es una opinión, no el estado).
- [ ] I7 La página solo muestra el estado de GitHub; nada en ella cambia un issue o un PR.

## 5. Pendientes del dueño (fuera del harness)

- [ ] Crear los releases `v0.12.0`, `v0.13.0`, `v0.13.1` y `v0.14.0` en GitHub (opcional).
- [ ] 2brain-logic: "actualiza rockbuilt", fusionar el PR y aceptar la protección de rama.
- [ ] comms-reporting: correr `/rb-adopt` y agregar `## Deploy check` como script de npm.
- [ ] Proyectos con AGENTS.md: agregar `## Deploy check` y `## Seed` donde apliquen.

## 6. Bitácora

- 2026-11-24: plan acordado. Base: 0.14.0 en `main` (PR #72 con el README al día). Siguiente paso:
  fase 0.
- 2026-11-24: revisado `msummer/trail-blazer-flow` v3.8.0; se agregan A5 (reglas desde la base),
  A6 (full auto por alcance), A11 (casos de su auditoría externa), A12, C1 (estado en JSON), C3
  (corridas sin avisos de permiso), D5 (etiquetas de seguimientos), E1 (patrón decision record),
  F11 a F14 y la fase 8 (tracker en vivo). Agregado el prompt para arrancar una sesión.
- 2026-11-24: 0.1 hecho. Issues por bloque abiertos con la etiqueta `harness-feedback`, en inglés
  como los anteriores: A #75, B #76, C #77, D #78, E #79, F #80, G #81, H #82. Sin evals.
- 2026-11-24: 0.2 hecho. Línea base en `evals/results/2026-11-24-field-baseline.md` (539 PRs
  fusionados, datos vía Composio con la cuenta "rag"), script `evals/tools/field-baseline.mjs` con
  su prueba. Cifras: nivel C 52% a 87%; intervenciones por día 20,8 Doorcas, 8,4 signal-engine,
  6,2 2brain, menos de 3 en maysa y 3d_brain; devoluciones en 53% a 88% de los PRs con datos (el
  plan decía 55% a 76%: otra definición; la nueva queda en el script); 0 reversiones y 0 bugs
  escapados trazados; 3d_brain (0.9.0) sin veredictos de revisores. Definición de intervención:
  escalaciones más merges aprobados por humano más merges a mano, por día calendario. Sin evals.
- 2026-11-24: 0.3 hecho. `evals/tools/replay-levels.mjs` usa el `classify` real de `rb risk` sobre
  los archivos y parches de los 539 PRs; resultado en `evals/results/2026-11-24-replay-levels.md`.
  Piden aprobación 17% a 24% de los PRs. Interrupciones por día solo por el diff: Doorcas 3,2,
  signal-engine 1,9, 2brain 2,0, maysa 1,1, 3d_brain 0,8; sumando las escalaciones de hoy (huecos
  del spec, hasta la fase 3): Doorcas 7,6 y signal-engine 4,4. Agrupando las decisiones en un
  mensaje por día (C1) todos quedan en 1 o menos. Agentes ahorrados: 3% a 16%, mucho menos de lo
  esperado, porque `Sensitive paths` cubre casi todo `src/` (Doorcas: 44 de 82 PRs en nivel 3).
  Hallazgos para la fase 1: `rb risk` no aprueba `Anthropic API (...)` en `Paid services` por
  comparar la clave exacta (A4); las ediciones del design.md o requirements.md de la propia
  funcionalidad dentro de una tarea piden aprobación (16 de 26 en 2brain); `**/design.md` toca la
  plantilla del harness. Decisión del dueño pendiente antes de publicar la fase 1: la regla sola no
  cumple la meta; recomiendo adelantar C1 (agrupar decisiones) a la 1.0.0. Sin evals.
- 2026-11-24: Andrés decide adelantar C1 (agrupar decisiones) a la 1.0.0, porque la regla de
  niveles sola no cumple la meta en Doorcas. Regla de versión de la fase 1: los PRs de cada punto
  no suben la versión; la 1.0.0 sale cuando la fase completa esté fusionada, para no publicar un
  gate a medias.
- 2026-11-24: A1 hecho. `rb risk` devuelve `level`, `approvals`, `checks` y `levelReasons` junto
  al tier (DESIGN 29, `tests/rb-level.test.mjs`). Defaults decididos con la reproducción: editar
  un spec existente dentro de una tarea es nivel 3 y se reporta, no se pregunta (crear uno sí
  pregunta); un host externo nuevo es nivel 3 sin aprobación; una dependencia de runtime va al
  chequeo automático (A7), las de desarrollo son libres; el design.md de las plantillas del
  harness no cuenta como arquitectura. Sin evals: el cambio es una función de `rb` sin consumidores
  todavía, y lo cubren pruebas unitarias. Siguiente: A2.
- 2026-11-24: A2, A3 y B1 hechos en `rb risk` (DESIGN 29.2 a 29.4). Default: LESSONS.md no sube a
  nivel 3, pero un diff que la toca es al menos nivel 2 (obliga a todos los agentes). B1 usa
  "ninguna línea borrada en archivos de prueba" como criterio de "solo agrega".
- 2026-11-24: fase 1 completa en código, falta B5 (evals). Hechos A4 a A12, B2, B3, B4, B6 y C1
  (DESIGN 29.5 a 29.12): gate por nivel, aprobación por comentario del dueño, `rb delegate` y el
  skill `/rb-delegate`, `rb deps`, `rb state`, `rb quality` por nivel, conversión en doctor e
  install, versión 1.0.0, CHANGELOG, README, GUIA y CLOUD. Defaults decididos: en nivel 2 el
  auditor también corre siempre en bugs (`rb/B<n>`) y lotes rápidos (`rb/Q<n>`), porque describen
  lo que el usuario ve; el muestreo 1 de 5 usa el commit, no el número de PR; una delegación
  necesita fecha y no pasa de 90 días; solo aprueba quien tiene permiso de escritura. A11: dos
  revisores adversariales encontraron 23 hallazgos (2 críticos), todos corregidos con prueba salvo
  los veredictos por asociación (límite conocido, DESIGN 13). Pruebas: 636 en verde. Evals:
  reescrito `build-tier-c-escalates` como `build-approval-escalates` (una dependencia ya no
  pregunta; un servicio pago sí) y agregados `delegate-records-words`,
  `delegate-ignores-issue-text` y `quick-s3-level1-docs`; pendiente correrlos (requiere visto
  bueno del costo).
- 2026-11-24: B5 hecho. Suite completa 21/21 en verde (`evals/results/2026-11-24-1.0.md`). Los dos
  fallos de la primera pasada de los escenarios nuevos eran del eval (main se mueve en nivel 1 por
  diseño; el fixture de aprobación contradecía el Out of scope del spec) y quedaron corregidos.
  Costo total de evals de la 1.0.0: 17,18 USD a precio de API. Fase 1 lista para merge; después
  del merge, crear el release `v1.0.0`. Siguiente: fase 2 (C2 a C4, D1 a D5).
- 2026-11-24: 1.0.0 fusionada por Andrés (#83) y release `v1.0.0` publicado. Andrés pide terminar
  el plan sin preguntar y fusionar yo mismo.
- 2026-11-24: fase 2 hecha (1.1.0, DESIGN 30): C2 regla de defaults en los skills; C3 hook
  `PermissionRequest` y `rb permissions report`; C4 fase `wait` y cierre de fases en `rb sync`;
  D1 `/rb-quick #a #b` con la marca `rockbuilt:batch` (el gate revisa y cierra los issues del
  lote); D2 lote de nivel 1 en el ciclo; D3 aviso en `/rb-build`; D4 tareas de hasta 10 archivos
  de producción y 6 criterios; D5 `rb:unplanned` y `rb:parked`. Evals 22/22, 13,18 USD
  (`evals/results/2026-11-24-1.1.md`).
- 2026-11-24: fase 3 hecha (1.2.0, DESIGN 31): inventario de decisiones de seis líneas por
  requisito con `rb spec check` y chequeo en el gate para specs nuevos; una ronda de preguntas
  con defaults; huecos en construcción con default seguro y sección "Defaults tomados" en el
  resumen. E4: las seis categorías cubren 17 de los 18 huecos que Doorcas escaló
  (`evals/results/2026-11-24-inventory-doorcas.md`). Eval nuevo `spec-inventory-es`. Evals 23/23, 15,77 USD con la repetición tras la revisión independiente (`evals/results/2026-11-24-1.2.md`); el eval nuevo encontró que el paso 1 de rb-spec seguía preguntando de a una (corregido).
- 2026-11-24: Andrés pregunta si Rockbuilt se usa para construir Rockbuilt: no (se sigue el proceso del repo, sin planner, verifier ni gate). Desde entonces cada PR lleva una revisión independiente antes de fusionar; la de las fases 2 y 3 encontró 11 hallazgos (3 altos), todos corregidos con prueba (DESIGN 31.5).
- 2026-11-24: fase 4 hecha (1.3.0, DESIGN 32). Defaults decididos: F4 con `rb tree-check` en vez
  de una copia por revisor (el verifier necesita las dependencias instaladas); F12 sin aviso de
  "ramas al día" porque la cola de merges depende de no exigirlo y el gate lo exige por su cuenta;
  F6 ya estaba hecho desde 0.7. F9: la cola de maysa no estaba atascada (fusionó en minutos); el
  guard sí bloqueaba al auditor corriendo la CLI con argumentos (corregido). F10 no se repitió.
- 2026-11-24: revisión independiente de la fase 4: 10 hallazgos (1 alto: un revisor podía crear y ejecutar código desde su informe), todos corregidos con prueba (DESIGN 32.14).
