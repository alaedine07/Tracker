import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql, ilike, desc } from "drizzle-orm";
import { db } from "../config/database";
import {
  tracks,
  userTracks,
  playlists,
  playlistTracks,
  trackMetadata,
} from "../db/schema";
import { startLibraryScan, getScanStatus } from "../services/scanService";
import { classifyTags } from "../utils/genreNormalization";
import { JwtPayload } from "../plugins/auth";

export async function libraryRoutes(app: FastifyInstance) {
  // POST /api/library/scan — Trigger full library scan
  app.post("/scan", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const result = await startLibraryScan(user.sub);

    if (result.alreadyRunning) {
      return reply.status(409).send({
        message: "Scan already in progress",
        scanJobId: result.scanJobId,
      });
    }

    return reply.status(202).send({
      message: "Scan started",
      scanJobId: result.scanJobId,
    });
  });

  // GET /api/library/scan/status — Poll scan progress
  app.get("/scan/status", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const status = await getScanStatus(user.sub);
    return reply.send(status);
  });

  // POST /api/library/reclassify — Re-classify stored tags with updated genre/mood rules
  app.post("/reclassify", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    // Get all user tracks that have stored lastfmTags
    const rows = await db
      .select({
        metaTrackId: trackMetadata.trackId,
        lastfmTags: trackMetadata.lastfmTags,
      })
      .from(userTracks)
      .innerJoin(trackMetadata, eq(userTracks.trackId, trackMetadata.trackId))
      .where(eq(userTracks.userId, user.sub));

    let updated = 0;
    for (const row of rows) {
      if (!row.lastfmTags || !Array.isArray(row.lastfmTags)) continue;

      const tags = row.lastfmTags as { name: string; count: number }[];
      const { genres, moodTags } = classifyTags(tags);

      await db
        .update(trackMetadata)
        .set({
          genres: genres.length > 0 ? genres : null,
          moodTags: moodTags.length > 0 ? moodTags : null,
          enrichedAt: new Date(),
        })
        .where(eq(trackMetadata.trackId, row.metaTrackId));

      updated++;
    }

    console.log(`[Reclassify] Re-classified ${updated} tracks for user ${user.sub}`);
    return reply.send({ message: `Re-classified ${updated} tracks`, updated });
  });

  // GET /api/library/tracks — Paginated liked songs
  app.get("/tracks", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const querySchema = z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(50),
      search: z.string().optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters" });
    }

    const { page, limit, search } = parsed.data;
    const offset = (page - 1) * limit;

    // Build query: join userTracks → tracks
    let conditions = eq(userTracks.userId, user.sub);

    const baseQuery = db
      .select({
        id: tracks.id,
        spotifyTrackId: tracks.spotifyTrackId,
        name: tracks.name,
        artistNames: tracks.artistNames,
        albumName: tracks.albumName,
        albumArtUrl: tracks.albumArtUrl,
        durationMs: tracks.durationMs,
        previewUrl: tracks.previewUrl,
        addedAt: userTracks.addedAt,
      })
      .from(userTracks)
      .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
      .where(
        search
          ? and(conditions, ilike(tracks.name, `%${search}%`))
          : conditions
      )
      .orderBy(desc(userTracks.addedAt))
      .limit(limit)
      .offset(offset);

    const items = await baseQuery;

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userTracks)
      .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
      .where(
        search
          ? and(conditions, ilike(tracks.name, `%${search}%`))
          : conditions
      );

    const total = Number(countResult.count);

    return reply.send({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  });

  // GET /api/library/playlists — User's playlists
  app.get("/playlists", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const items = await db
      .select({
        id: playlists.id,
        spotifyPlaylistId: playlists.spotifyPlaylistId,
        name: playlists.name,
        description: playlists.description,
        trackCount: playlists.trackCount,
        imageUrl: playlists.imageUrl,
        isOwner: playlists.isOwner,
        syncedAt: playlists.syncedAt,
      })
      .from(playlists)
      .where(eq(playlists.userId, user.sub))
      .orderBy(playlists.name);

    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(${userTracks.trackId}) as integer)` })
      .from(userTracks)
      .where(eq(userTracks.userId, user.sub));

    const likedSongs = {
      id: "liked-songs",
      spotifyPlaylistId: "liked-songs",
      name: "Liked Songs",
      description: "All your saved tracks",
      trackCount: count,
      imageUrl: null,
      isOwner: true,
      syncedAt: new Date(),
    };

    return reply.send({ items: [likedSongs, ...items], total: items.length + 1 });
  });

  // GET /api/library/playlists/:id/tracks — Playlist tracks
  app.get("/playlists/:id/tracks", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtPayload;

    if (id === "liked-songs") {
      const [{ count }] = await db
        .select({ count: sql<number>`cast(count(${userTracks.trackId}) as integer)` })
        .from(userTracks)
        .where(eq(userTracks.userId, user.sub));

      const likedSongsPlaylist = {
        id: "liked-songs",
        name: "Liked Songs",
        description: "All your saved tracks",
        trackCount: count,
        imageUrl: null,
      };

      const likedItems = await db
        .select({
          id: tracks.id,
          spotifyTrackId: tracks.spotifyTrackId,
          name: tracks.name,
          artistNames: tracks.artistNames,
          albumName: tracks.albumName,
          albumArtUrl: tracks.albumArtUrl,
          durationMs: tracks.durationMs,
          previewUrl: tracks.previewUrl,
          position: sql<number>`row_number() over (order by ${userTracks.addedAt} desc)`,
        })
        .from(userTracks)
        .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
        .where(eq(userTracks.userId, user.sub))
        .orderBy(desc(userTracks.addedAt));

      return reply.send({
        playlist: likedSongsPlaylist,
        items: likedItems,
        total: likedItems.length,
      });
    }

    // Verify playlist belongs to user
    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), eq(playlists.userId, user.sub)),
    });

    if (!playlist) {
      return reply.status(404).send({ error: "Playlist not found" });
    }

    const items = await db
      .select({
        id: tracks.id,
        spotifyTrackId: tracks.spotifyTrackId,
        name: tracks.name,
        artistNames: tracks.artistNames,
        albumName: tracks.albumName,
        albumArtUrl: tracks.albumArtUrl,
        durationMs: tracks.durationMs,
        previewUrl: tracks.previewUrl,
        position: playlistTracks.position,
      })
      .from(playlistTracks)
      .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
      .where(eq(playlistTracks.playlistId, id))
      .orderBy(playlistTracks.position);

    return reply.send({
      playlist: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        trackCount: playlist.trackCount,
        imageUrl: playlist.imageUrl,
      },
      items,
      total: items.length,
    });
  });
}
