# Availability, Inventory, and Concurrency

This is the correctness core. Everything else in the system is standard CRUD; this is where a defect is visible to a customer, expensive to fix, and impossible to fix retroactively once bad data exists.

Two gates depend on this document: **G3** (no double-booking under concurrency) and **G4** (full rental lifecycle).

## The four properties

| # | Property | Failure looks like |
|---|---|---|
| C1 | Two blocking reservations for the same subject never overlap | Two customers arrive for the same kayak |
| C2 | A unit with a blocking reservation cannot be sold | A merchant sells a kayak that is out on rental |
| C3 | Stock never goes negative | A product is sold twice from one unit of stock |
| C4 | Deposit state is never ambiguous | A merchant cannot say whether a customer's money is held, returned, or taken |

C1 and C2 are the ones no competitor's architecture has to solve, because no competitor shares inventory across rental and sale.

## Interval semantics

All intervals are **half-open: `[starts_at, ends_at)`**. A reservation ending at 10:00 and one starting at 10:00 do not conflict.

Overlap predicate, used everywhere without variation:

```
existing.starts_at < new.ends_at AND existing.ends_at > new.starts_at
```

**Turnaround buffer.** Rental variants may define `buffer_minutes` — cleaning, inspection, charging. The buffer is applied by **expanding the interval at write time**, not by complicating the predicate:

```
effective_start = requested_start
effective_end   = requested_end + buffer_minutes
```

The buffer is stored on the reservation so that a later change to the variant's buffer does not retroactively alter existing bookings.

## Reservation state machine

```
            ┌──────────► EXPIRED        (hold timeout, sweeper)
            │
  HELD ─────┼──────────► CANCELLED      (customer or merchant)
   │        │
   │ payment confirmed
   ▼        │
CONFIRMED ──┼──────────► CANCELLED
   │        │
   │ PICKED_UP event (rental) / start time reached (service)
   ▼        │
 IN_USE ────┴──────────► COMPLETED      (RETURNED event / service end)
```

**Blocking states: `HELD`, `CONFIRMED`, `IN_USE`.** Only these participate in overlap checks.

Rules:
- Transitions are driven by `fulfillment_events`, never by writing `state` directly.
- `HELD` requires `expires_at`. Default 15 minutes; configurable per merchant.
- A rental cannot enter `IN_USE` without a `CHECKOUT` condition report (invariant I7).
- `COMPLETED` and `CANCELLED` are terminal.

## C1 — Preventing overlap

### PostgreSQL: make it impossible

```sql
ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    subject_type WITH =,
    subject_id   WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (state IN ('HELD','CONFIRMED','IN_USE'));
```

The database rejects the second insert. No application race is possible, including from a future service, a migration script, or a console session. **This is the target design and the reason PostgreSQL is the production database.**

### SQLite: serialize the writer

SQLite has no exclusion constraints, but it has exactly one writer:

```
BEGIN IMMEDIATE;                       -- take the write lock now, not at first write
  check overlap with the predicate above
  if conflict → ROLLBACK, return CONFLICT
  INSERT reservation
COMMIT;
```

`BEGIN IMMEDIATE` is the load-bearing detail. With a deferred transaction, two readers can both see "no conflict" and both proceed to insert. With `busy_timeout` set, a competing writer waits rather than failing immediately.

### Fungible capacity

Two cases, handled differently:

**Rental assets are always serialized** — one row per physical unit. A merchant with twelve kayaks has twelve `inventory_units`, and the reservation targets a specific one. The allocator picks a free unit at booking time. This is required for the exclusion constraint to work at all (it compares a single `subject_id`), and it is what produces per-asset utilisation data.

**Service resources may have `capacity > 1`** — a class with eight seats. An exclusion constraint cannot express "sum of overlapping quantities ≤ capacity." Handled instead by:

```sql
SELECT COALESCE(SUM(quantity), 0) FROM reservations
 WHERE subject_id = ? AND state IN ('HELD','CONFIRMED','IN_USE')
   AND starts_at < ? AND ends_at > ?
FOR UPDATE;            -- PostgreSQL: serialize on the resource row
```

In SQLite the `BEGIN IMMEDIATE` transaction already provides this. In PostgreSQL, take a `SELECT ... FOR UPDATE` lock on the `resources` row first, so concurrent bookings for the same resource serialize.

### Allocation policy

When several units could satisfy a rental request, choose deterministically: **least recently returned first**. This spreads wear evenly across the fleet and produces more even utilisation data than "lowest ID," which would hammer unit #1.

## C2 — Shared inventory across sale and rental

The invariant no competitor implements: **a unit currently out on rental cannot be sold.**

On the sale path, before recording a `SALE` movement:

```
1. Lock the inventory unit row.
2. Reject if status ∈ (SOLD, RETIRED, LOST).
3. Reject if a blocking reservation overlaps NOW.
4. If a blocking reservation exists in the FUTURE → warn, require explicit override,
   and cancel those reservations with customer notification.
5. Record SALE movement; set status = SOLD.
```

Step 4 is a deliberate product decision. Blocking a sale outright because of a booking three weeks out is too rigid; silently selling an asset a customer has reserved is unacceptable. The override is logged to `audit_log`.

The reverse check applies on the reservation path: a unit with `status = SOLD` or `RETIRED` cannot be reserved (invariant I4).

## C3 — Stock never goes negative

Product stock is the sum of an append-only movement ledger, never a mutable counter.

```
BEGIN IMMEDIATE / SELECT ... FOR UPDATE on the variant
  available = SUM(movements.quantity) for (variant, location)
  if available < requested → ROLLBACK, return INSUFFICIENT_STOCK
  INSERT movement (kind = SALE, quantity = -requested)
COMMIT;
```

A ledger is chosen over a counter because it is auditable — every change has a reason, an actor, and a timestamp — and because a counter that drifts cannot be reconstructed. If summation becomes a performance problem, add a snapshot table; the ledger stays authoritative.

## C4 — The deposit state machine

```
  (none) ──authorize──► AUTHORIZED ──┬──release──► RELEASED
                             │       │
                             │       ├──capture full──► CAPTURED
                             │       │
                             │       └──capture part──► PARTIALLY_CAPTURED
                             │
                             └──window elapsed──► EXPIRED
```

Rules that are not negotiable:

- **`expires_at` is mandatory** and comes from the provider's authorization window.
- **One capture attempt.** Most cards permit only one capture against an authorization; a partial capture releases the remainder irreversibly. The claim amount must therefore be correct the first time, which forces a merchant review step before capture.
- **The 30-day ceiling is a product constraint.** Standard authorization holds release after ~7 days; lodging and vehicle-rental MCCs reach 30–31 days. **Rentals longer than the provider's window cannot rely on a hold** and require a captured deposit or a contractual claims process. Surface this in the merchant UI when a rental period is configured beyond the ceiling — do not discover it in production.
- **A scheduled job releases holds** whose rental has completed with no claim filed, before expiry. Never let a hold silently expire on a customer's card; release it deliberately and notify.
- Every transition writes to `audit_log`.

## Hold expiry and the sweeper

Two mechanisms, both required:

**Lazy:** every overlap query filters on `state IN ('HELD','CONFIRMED','IN_USE')` **and** `(state != 'HELD' OR expires_at > now())`. An expired hold never blocks, even if the sweeper has not run.

**Active:** a scheduled job transitions expired holds to `EXPIRED` and releases any associated authorization. Runs every minute; idempotent; must be safe to run concurrently with itself.

Belt and braces, deliberately. The lazy filter guarantees correctness; the sweeper keeps the data clean and releases customers' money promptly.

## Late returns

A rental whose `ends_at` has passed with no `RETURNED` event is **overdue**. The system does not auto-cancel and does not auto-charge.

```
1. Mark the reservation overdue (derived, not a stored state).
2. Notify merchant and customer.
3. Detect downstream conflicts — reservations on the same unit starting soon.
4. Alert the merchant with a specific list of affected bookings and contact details.
5. Apply late fees per the variant's policy, on merchant confirmation.
```

Step 3 is the one a naive implementation misses. A late return is not just a billing event; it is a **future double-booking that has already happened**, and the merchant needs to know which customer to call.

## Test plan

These tests define the gates and must exist before the code they cover.

| Test | Asserts | Gate |
|---|---|---|
| Concurrent identical reservations, N=50 parallel | Exactly one succeeds, on both dialects | **G3** |
| Adjacent intervals `[9,10)` and `[10,11)` | Both succeed — no false conflict | G3 |
| Overlapping by one second | Second rejected | G3 |
| Buffer expansion creates a conflict | Second rejected | G4 |
| Sell a unit reserved now | Rejected | G4 |
| Sell a unit reserved in future without override | Rejected; with override, succeeds and cancels | G4 |
| Reserve a `SOLD` unit | Rejected | G4 |
| Concurrent stock decrement to zero, N=50 | Never negative; exact number succeed | G2 |
| Capacity-3 resource, 5 concurrent bookings | Exactly 3 succeed | G3 |
| Expired hold does not block | New reservation succeeds before sweeper runs | G3 |
| Deposit double-capture | Second attempt rejected | G5 |
| Rental to `IN_USE` without checkout report | Rejected | G4 |
| Late return with a following booking | Conflict alert raised naming the affected booking | G4 |

Concurrency tests run real parallel transactions, not sequential calls with mocked timing. A concurrency test that does not actually run concurrently proves nothing.
