CREATE TABLE "deposit_authorizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"state" text NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"captured_minor" integer,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"raw_event_json" text
);
--> statement-breakpoint
ALTER TABLE "deposit_authorizations" ADD CONSTRAINT "deposit_authorizations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_authorizations" ADD CONSTRAINT "deposit_authorizations_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_authorizations" ADD CONSTRAINT "deposit_authorizations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_provider_ref_unique" ON "payments" USING btree ("provider","provider_ref");