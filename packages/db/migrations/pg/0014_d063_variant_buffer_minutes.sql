ALTER TABLE "listing_variants" DROP CONSTRAINT "listing_variants_mode_fields_check";--> statement-breakpoint
ALTER TABLE "listing_variants" ADD COLUMN "buffer_minutes" integer;--> statement-breakpoint
ALTER TABLE "listing_variants" ADD CONSTRAINT "listing_variants_mode_fields_check" CHECK ((
        ("listing_variants"."mode" = 'PRODUCT' AND "listing_variants"."duration_minutes" IS NULL AND "listing_variants"."rate_period" IS NULL AND "listing_variants"."deposit_minor" IS NULL AND "listing_variants"."buffer_minutes" IS NULL)
        OR ("listing_variants"."mode" = 'SERVICE' AND "listing_variants"."rate_period" IS NULL AND "listing_variants"."deposit_minor" IS NULL AND "listing_variants"."buffer_minutes" IS NULL)
        OR ("listing_variants"."mode" = 'RENTAL' AND "listing_variants"."duration_minutes" IS NULL)
      ));