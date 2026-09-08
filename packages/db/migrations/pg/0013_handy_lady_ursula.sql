ALTER TABLE "reservations" ADD COLUMN "created_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "created_by_ip" text;--> statement-breakpoint
CREATE INDEX "reservations_holder_account_idx" ON "reservations" USING btree ("merchant_id","state","created_by_account_id");--> statement-breakpoint
CREATE INDEX "reservations_holder_ip_idx" ON "reservations" USING btree ("merchant_id","state","created_by_ip");