# Weekly Review Protocol

Sixty minutes, same day each week, recorded in the **Weekly Review** sheet of `implementation_calendar/build_calendar.xlsx`.

The purpose is to keep the schedule honest and to catch drift while it is still cheap. It is not a status report — there is nobody to report to. It is the mechanism that prevents a plan from quietly becoming fiction.

## Agenda

### 1. Velocity (10 min)

- Cards planned this week versus completed, carried, and blocked
- Actual effort versus the one-day assumption
- **Rolling completion rate** over the last four weeks
- Projected end date, recomputed from the actual rate

The rolling rate is the number that matters. A single slow week is noise; four weeks at 60% means the plan's end date is wrong and should be restated rather than defended.

### 2. Gate status (5 min)

- Current phase and its gate criteria
- What remains before the gate
- Any gate criterion at risk

**No gate is passed on a date.** It passes when its acceptance test passes in CI. G1 (tenant isolation) and G3 (no double-booking) are never waivable.

### 3. Quality and security (15 min)

- New scanner findings: dependency, SAST, secrets — triaged, not just counted
- Test coverage trend, and specifically domain-package coverage
- Any test skipped, quarantined, or weakened this week — **this is the highest-signal item on the agenda**
- Dependency update pull requests: review and merge
- Security review triggers hit this week (`10`) and whether the reviews were recorded
- Hash-chain verification job results

A skipped or weakened test almost always precedes a defect in the same area. Anything skipped gets an owner and a date, or gets deleted honestly.

### 4. Scope and decisions (10 min)

- ADRs raised this week
- Scope changes requested, and what each costs in days
- Items accumulated in `IMPROVEMENTS.md` — promote, defer, or delete
- Blocking decisions D1–D4 still outstanding

**Scope additions extend the end date.** There is no slack in the plan. Recording the cost each time is what keeps that visible.

### 5. Risk register (10 min)

Review `14_risk_register_technical.md`: has any risk materialized, changed severity, or been retired? Any new risk from this week's work?

### 6. Next week (10 min)

- Confirm next week's cards are correctly scoped and unblocked
- Re-scope anything that now looks larger than a day
- Confirm any external dependency (provider account, decision, credential) is in place *before* the card that needs it

The last point is the one that saves the most time. A card blocked on an account that takes two days to provision costs two days if discovered on the day, and nothing if discovered a week ahead.

## Recorded fields

Each week's row in the workbook:

| Field | |
|---|---|
| Week number and dates | |
| Phase | |
| Cards planned / completed / carried / blocked | |
| Completion rate, this week and 4-week rolling | |
| Gate status | On track / At risk / Passed / Failed |
| New critical or high findings | |
| Findings remediated | |
| Tests skipped or weakened | |
| Coverage, domain package | |
| ADRs raised | |
| Scope changes and their day cost | |
| Risks changed | |
| Projected end date | |
| Top blocker for next week | |
| Notes | |

## Escalation triggers

Conditions that require a decision rather than another week of the same:

| Trigger | Action |
|---|---|
| Rolling completion below 60% for three weeks | Re-plan. Either reduce MVP scope or add capacity — do not simply extend |
| The same card carried three times | It is scoped wrong or blocked on something unrecognized. Stop and decompose it |
| A gate criterion failing two weeks running | Stop the phase. Fix before proceeding |
| Critical scanner findings open beyond seven days | Stop feature work until remediated |
| Any tenant-isolation or concurrency test skipped | **Stop immediately.** These are never optional |
| Actual effort routinely exceeding planned by 50%+ | The one-day card assumption is wrong for this phase; re-scope the remaining cards |

## Monthly addendum

Once a month, add:

- **Threat model review** (`07`) — has any new trust boundary appeared?
- **Access review** — who holds which role, in the repository, cloud account, and identity provider; recorded as SOC 2 evidence (`09`)
- **Cost review** — actual AWS spend against `11`
- **Documentation drift** — do the design documents still describe what was built? Where they diverge, update the document; a design document nobody trusts is worse than none

## Quarterly addendum

- Backup restore rehearsal (once infrastructure exists)
- Full dependency audit including licenses
- Re-read `01_phasing_and_mvp_definition.md` and ask directly whether the MVP definition still matches what is being built

## Keeping it honest

The review is worth doing only if it records the uncomfortable things: the carried cards, the skipped test, the slipping date. A weekly review that always reports green is not measuring anything.

The single most useful habit is to **restate the projected end date every week from the actual completion rate**, rather than from the original plan. A schedule that updates itself weekly stays useful; one defended until it collapses does not.
