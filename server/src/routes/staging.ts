import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../config/database";
import {
  stagingBins,
  stagingBinTracks,
  tracks,
} from "../db/schema";
import { JwtPayload } from "../plugins/auth";
import { getSpotifyToken } from "../utils/spotifyToken";
import { spotifyFetch } from "../services/spotifyService";

export async function stagingRoutes(app: FastifyInstance) {
  // GET /api/staging/bins — All bins for user
  app.get("/bins", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const bins = await db
      .select({
        id: stagingBins.id,
        name: stagingBins.name,
        description: stagingBins.description,
        source: stagingBins.source,
        promptText: stagingBins.promptText,
        createdAt: stagingBins.createdAt,
        updatedAt: stagingBins.updatedAt,
        trackCount: sql<number>`(
          SELECT count(*) FROM staging_bin_tracks
          WHERE staging_bin_tracks.bin_id = ${stagingBins.id}
        )`,
      })
      .from(stagingBins)
      .where(eq(stagingBins.userId, user.sub))
      .orderBy(asc(stagingBins.createdAt));

    return reply.send({ items: bins, total: bins.length });
  });

  // POST /api/staging/bins — Create manual bin
  app.post("/bins", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const schema = z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const [bin] = await db
      .insert(stagingBins)
      .values({
        userId: user.sub,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        source: "manual",
      })
      .returning();

    return reply.status(201).send(bin);
  });

  // GET /api/staging/bins/:id — Get bin with tracks
  app.get("/bins/:id", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const { id } = request.params as { id: string };

    const bin = await db.query.stagingBins.findFirst({
      where: and(eq(stagingBins.id, id), eq(stagingBins.userId, user.sub)),
    });

    if (!bin) {
      return reply.status(404).send({ error: "Bin not found" });
    }

    const binTracks = await db
      .select({
        trackId: tracks.id,
        spotifyTrackId: tracks.spotifyTrackId,
        name: tracks.name,
        artistNames: tracks.artistNames,
        albumName: tracks.albumName,
        albumArtUrl: tracks.albumArtUrl,
        durationMs: tracks.durationMs,
        previewUrl: tracks.previewUrl,
        position: stagingBinTracks.position,
      })
      .from(stagingBinTracks)
      .innerJoin(tracks, eq(stagingBinTracks.trackId, tracks.id))
      .where(eq(stagingBinTracks.binId, id))
      .orderBy(asc(stagingBinTracks.position));

    return reply.send({ ...bin, tracks: binTracks });
  });

  // PATCH /api/staging/bins/:id — Update bin
  app.patch("/bins/:id", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const { id } = request.params as { id: string };

    const schema = z.object({
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    // Verify ownership
    const existing = await db.query.stagingBins.findFirst({
      where: and(eq(stagingBins.id, id), eq(stagingBins.userId, user.sub)),
    });

    if (!existing) {
      return reply.status(404).send({ error: "Bin not found" });
    }

    const [updated] = await db
      .update(stagingBins)
      .set({
        ...parsed.data,
        updatedAt: new Date(),
      })
      .where(eq(stagingBins.id, id))
      .returning();

    return reply.send(updated);
  });

  // DELETE /api/staging/bins/:id — Delete bin
  app.delete("/bins/:id", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const { id } = request.params as { id: string };

    const existing = await db.query.stagingBins.findFirst({
      where: and(eq(stagingBins.id, id), eq(stagingBins.userId, user.sub)),
    });

    if (!existing) {
      return reply.status(404).send({ error: "Bin not found" });
    }

    await db.delete(stagingBins).where(eq(stagingBins.id, id));

    return reply.status(204).send();
  });

  // POST /api/staging/bins/:id/tracks — Add tracks to bin
  app.post("/bins/:id/tracks", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const { id } = request.params as { id: string };

    const schema = z.object({
      trackIds: z.array(z.string().uuid()).min(1).max(500),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    // Verify ownership
    const bin = await db.query.stagingBins.findFirst({
      where: and(eq(stagingBins.id, id), eq(stagingBins.userId, user.sub)),
    });

    if (!bin) {
      return reply.status(404).send({ error: "Bin not found" });
    }

    // Get current max position in this bin
    const [maxPos] = await db
      .select({ max: sql<number>`coalesce(max(${stagingBinTracks.position}), -1)` })
      .from(stagingBinTracks)
      .where(eq(stagingBinTracks.binId, id));

    let nextPosition = (maxPos?.max ?? -1) + 1;

    // Insert tracks at sequential positions
    const values = parsed.data.trackIds.map((trackId) => ({
      binId: id,
      trackId,
      position: nextPosition++,
    }));

    await db
      .insert(stagingBinTracks)
      .values(values)
      .onConflictDoNothing(); // skip duplicates

    // Update bin timestamp
    await db
      .update(stagingBins)
      .set({ updatedAt: new Date() })
      .where(eq(stagingBins.id, id));

    return reply.status(201).send({ added: parsed.data.trackIds.length });
  });

  // DELETE /api/staging/bins/:id/tracks — Remove tracks from bin
  app.delete("/bins/:id/tracks", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const { id } = request.params as { id: string };

    const schema = z.object({
      trackIds: z.array(z.string().uuid()).min(1).max(500),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    // Verify ownership
    const bin = await db.query.stagingBins.findFirst({
      where: and(eq(stagingBins.id, id), eq(stagingBins.userId, user.sub)),
    });

    if (!bin) {
      return reply.status(404).send({ error: "Bin not found" });
    }

    for (const trackId of parsed.data.trackIds) {
      await db
        .delete(stagingBinTracks)
        .where(
          and(
            eq(stagingBinTracks.binId, id),
            eq(stagingBinTracks.trackId, trackId)
          )
        );
    }

    // Update bin timestamp
    await db
      .update(stagingBins)
      .set({ updatedAt: new Date() })
      .where(eq(stagingBins.id, id));

    return reply.status(200).send({ removed: parsed.data.trackIds.length });
  });

  // PATCH /api/staging/bins/:id/reorder — Reorder tracks
  app.patch("/bins/:id/reorder", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const { id } = request.params as { id: string };

    const schema = z.object({
      // Ordered array of track IDs representing the new order
      trackIds: z.array(z.string().uuid()).min(1),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    // Verify ownership
    const bin = await db.query.stagingBins.findFirst({
      where: and(eq(stagingBins.id, id), eq(stagingBins.userId, user.sub)),
    });

    if (!bin) {
      return reply.status(404).send({ error: "Bin not found" });
    }

    // Update positions based on array order
    for (let i = 0; i < parsed.data.trackIds.length; i++) {
      await db
        .update(stagingBinTracks)
        .set({ position: i })
        .where(
          and(
            eq(stagingBinTracks.binId, id),
            eq(stagingBinTracks.trackId, parsed.data.trackIds[i])
          )
        );
    }

    // Update bin timestamp
    await db
      .update(stagingBins)
      .set({ updatedAt: new Date() })
      .where(eq(stagingBins.id, id));

    return reply.send({ reordered: parsed.data.trackIds.length });
  });

  // POST /api/staging/bins/:id/push — Push bin to Spotify as a new playlist
  app.post("/bins/:id/push", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    const { id } = request.params as { id: string };

    const bodySchema = z.object({
      playlistName: z.string().min(1).max(255).optional(),
      description: z.string().max(300).optional(),
      isPublic: z.boolean().default(false),
    });

    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    // Verify ownership and get bin
    const bin = await db.query.stagingBins.findFirst({
      where: and(eq(stagingBins.id, id), eq(stagingBins.userId, user.sub)),
    });

    if (!bin) {
      return reply.status(404).send({ error: "Bin not found" });
    }

    // Get bin tracks in order
    const binTracks = await db
      .select({
        spotifyTrackId: tracks.spotifyTrackId,
      })
      .from(stagingBinTracks)
      .innerJoin(tracks, eq(stagingBinTracks.trackId, tracks.id))
      .where(eq(stagingBinTracks.binId, id))
      .orderBy(asc(stagingBinTracks.position));

    if (binTracks.length === 0) {
      return reply.status(400).send({ error: "Bin has no tracks" });
    }

    const accessToken = await getSpotifyToken(user.sub);

    // 1. Create playlist on Spotify
    const createRes = await spotifyFetch("/me/playlists", accessToken, {
      method: "POST",
      body: JSON.stringify({
        name: parsed.data.playlistName || bin.name,
        description: parsed.data.description || bin.description || "",
        public: parsed.data.isPublic,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      return reply.status(502).send({ error: "Failed to create Spotify playlist", detail: err });
    }

    const playlist = (await createRes.json()) as {
      id: string;
      external_urls: { spotify: string };
    };

    // 2. Add tracks in batches of 100 (Spotify limit)
    const uris = binTracks.map((t) => `spotify:track:${t.spotifyTrackId}`);
    const BATCH = 100;
    let addedCount = 0;

    for (let i = 0; i < uris.length; i += BATCH) {
      const batch = uris.slice(i, i + BATCH);
      const addRes = await spotifyFetch(
        `/playlists/${playlist.id}/items`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({ uris: batch }),
        }
      );

      if (!addRes.ok) {
        const errBody = await addRes.text();
        app.log.error({ status: addRes.status, body: errBody, batch: batch.slice(0, 3) }, "Spotify add tracks failed");
        // Partial failure — playlist was created but not all tracks added
        return reply.status(207).send({
          warning: "Playlist created but some tracks failed to add",
          spotifyPlaylistId: playlist.id,
          spotifyUrl: playlist.external_urls.spotify,
          trackCount: addedCount,
          addedTracks: addedCount,
          totalTracks: uris.length,
          detail: errBody,
        });
      }
      addedCount += batch.length;
    }

    return reply.send({
      spotifyPlaylistId: playlist.id,
      spotifyUrl: playlist.external_urls.spotify,
      trackCount: uris.length,
    });
  });
}
