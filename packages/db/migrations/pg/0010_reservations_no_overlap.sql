-- docs/design/05 C1 — make double-booking impossible at the database level,
-- not just in application code. btree_gist is required because the gist
-- index below needs an equality operator class for subject_type/subject_id
-- (plain btree types), alongside the native range-overlap operator class
-- for tstzrange. The WHERE clause limits the constraint to the blocking
-- states (HELD, CONFIRMED, IN_USE) — see docs/design/05's reservation state
-- machine; COMPLETED/CANCELLED/EXPIRED reservations never conflict.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist (
    "subject_type" WITH =,
    "subject_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("state" IN ('HELD', 'CONFIRMED', 'IN_USE'));
