CREATE TABLE "listing_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"attributes_json" text,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"duration_minutes" integer,
	"rate_period" text,
	"deposit_minor" integer,
	"archived_at" timestamp with time zone,
	CONSTRAINT "listing_variants_mode_fields_check" CHECK ((
        ("listing_variants"."mode" = 'PRODUCT' AND "listing_variants"."duration_minutes" IS NULL AND "listing_variants"."rate_period" IS NULL AND "listing_variants"."deposit_minor" IS NULL)
        OR ("listing_variants"."mode" = 'SERVICE' AND "listing_variants"."rate_period" IS NULL AND "listing_variants"."deposit_minor" IS NULL)
        OR ("listing_variants"."mode" = 'RENTAL' AND "listing_variants"."duration_minutes" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "listing_variants" ADD CONSTRAINT "listing_variants_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_variants" ADD CONSTRAINT "listing_variants_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_merchant_slug_unique" ON "listings" USING btree ("merchant_id","slug");