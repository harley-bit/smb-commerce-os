CREATE TABLE "deposit_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"hold_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"hold_duration_days" integer NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "deposit_consents" ADD CONSTRAINT "deposit_consents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_consents" ADD CONSTRAINT "deposit_consents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_consents" ADD CONSTRAINT "deposit_consents_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_consents" ADD CONSTRAINT "deposit_consents_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_consents_merchant_order_line_idx" ON "deposit_consents" USING btree ("merchant_id","order_line_id");