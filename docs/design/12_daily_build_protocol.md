# Daily Build Protocol

The repeatable loop that turns the calendar into code. One card per build day. Same sequence every day, so that the cadence survives interruption, context loss, and long gaps between sessions.

## The card

Every build day has one row in `implementation_calendar/build_calendar.xlsx`:

| Field | Meaning |
|---|---|
| Day ID | `D001`–`D176`, stable and never renumbered |
| Date | Computed from the Config sheet |
| Phase / Epic | Where this sits |
| Task | What gets built |
| Deliverable | The artifact that exists at the end |
| Acceptance criteria | How completion is judged — objective, not "looks right" |
| Security check | The specific security consideration for this card |
| Status | Not started / In progress / Done / Carried / Blocked |
| Actual effort | Hours |
| Notes | Decisions, surprises, blockers |

**Cards are sized to one day.** A card that cannot be finished and verified in a day was scoped wrong and gets split *before* it starts, not abandoned halfway through.

## The daily sequence

**1. Orient (5 minutes).** Pull `main`. Confirm CI is green — a red trunk is fixed before anything new is started. Read today's card: task, acceptance criteria, security check. Read yesterday's notes.

**2. Plan (10 minutes).** Write down, in the card's notes, the specific files and functions expected to change and the tests that will prove it. If this cannot be written in a few lines, the card is not understood well enough to start.

**3. Test first.** Write the failing test before the implementation. This is not negotiable for anything in `/packages/domain`, anything touching reservations, inventory, money, or authorization. For UI work, write the end-to-end assertion first where one applies.

**4. Implement.** Smallest change that makes the test pass. Resist adjacent improvements — note them in `IMPROVEMENTS.md` and move on. Unplanned refactoring is how a one-day card becomes three.

**5. Local gate.** Run before committing:

```
pnpm lint && pnpm typecheck && pnpm test && pnpm test:isolation && pnpm secrets:scan
```

Everything green locally before anything is pushed. Pushing to let CI find failures wastes the pipeline and clutters the history.

**6. Security check.** Answer the card's security question explicitly in the notes. Then, if the day's work touched any of these, run the review trigger from `10`:
- New endpoint → contract schema and authorization assertion present?
- New repository method → tenant-isolation test present?
- New data field → classified in `08`?
- New dependency → justified in the pull request?
- Payment, deposit, auth, or trust boundary touched → threat-model review recorded?

**7. Commit and open a pull request.** Conventional commits, with the day ID:

```
feat(reservations): add overlap detection for serialized units [D047]

Implements the half-open interval predicate and the SQLite
BEGIN IMMEDIATE path. Postgres exclusion constraint follows in D048.

Refs: 05_availability_inventory_and_concurrency.md
```

Complete the self-review checklist in the pull request (`10`). Merge when CI is green.

**8. Close the card (5 minutes).** Update the calendar row: status, actual effort, notes. Record any decision worth remembering as an ADR in `/docs/adr/`. If the card was carried or blocked, say why in one sentence — that sentence is what makes the weekly review useful.

## Definition of Done

Repeated from `10` because it is the point of the whole protocol:

- [ ] Acceptance criteria met
- [ ] Tests written before or alongside the code
- [ ] All CI stages green
- [ ] No new high or critical scanner findings
- [ ] Architectural decisions recorded as ADRs
- [ ] New data fields classified
- [ ] New endpoints have contract schemas and authorization checks
- [ ] New repository methods have tenant-isolation tests
- [ ] Documentation updated where behaviour changed
- [ ] Calendar row updated

## When a card cannot be finished

**Mark it Carried, not Done.** Record what remains and what blocked it. The next day's card is deferred by one; the calendar's end date moves. This is honest and it makes the schedule tell the truth.

Do not compress by skipping tests or gates. The two things that make this schedule fail are silently accumulating carried work and silently lowering the bar; the first is visible and recoverable, the second is neither.

## When blocked

Record the blocker in the card, then take the **next unblocked card from the same phase** rather than idling. If the blocker is external — a provider account, a decision from D1–D4 — raise it immediately rather than at the weekly review. Blockers left for the weekly review cost up to a week of elapsed time.

## Session start after a gap

Real work has interruptions. To resume after days or weeks away, in this order: read the last three completed cards' notes; read the current phase's gate criteria; run the full test suite to confirm the tree is healthy; then start the next card. **Do not start a new card until the suite passes** — resuming on top of an unnoticed breakage is how a day disappears.

## Working with an AI assistant

If the code is written with AI assistance, the protocol does not change but two rules are added:

1. **The card is the prompt.** Give the assistant the card's task, acceptance criteria, the relevant design document, and the existing interfaces. Vague prompts produce code that ignores the architecture.
2. **The gates are the review.** Generated code passes the same lint, type, test, isolation, and scan gates as anything else, and the tenant-isolation and concurrency suites are the ones that catch the mistakes AI most reliably makes — a repository method missing its scope predicate, or a race treated as impossible.

Never let generated code bypass a gate on the reasoning that it looks correct.

## Cadence rules

**Build days per week is a choice made once**, on the Config sheet, and honoured. Three real days a week beats five aspirational ones, because the schedule stays truthful.

**Never end a session with a red trunk.** If the day's work does not reach green, revert to the last green commit and carry the card. A broken trunk overnight costs more than a lost day.

**One card, one day, one merge.** The rhythm is the deliverable.
