# Plan Rockbuilt 1.0: ayudar en lugar de frenar

Plan de trabajo acordado con Andrés el 2026-11-24. Este archivo es la fuente de verdad del
avance: cada sesión lo lee antes de empezar, toma la siguiente casilla abierta de la fase en
curso, y al terminar marca lo hecho y agrega una línea en la bitácora del final.

**Objetivo.** Que Rockbuilt acelere la construcción sin perder calidad: menos agentes en lo
trivial, menos interrupciones al dueño, specs que no dejen huecos, y el ciclo completo solo donde
están los defectos graves. Si algo queda mal, se ajusta con la regla de retroceso (sección 3).

**Estado.** Versión en `main`: 0.14.0. Fase en curso: **0 (preparación)**. Ver la tabla de fases.

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
  muestra arriba mientras esté vigente.
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
| 0. Preparación | sin versión | Issues con evidencia, línea base, reproducción de la regla nueva | Pendiente |
| 1. Niveles y aprobación | 1.0.0 | Bloques A y B | Pendiente |
| 2. No interrumpir y lotes | 1.1.0 | Bloques C y D | Pendiente |
| 3. Spec | 1.2.0 | Bloque E | Pendiente |
| 4. Menos devoluciones y contexto | 1.3.0 | Bloque F | Pendiente |
| 5. Trabajo complejo | 1.4.0 | Bloque G | Pendiente |
| 6. Seguridad anti hackeo | 1.5.0 | Bloque H | Pendiente |
| 7. Despliegue y medición | sin versión | Actualizar proyectos, medir dos semanas, retro | Pendiente |

Nota de orden: la fase 4 (informes en archivo) es la que más tokens ahorra por sesión. Si el
costo pesa más que las interrupciones, puede subir al segundo lugar sin romper nada.

### Fase 0. Preparación (sin cambios al harness)

- [ ] 0.1 Abrir issues en `ragarciaga/rockbuilt` con la evidencia de la sección 1, uno por bloque
      (A a H), enlazados a este plan.
- [ ] 0.2 Línea base de calidad e interrupciones de los 5 repos: PRs por nivel C, devoluciones
      por revisor, reversiones, bugs escapados, intervenciones del dueño por día. Guardarla en
      `evals/results/` como archivo fechado.
- [ ] 0.3 Script de reproducción (en `evals/tools/`) que clasifica los PRs fusionados de los 5
      repos con la regla nueva (nivel y motivo de aprobación) usando la lista real de archivos de
      cada PR. Resultado: qué porcentaje pediría aprobación y cuántos agentes se ahorran. La
      fase 1 solo se publica si cumple la meta de interrupciones.

### Fase 1. Niveles y aprobación (1.0.0)

Bloque A, niveles y aprobación:
- [ ] A1 `rb risk` devuelve nivel (1, 2, 3) y la lista de motivos de aprobación (lista cerrada
      de la sección 2), en lugar de un solo nivel A, B o C.
- [ ] A2 El límite de tamaño no cuenta pruebas ni fixtures.
- [ ] A3 Archivos de contabilidad (LESSONS, progress, tasks.md) dentro de un PR de tarea no suben
      el nivel.
- [ ] A4 El planner puede subir la profundidad de revisión, pero no pedir aprobación fuera de la
      lista cerrada. Un servicio pago aprobado con tope en `Paid services` no pide aprobación.
- [ ] A5 Merge gate: exige las revisiones según el nivel; para lo que pide aprobación, verifica
      el comentario del dueño sobre el plan (autor y fecha), nunca una bandera que pase el agente.
- [ ] A6 Aprobación delegada: registro en el issue de control con palabras textuales, alcance y
      vencimiento; el gate la acepta dentro del alcance; marca en cada PR; aviso en el digest.
- [ ] A7 Dependencias: preaprobadas si están en el diseño; libres las de desarrollo y pruebas;
      chequeo automático (licencia, vulnerabilidades, mantenimiento) para las demás.
- [ ] A8 Etiquetas nuevas de nivel (level-1, level-2, level-3) y de aprobación pendiente; el gate
      acepta las etiquetas de nivel viejas durante la transición.
- [ ] A9 Nivel 1 se fusiona sin agentes; nivel 2 sin auditor cuando no cambia algo visible.
- [ ] A10 Conversión en "actualiza rockbuilt": campos nuevos en AGENTS.md y recalibración de
      `Sensitive paths` que el dueño revisa una vez por proyecto.
- [ ] A11 Revisión adversarial del gate nuevo por dos revisores independientes antes de publicar.

Bloque B, calidad medida:
- [ ] B1 Pruebas en nivel 1 solo si agregan (el diff no quita ni cambia aserciones existentes y el
      número de pruebas no baja); si no, nivel 2.
- [ ] B2 Auditoría por muestreo: 1 de cada 5 PRs de nivel 2 lleva auditor.
- [ ] B3 `rb quality` y el digest muestran métricas por nivel e intervenciones del dueño por día.
- [ ] B4 `/rb-retro` aplica la regla de retroceso de la sección 3.
- [ ] B5 Reescribir los evals que exigen auditor o nivel C y ya no aplican; agregar escenarios
      por nivel y de aprobación delegada.
- [ ] B6 DESIGN (sección nueva con evidencia), CHANGELOG, README, GUIA.

### Fase 2. No interrumpir y lotes (1.1.0)

Bloque C, interrupciones:
- [ ] C1 Las decisiones se apartan sin bloquear: la sesión sigue con otro trabajo y manda un solo
      mensaje con todo lo pendiente por punto de control o al final de la corrida.
- [ ] C2 Regla en los skills: no preguntar lo que tiene un default razonable ("¿lo subo?",
      "¿sigo?").
- [ ] C3 Hook que registra cada aviso de permiso de Claude Code en el proyecto; reporte para
      ampliar la lista de comandos permitidos.
- [ ] C4 Fase de "espera humana" separada en los tiempos; arreglo de fases abiertas y totales en 0.

Bloque D, lotes:
- [ ] D1 `/rb-quick` acepta una lista de issues existentes como un lote.
- [ ] D2 El ciclo agrupa los pendientes de nivel 1 en un solo PR.
- [ ] D3 `/rb-build` avisa cuando recibe algo de nivel 1 o 2 pequeño y sugiere el lote.
- [ ] D4 Tareas de spec más grandes (revisar límites de `rb tasks`).
- [ ] D5 Seguimientos que abren las revisiones: fuera del objetivo actual hasta que el dueño los
      promueva; `rb-status` los lista aparte.

### Fase 3. Spec (1.2.0)

Bloque E:
- [ ] E1 Inventario de decisiones obligatorio por requisito: números y umbrales, tiempos, qué pasa
      si (fallas, cancelaciones, duplicados, topes), quién puede, datos (retención, borrado,
      redacción) y definiciones (métricas). `rb` verifica que no quede vacío antes de aprobar.
- [ ] E2 Una sola ronda de preguntas con defaults propuestos ("acepto todo salvo 3 y 7").
- [ ] E3 Huecos durante la construcción: default seguro, registrado como decisión por defecto,
      reportado en el digest; detenerse solo si es irreversible o estructural.
- [ ] E4 Prueba con el spec de Doorcas: las 18 preguntas de huecos deberían quedar cubiertas.

### Fase 4. Menos devoluciones y menos contexto (1.3.0)

Bloque F:
- [ ] F1 Agentes escriben su informe en `.rockbuilt/reports/` y devuelven un resumen corto; el
      orquestador publica desde el archivo.
- [ ] F2 Subcomando nuevo de rb `criteria`: imprime los criterios vigentes, literales, desde su
      fuente; las enmiendas se editan en la fuente.
- [ ] F3 Chequeo de Safety steps antes del verifier: cada paso del plan con su prueba y la
      evidencia de que falla sin él.
- [ ] F4 Cada revisor en su propia copia; el verifier nunca muta el directorio de trabajo; nada de
      archivos de sondas en el árbol.
- [ ] F5 Subir la rama apenas se colapsa (heads revisados alcanzables, menos PRs reemplazados).
- [ ] F6 `rb parallel` trata la carpeta de migraciones como archivo compartido.
- [ ] F7 El ciclo no escribe entradas vacías en progress.md.
- [ ] F8 Aviso de versión del harness desactualizada en doctor y digest.
- [ ] F9 Investigar: cola de merge atascada en `queue-pending` (maysa) y si el guard sigue
      bloqueando scripts con argumentos a verifier y auditor (visto en 3d_brain con 0.9.0).
- [ ] F10 Vigilar: `rb-fix` dejó una corrección como segundo commit en un eval (2026-11-11).

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

## 5. Pendientes del dueño (fuera del harness)

- [ ] Crear los releases `v0.12.0`, `v0.13.0`, `v0.13.1` y `v0.14.0` en GitHub (opcional).
- [ ] 2brain-logic: "actualiza rockbuilt", fusionar el PR y aceptar la protección de rama.
- [ ] comms-reporting: correr `/rb-adopt` y agregar `## Deploy check` como script de npm.
- [ ] Proyectos con AGENTS.md: agregar `## Deploy check` y `## Seed` donde apliquen.

## 6. Bitácora

- 2026-11-24: plan acordado. Base: 0.14.0 en `main` (PR #72 con el README al día). Siguiente paso:
  fase 0.
