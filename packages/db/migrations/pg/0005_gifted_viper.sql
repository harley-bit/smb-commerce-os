CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_line_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"quantity" integer NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_subject_interval_idx" ON "reservations" USING btree ("merchant_id","subject_type","subject_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "reservations_state_expires_idx" ON "reservations" USING btree ("state","expires_at");