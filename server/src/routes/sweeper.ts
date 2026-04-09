import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../config/database";
import {
  tracks,
  userTracks,
  playlists,
  playlistTracks,
} from "../db/schema";
import { JwtPayload } from "../plugins/auth";
import { getSpotifyToken } from "../utils/spotifyToken";
import { spotifyFetch } from "../services/spotifyService";

// ──── Detection Logic ────

interface UnavailableTrack {
  trackId: string;
  spotifyTrackId: string;
  name: string;
  artistNames: string[];
  albumName: string | null;
  reason: string;
}

interface DuplicateGroup {
  isrc: string | null;
  name: string;
  artistNames: string[];
  tracks: {
    trackId: string;
    spotifyTrackId: string;
    name: string;
    albumName: string | null;
    foundIn: string[]; // "Liked Songs" or playlist names
  }[];
}

/**
 * Detect tracks that are unavailable (region-locked, removed, etc.)
 * by checking against Spotify's /tracks endpoint in batches.
 */
async function detectUnavailableTracks(
  userId: string
): Promise<UnavailableTrack[]> {
  // Get all user's liked track spotify IDs
  const userTrackRows = await db
    .select({
      trackId: tracks.id,
      spotifyTrackId: tracks.spotifyTrackId,
      name: tracks.name,
      artistNames: tracks.artistNames,
      albumName: tracks.albumName,
    })
    .from(userTracks)
    .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
    .where(eq(userTracks.userId, userId));

  if (userTrackRows.length === 0) return [];

  const unavailable: UnavailableTrack[] = [];
  const accessToken = await getSpotifyToken(userId);

  // Spotify /tracks endpoint accepts max 50 IDs at a time
  const BATCH_SIZE = 50;
  for (let i = 0; i < userTrackRows.length; i += BATCH_SIZE) {
    const batch = userTrackRows.slice(i, i + BATCH_SIZE);
    const spotifyIds = batch.map((t) => t.spotifyTrackId).join(",");

    const res = await spotifyFetch(
      `/tracks?ids=${spotifyIds}&market=from_token`,
      accessToken
    );

    if (!res.ok) continue;

    const data = (await res.json()) as {
      tracks: (
        | { id: string; is_playable?: boolean; restrictions?: { reason: string } }
        | null
      )[];
    };

    for (let j = 0; j < data.tracks.length; j++) {
      const spotifyTrack = data.tracks[j];
      const localTrack = batch[j];

      if (!spotifyTrack) {
        // Track was deleted from Spotify entirely
        unavailable.push({
          ...localTrack,
          reason: "Track removed from Spotify",
        });
      } else if (spotifyTrack.is_playable === false) {
        unavailable.push({
          ...localTrack,
          reason: spotifyTrack.restrictions?.reason || "Not available in your market",
        });
      }
    }
  }

  return unavailable;
}

/**
 * Detect duplicate tracks in the user's library.
 * Strategy 1: Same ISRC across different Spotify track IDs
 * Strategy 2: Tracks appearing in multiple playlists
 */
async function detectDuplicates(userId: string): Promise<DuplicateGroup[]> {
  const groups: DuplicateGroup[] = [];

  // Strategy 1: Duplicate ISRCs in liked songs (different releases of same recording)
  const isrcDupes = await db
    .select({
      isrc: tracks.isrc,
      count: sql<number>`count(*)`,
    })
    .from(userTracks)
    .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
    .where(
      and(
        eq(userTracks.userId, userId),
        sql`${tracks.isrc} IS NOT NULL AND ${tracks.isrc} != ''`
      )
    )
    .groupBy(tracks.isrc)
    .having(sql`count(*) > 1`);

  for (const dupe of isrcDupes) {
    if (!dupe.isrc) continue;

    const dupeTracks = await db
      .select({
        trackId: tracks.id,
        spotifyTrackId: tracks.spotifyTrackId,
        name: tracks.name,
        artistNames: tracks.artistNames,
        albumName: tracks.albumName,
      })
      .from(userTracks)
      .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
      .where(
        and(eq(userTracks.userId, userId), eq(tracks.isrc, dupe.isrc))
      );

    if (dupeTracks.length > 1) {
      groups.push({
        isrc: dupe.isrc,
        name: dupeTracks[0].name,
        artistNames: dupeTracks[0].artistNames,
        tracks: dupeTracks.map((t) => ({
          trackId: t.trackId,
          spotifyTrackId: t.spotifyTrackId,
          name: t.name,
          albumName: t.albumName,
          foundIn: ["Liked Songs"],
        })),
      });
    }
  }

  // Strategy 2: Tracks appearing in multiple user playlists
  const userPlaylists = await db
    .select({ id: playlists.id, name: playlists.name })
    .from(playlists)
    .where(eq(playlists.userId, userId));

  if (userPlaylists.length > 1) {
    const playlistIds = userPlaylists.map((p) => p.id);
    const playlistNameMap = new Map(userPlaylists.map((p) => [p.id, p.name]));

    const multiPlaylistTracks = await db
      .select({
        trackId: playlistTracks.trackId,
        playlistCount: sql<number>`count(distinct ${playlistTracks.playlistId})`,
      })
      .from(playlistTracks)
      .where(inArray(playlistTracks.playlistId, playlistIds))
      .groupBy(playlistTracks.trackId)
      .having(sql`count(distinct ${playlistTracks.playlistId}) > 1`);

    for (const mpt of multiPlaylistTracks) {
      // Get track details and which playlists it's in
      const trackDetail = await db.query.tracks.findFirst({
        where: eq(tracks.id, mpt.trackId),
      });

      if (!trackDetail) continue;

      const inPlaylists = await db
        .select({ playlistId: playlistTracks.playlistId })
        .from(playlistTracks)
        .where(
          and(
            eq(playlistTracks.trackId, mpt.trackId),
            inArray(playlistTracks.playlistId, playlistIds)
          )
        );

      const foundInNames = inPlaylists
        .map((p) => playlistNameMap.get(p.playlistId) ?? "Unknown")
        .filter(Boolean);

      // Only add if not already covered by ISRC duplicate
      const alreadyGrouped = groups.some((g) =>
        g.tracks.some((t) => t.trackId === mpt.trackId)
      );

      if (!alreadyGrouped) {
        groups.push({
          isrc: trackDetail.isrc,
          name: trackDetail.name,
          artistNames: trackDetail.artistNames,
          tracks: [
            {
              trackId: trackDetail.id,
              spotifyTrackId: trackDetail.spotifyTrackId,
              name: trackDetail.name,
              albumName: trackDetail.albumName,
              foundIn: foundInNames,
            },
          ],
        });
      }
    }
  }

  return groups;
}

// ──── Routes ────

export async function sweeperRoutes(app: FastifyInstance) {
  // POST /api/sweeper/scan — Run sweeper analysis
  app.post("/scan", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const [unavailable, duplicates] = await Promise.all([
      detectUnavailableTracks(user.sub),
      detectDuplicates(user.sub),
    ]);

    return reply.send({
      unavailable: {
        count: unavailable.length,
        tracks: unavailable,
      },
      duplicates: {
        count: duplicates.length,
        groups: duplicates,
      },
      scannedAt: new Date().toISOString(),
    });
  });

  // GET /api/sweeper/results — Alias for scan (cached results could be added later)
  app.get("/results", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const [unavailable, duplicates] = await Promise.all([
      detectUnavailableTracks(user.sub),
      detectDuplicates(user.sub),
    ]);

    return reply.send({
      unavailable: {
        count: unavailable.length,
        tracks: unavailable,
      },
      duplicates: {
        count: duplicates.length,
        groups: duplicates,
      },
      scannedAt: new Date().toISOString(),
    });
  });

  // POST /api/sweeper/clean — Remove tracks from Spotify library/playlists
  app.post("/clean", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const schema = z.object({
      trackIds: z.array(z.string()).min(1).max(100),
      // Which Spotify track IDs to remove
      removeFrom: z.enum(["liked", "all"]).default("liked"),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { trackIds, removeFrom } = parsed.data;
    const accessToken = await getSpotifyToken(user.sub);

    // Look up spotify track IDs from our internal IDs
    const trackRows = await db
      .select({ id: tracks.id, spotifyTrackId: tracks.spotifyTrackId })
      .from(tracks)
      .where(inArray(tracks.id, trackIds));

    const spotifyTrackIds = trackRows.map((t) => t.spotifyTrackId);

    if (spotifyTrackIds.length === 0) {
      return reply.status(400).send({ error: "No valid tracks found" });
    }

    const results: { removed: number; errors: string[] } = { removed: 0, errors: [] };

    // Remove from liked songs — Spotify accepts max 50 at a time
    const BATCH = 50;
    for (let i = 0; i < spotifyTrackIds.length; i += BATCH) {
      const batch = spotifyTrackIds.slice(i, i + BATCH);
      const res = await spotifyFetch("/me/tracks", accessToken, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch }),
      });

      if (res.ok) {
        results.removed += batch.length;
      } else {
        results.errors.push(`Failed to remove batch starting at index ${i}`);
      }
    }

    // Also remove from our DB tracking
    const internalIds = trackRows.map((t) => t.id);
    for (const trackId of internalIds) {
      await db
        .delete(userTracks)
        .where(
          and(eq(userTracks.userId, user.sub), eq(userTracks.trackId, trackId))
        );
    }

    return reply.send(results);
  });
}
