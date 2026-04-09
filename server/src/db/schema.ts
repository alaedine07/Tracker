import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
  real,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ──── Users ────

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  spotifyId: varchar("spotify_id", { length: 255 }).unique().notNull(),
  displayName: varchar("display_name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  country: varchar("country", { length: 10 }),
  product: varchar("product", { length: 50 }),
  avatarUrl: text("avatar_url"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ──── Tracks ────

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    spotifyTrackId: varchar("spotify_track_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    artistNames: text("artist_names").array().notNull(),
    artistIds: text("artist_ids").array().notNull(),
    albumName: varchar("album_name", { length: 500 }),
    albumArtUrl: text("album_art_url"),
    durationMs: integer("duration_ms"),
    previewUrl: text("preview_url"),
    isrc: varchar("isrc", { length: 20 }),
    popularity: integer("popularity"),
    explicit: boolean("explicit").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_tracks_spotify_id").on(table.spotifyTrackId),
  ]
);

// ──── User Tracks (junction) ────

export const userTracks = pgTable(
  "user_tracks",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    trackId: uuid("track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.trackId] }),
    index("idx_user_tracks_user").on(table.userId),
  ]
);

// ──── Track Metadata (enriched) ────

export const trackMetadata = pgTable(
  "track_metadata",
  {
    trackId: uuid("track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .primaryKey(),
    lastfmTags: jsonb("lastfm_tags"),
    genres: text("genres").array(),
    moodTags: text("mood_tags").array(),
    bpmEstimate: integer("bpm_estimate"),
    energyEstimate: real("energy_estimate"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_track_metadata_genres").using("gin", table.genres),
    index("idx_track_metadata_mood").using("gin", table.moodTags),
  ]
);

// ──── Playlists ────

export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    spotifyPlaylistId: varchar("spotify_playlist_id", {
      length: 255,
    }).notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    description: text("description"),
    trackCount: integer("track_count").default(0),
    imageUrl: text("image_url"),
    isOwner: boolean("is_owner").default(true),
    snapshotId: varchar("snapshot_id", { length: 255 }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_playlists_user_spotify").on(
      table.userId,
      table.spotifyPlaylistId
    ),
    index("idx_playlists_user").on(table.userId),
  ]
);

// ──── Playlist Tracks (junction) ────

export const playlistTracks = pgTable(
  "playlist_tracks",
  {
    playlistId: uuid("playlist_id")
      .references(() => playlists.id, { onDelete: "cascade" })
      .notNull(),
    trackId: uuid("track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.playlistId, table.trackId] }),
  ]
);

// ──── Staging Bins ────

export const stagingBins = pgTable(
  "staging_bins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    source: varchar("source", { length: 50 }).notNull(),
    promptText: text("prompt_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_staging_bins_user").on(table.userId)]
);

// ──── Staging Bin Tracks ────

export const stagingBinTracks = pgTable(
  "staging_bin_tracks",
  {
    binId: uuid("bin_id")
      .references(() => stagingBins.id, { onDelete: "cascade" })
      .notNull(),
    trackId: uuid("track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.binId, table.trackId] }),
  ]
);

// ──── Scan Jobs ────

export const scanJobs = pgTable(
  "scan_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    totalTracks: integer("total_tracks").default(0),
    processedTracks: integer("processed_tracks").default(0),
    currentPhase: varchar("current_phase", { length: 50 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_scan_jobs_user_status").on(table.userId, table.status),
  ]
);

// ──── Relations (for Drizzle query builder) ────

export const usersRelations = relations(users, ({ many }) => ({
  userTracks: many(userTracks),
  playlists: many(playlists),
  stagingBins: many(stagingBins),
  scanJobs: many(scanJobs),
}));

export const tracksRelations = relations(tracks, ({ one, many }) => ({
  metadata: one(trackMetadata, {
    fields: [tracks.id],
    references: [trackMetadata.trackId],
  }),
  userTracks: many(userTracks),
  playlistTracks: many(playlistTracks),
  stagingBinTracks: many(stagingBinTracks),
}));

export const userTracksRelations = relations(userTracks, ({ one }) => ({
  user: one(users, { fields: [userTracks.userId], references: [users.id] }),
  track: one(tracks, { fields: [userTracks.trackId], references: [tracks.id] }),
}));

export const trackMetadataRelations = relations(trackMetadata, ({ one }) => ({
  track: one(tracks, { fields: [trackMetadata.trackId], references: [tracks.id] }),
}));

export const playlistsRelations = relations(playlists, ({ one, many }) => ({
  user: one(users, { fields: [playlists.userId], references: [users.id] }),
  playlistTracks: many(playlistTracks),
}));

export const playlistTracksRelations = relations(playlistTracks, ({ one }) => ({
  playlist: one(playlists, { fields: [playlistTracks.playlistId], references: [playlists.id] }),
  track: one(tracks, { fields: [playlistTracks.trackId], references: [tracks.id] }),
}));

export const stagingBinsRelations = relations(stagingBins, ({ one, many }) => ({
  user: one(users, { fields: [stagingBins.userId], references: [users.id] }),
  binTracks: many(stagingBinTracks),
}));

export const stagingBinTracksRelations = relations(stagingBinTracks, ({ one }) => ({
  bin: one(stagingBins, { fields: [stagingBinTracks.binId], references: [stagingBins.id] }),
  track: one(tracks, { fields: [stagingBinTracks.trackId], references: [tracks.id] }),
}));

export const scanJobsRelations = relations(scanJobs, ({ one }) => ({
  user: one(users, { fields: [scanJobs.userId], references: [users.id] }),
}));
