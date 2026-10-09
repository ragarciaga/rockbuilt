# EARS (Easy Approach to Requirements Syntax)

Each acceptance criterion is one sentence in one of five patterns, with one trigger and one
observable response. Write them in the docs language; keep IDs and tags in English.

| Pattern | English | Spanish |
|---|---|---|
| Ubiquitous | The system shall <response>. | El sistema deberá <respuesta>. |
| Event | When <trigger>, the system shall <response>. | Cuando <evento>, el sistema deberá <respuesta>. |
| State | While <state>, the system shall <response>. | Mientras <estado>, el sistema deberá <respuesta>. |
| Unwanted | If <condition>, then the system shall <response>. | Si <condición>, entonces el sistema deberá <respuesta>. |
| Optional | Where <feature is included>, the system shall <response>. | Donde <la funcionalidad esté incluida>, el sistema deberá <respuesta>. |

Complex: combine at most one `While` with one `When` ("While logged out, when the user opens
/dashboard, the system shall redirect to /login.").

## Verification tags (exactly one per criterion, at the end)

| Tag | Means | Example check |
|---|---|---|
| `[unit]` | A unit test with no I/O | `npm test -- parse.test.ts` |
| `[integration]` | Test against a real DB, queue, or a recorded fixture of an external API | `npm test -- invoices.int.test.ts` |
| `[e2e]` | Playwright flow in the running app | `npm run test:e2e -- checkout.spec.ts` |
| `[eval]` | Dataset + grader with a threshold, for LLM/ML output | `npm run evals` score >= 0.85 |
| `[manual]` | Human check; reason required | `[manual] visual brand review, no objective oracle` |

## Quality checklist

- Observable: the response is something a test can assert (a value, a status code, a rendered
  text, a row, a file). Not "handles", "supports", "is fast", "user-friendly".
- Quantified: numbers for limits, sizes, times ("within 2 s for 95% of requests").
- One behavior per criterion. Split "and" into two criteria.
- No implementation: no library names, table names or function names (those go in design.md),
  unless the requirement is itself a contract with another system.
- Unwanted cases covered: invalid input, missing permission, dependency down, empty result,
  duplicate submission, limit exceeded.
- Consistent terms: one name per concept, matching the brief's vocabulary.

## Examples

Weak: "The system should handle errors from the transcription API."
Strong:
- `R3.4` If the transcription service returns an error for one item, then the system shall mark
  that item as failed with the error message and continue processing the remaining items. `[integration]`
- `R3.5` If more than 50% of items fail in one run, then the system shall stop the run and report
  the failure count. `[integration]`

Weak: "The summary must be good."
Strong:
- `R2.3` When a transcript is analyzed, the system shall produce a summary that contains the main
  claim of the source, scoring at least 0.8 on the summary-fidelity eval. `[eval]`

Spanish:
- `R1.2` Cuando el usuario envía el formulario con un correo ya registrado, el sistema deberá
  mostrar "Este correo ya tiene una cuenta" sin crear un registro nuevo. `[e2e]`
