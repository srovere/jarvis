CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton_ck" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "calendars_busy" text[] DEFAULT '{primary}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "missing_scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "created_via" text DEFAULT 'config' NOT NULL;