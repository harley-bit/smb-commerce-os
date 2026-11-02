-- docs/design/05 "Fungible capacity" / docs/cards/D054.md — the exclusion
-- constraint added in 0010 is a binary any-overlap-blocks check. That is
-- correct for INVENTORY_UNIT subjects (rental assets are always serialized,
-- one row per physical unit, capacity is implicitly 1) but wrong for
-- RESOURCE subjects with capacity > 1 (a class with several seats): an
-- exclusion constraint cannot express "sum of overlapping quantities <=
-- capacity", so as originally written it would incorrectly reject a
-- perfectly valid concurrent booking within capacity. Narrow the
-- constraint's WHERE clause to INVENTORY_UNIT only; RESOURCE subjects are
-- now guarded exclusively by the application-level capacity-checked write
-- path (SELECT ... FOR UPDATE on the resources row, see
-- PgReservationRepository.createGuarded).
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_no_overlap";
--> statement-breakpoint
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist (
    "subject_type" WITH =,
    "subject_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("state" IN ('HELD', 'CONFIRMED', 'IN_USE') AND "subject_type" = 'INVENTORY_UNIT');
