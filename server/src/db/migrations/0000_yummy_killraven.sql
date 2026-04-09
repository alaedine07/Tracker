CREATE TABLE "playlist_tracks" (
	"playlist_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "playlist_tracks_playlist_id_track_id_pk" PRIMARY KEY("playlist_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"spotify_playlist_id" varchar(255) NOT NULL,
	"name" varchar(500) NOT NULL,
	"description" text,
	"track_count" integer DEFAULT 0,
	"image_url" text,
	"is_owner" boolean DEFAULT true,
	"snapshot_id" varchar(255),
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scan_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"total_tracks" integer DEFAULT 0,
	"processed_tracks" integer DEFAULT 0,
	"current_phase" varchar(50),
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "staging_bin_tracks" (
	"bin_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "staging_bin_tracks_bin_id_track_id_pk" PRIMARY KEY("bin_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "staging_bins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"source" varchar(50) NOT NULL,
	"prompt_text" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "track_metadata" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"lastfm_tags" jsonb,
	"genres" text[],
	"mood_tags" text[],
	"bpm_estimate" integer,
	"energy_estimate" real,
	"enriched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spotify_track_id" varchar(255) NOT NULL,
	"name" varchar(500) NOT NULL,
	"artist_names" text[] NOT NULL,
	"artist_ids" text[] NOT NULL,
	"album_name" varchar(500),
	"album_art_url" text,
	"duration_ms" integer,
	"preview_url" text,
	"isrc" varchar(20),
	"popularity" integer,
	"explicit" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_tracks" (
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"added_at" timestamp with time zone,
	CONSTRAINT "user_tracks_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spotify_id" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"email" varchar(255),
	"country" varchar(10),
	"product" varchar(50),
	"avatar_url" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_spotify_id_unique" UNIQUE("spotify_id")
);
--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_bin_tracks" ADD CONSTRAINT "staging_bin_tracks_bin_id_staging_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."staging_bins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_bin_tracks" ADD CONSTRAINT "staging_bin_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_bins" ADD CONSTRAINT "staging_bins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_metadata" ADD CONSTRAINT "track_metadata_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tracks" ADD CONSTRAINT "user_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tracks" ADD CONSTRAINT "user_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_playlists_user_spotify" ON "playlists" USING btree ("user_id","spotify_playlist_id");--> statement-breakpoint
CREATE INDEX "idx_playlists_user" ON "playlists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_scan_jobs_user_status" ON "scan_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_staging_bins_user" ON "staging_bins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_track_metadata_genres" ON "track_metadata" USING gin ("genres");--> statement-breakpoint
CREATE INDEX "idx_track_metadata_mood" ON "track_metadata" USING gin ("mood_tags");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracks_spotify_id" ON "tracks" USING btree ("spotify_track_id");--> statement-breakpoint
CREATE INDEX "idx_user_tracks_user" ON "user_tracks" USING btree ("user_id");