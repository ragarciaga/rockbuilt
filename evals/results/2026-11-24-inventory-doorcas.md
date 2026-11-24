# Decision inventory against Doorcas, 2026-11-24

PLAN-1.0 item E4. The 22 escalation comments on `agarcia-bfa/Doorcas-Africa-Farm-Assistant` (read
through the Composio GitHub connector on 2026-11-24), sorted by what the owner was asked and
whether the 1.2.0 decision inventory would have settled it in the spec.

| Issue | What was asked | Inventory line that settles it | Still asks the owner in 1.x (closed list) |
|---|---|---|---|
| #3 | Skeleton split, schema and first migration | none (structure) | schema |
| #5 | Triage thresholds the spec did not give (mortality %, birds, days) | Numbers | no |
| #7 | 24-hour gate: free text vs template, new columns | Timing, What if | schema (migration) |
| #30 | Direction for triage text rules after failed security reads | Definitions, What if | no |
| #8 | Personal data sent to OpenAI, phone redaction | Data | cost (paid provider) |
| #12 (A) | Login, session, rate limit, shared password, name picker | Who can | auth-model |
| #12 (B1) | Every open case visible to every logged-in vet | Who can | no |
| #12 (B2) | Farmer's phone shown to every vet | Who can, Data | no |
| #13 | Vet reply outside the 24-hour window (template), state change | Timing, What if | no |
| #11 | Vet alerts outside 24 h, retries up to 10 per vet per case | Numbers, Timing, What if | no |
| #17 | Close outcomes, confirmed diagnosis never sent to the farmer | Definitions, Data | no |
| #18 | Who edits vets, hours and timers; change log | Who can, Data | no |
| #15 | Escalation timers, Urgent clock, retries | Numbers, Timing | no |
| #77 | "Not sure" answers raise risk to Moderate | Definitions | no |
| #21 | Gemini provider, free tier sends farmer data to training | Data | cost |
| #10 | Farmer intake, 21 amendments (advisory defaults, narrowing) | Numbers, What if, Data | no |
| #78 | Farmer data deletion on request, new table | Data (deletion) | schema, irreversible |
| #12 | Blocked after 2 kickbacks (limiter rule) | not a spec gap | no (Kickback budget, A12) |
| #87 | One more test-only kickback? | not a spec gap | no (A12, F13) |
| #69 | One more test-only kickback? | not a spec gap | no (A12, F13) |
| #69 | Drop the clause-final number rule after a security delta | not a spec gap | no |
| #9 | Paid transcription on the OpenAI key | Data | cost |

## Result

- 18 of the 22 escalations were decisions the spec left open; 17 map to at least one inventory
  line (Numbers 4, Timing 4, What if 5, Who can 4, Data 8, Definitions 3). The one left, #3 (the
  skeleton split and first migration), is structural and asks under the closed list anyway. The other 4 were kickback
  budget questions, handled by `Kickback budget` (1.0) and the `wording` class (phase 4).
- With the inventory, those 18 are settled at spec approval in one round of numbered defaults
  instead of one escalation each during the build. 7 of them still carry a closed-list approval
  (schema 3, cost 3, auth-model 1, irreversible 1, some issues two): the inventory moves them to
  the spec too, where the owner answers them in the same round.
- This is a desk check of the categories against the real questions, not a replay of the build:
  it shows the inventory has a line for 17 of the 18 gaps Doorcas hit, not that a planner fills each
  line well. The eval `spec-inventory-es` checks that part.
