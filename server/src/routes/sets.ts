import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../config/database";
import {
  playlists,
  playlistTracks,
  userTracks,
  tracks,
  stagingBins,
  stagingBinTracks,
} from "../db/schema";
import { JwtPayload } from "../plugins/auth";

// ──── Set Operation Logic ────

/**
 * Get track IDs for a source (playlist or liked songs).
 * sourceId = "liked" for liked songs, otherwise a playlist UUID.
 */
async function getTrackIdsForSource(
  userId: string,
  sourceId: string
): Promise<Set<string>> {
  if (sourceId === "liked") {
    const rows = await db
      .select({ trackId: userTracks.trackId })
      .from(userTracks)
      .where(eq(userTracks.userId, userId));
    return new Set(rows.map((r) => r.trackId));
  }

  // Verify playlist belongs to user
  const playlist = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, sourceId), eq(playlists.userId, userId)),
  });

  if (!playlist) {
    throw new Error(`Playlist not found: ${sourceId}`);
  }

  const rows = await db
    .select({ trackId: playlistTracks.trackId })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, sourceId));

  return new Set(rows.map((r) => r.trackId));
}

function setUnion(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a, ...b]);
}

function setIntersection(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const id of a) {
    if (b.has(id)) result.add(id);
  }
  return result;
}

function setDifference(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const id of a) {
    if (!b.has(id)) result.add(id);
  }
  return result;
}

// ──── Schema ────

const setOperationSchema = z.object({
  sourceA: z.string().min(1), // playlist UUID or "liked"
  sourceB: z.string().min(1), // playlist UUID or "liked"
  createBin: z.boolean().default(false), // optionally create a staging bin with results
  binName: z.string().max(255).optional(),
});

// ──── Shared handler ────

async function handleSetOperation(
  user: JwtPayload,
  body: unknown,
  operation: "union" | "intersection" | "difference",
  reply: any
) {
  const parsed = setOperationSchema.safeParse(body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const { sourceA, sourceB, createBin, binName } = parsed.data;

  let setA: Set<string>;
  let setB: Set<string>;
  try {
    [setA, setB] = await Promise.all([
      getTrackIdsForSource(user.sub, sourceA),
      getTrackIdsForSource(user.sub, sourceB),
    ]);
  } catch (err: any) {
    return reply.status(404).send({ error: err.message });
  }

  let resultIds: Set<string>;
  switch (operation) {
    case "union":
      resultIds = setUnion(setA, setB);
      break;
    case "intersection":
      resultIds = setIntersection(setA, setB);
      break;
    case "difference":
      resultIds = setDifference(setA, setB);
      break;
  }

  const trackIdArray = [...resultIds];

  // Fetch full track details for the result
  let resultTracks: any[] = [];
  if (trackIdArray.length > 0) {
    resultTracks = await db
      .select({
        id: tracks.id,
        spotifyTrackId: tracks.spotifyTrackId,
        name: tracks.name,
        artistNames: tracks.artistNames,
        albumName: tracks.albumName,
        albumArtUrl: tracks.albumArtUrl,
        durationMs: tracks.durationMs,
        previewUrl: tracks.previewUrl,
      })
      .from(tracks)
      .where(inArray(tracks.id, trackIdArray));
  }

  // Optionally create a staging bin with the result
  let bin = null;
  if (createBin && trackIdArray.length > 0) {
    const defaultName = `${operation.charAt(0).toUpperCase() + operation.slice(1)} result`;
    const [newBin] = await db
      .insert(stagingBins)
      .values({
        userId: user.sub,
        name: binName || defaultName,
        source: "set-operation",
        description: `${operation} of ${sourceA === "liked" ? "Liked Songs" : sourceA} and ${sourceB === "liked" ? "Liked Songs" : sourceB}`,
      })
      .returning();

    // Add tracks to bin
    const binTrackValues = trackIdArray.map((trackId, i) => ({
      binId: newBin.id,
      trackId,
      position: i,
    }));

    await db.insert(stagingBinTracks).values(binTrackValues).onConflictDoNothing();

    bin = newBin;
  }

  return reply.send({
    operation,
    sourceA,
    sourceB,
    trackCount: resultTracks.length,
    tracks: resultTracks,
    bin,
  });
}

// ──── Routes ────

export async function setsRoutes(app: FastifyInstance) {
  // POST /api/sets/union
  app.post("/union", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    return handleSetOperation(user, request.body, "union", reply);
  });

  // POST /api/sets/intersection
  app.post("/intersection", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    return handleSetOperation(user, request.body, "intersection", reply);
  });

  // POST /api/sets/difference
  app.post("/difference", async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    return handleSetOperation(user, request.body, "difference", reply);
  });
}
