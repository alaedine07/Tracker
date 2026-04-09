import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { db } from "../config/database";
import {
  tracks,
  userTracks,
  trackMetadata,
  stagingBins,
  stagingBinTracks,
} from "../db/schema";
import { JwtPayload } from "../plugins/auth";
import { chatCompletion, parseLLMJson } from "../services/aiService";
import { searchTrack, SpotifySearchTrack } from "../services/spotifyService";
import { getSpotifyToken } from "../utils/spotifyToken";

// ──── Types ────

interface EnrichedTrackSummary {
  trackId: string;
  spotifyTrackId: string;
  name: string;
  artistNames: string[];
  genres: string[];
  moodTags: string[];
  popularity: number;
}

/**
 * Get all enriched tracks for a user (those with metadata genres/moods)
 */
async function getUserEnrichedTracks(userId: string): Promise<EnrichedTrackSummary[]> {
  const rows = await db
    .select({
      trackId: tracks.id,
      spotifyTrackId: tracks.spotifyTrackId,
      name: tracks.name,
      artistNames: tracks.artistNames,
      popularity: tracks.popularity,
      genres: trackMetadata.genres,
      moodTags: trackMetadata.moodTags,
    })
    .from(userTracks)
    .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
    .innerJoin(trackMetadata, eq(tracks.id, trackMetadata.trackId))
    .where(
      and(
        eq(userTracks.userId, userId),
        // Only tracks that have at least some metadata
        sql`(${trackMetadata.genres} IS NOT NULL OR ${trackMetadata.moodTags} IS NOT NULL)`
      )
    );

  return rows.map((r) => ({
    trackId: r.trackId,
    spotifyTrackId: r.spotifyTrackId,
    name: r.name,
    artistNames: r.artistNames,
    genres: r.genres ?? [],
    moodTags: r.moodTags ?? [],
    popularity: r.popularity ?? 0,
  }));
}

/**
 * Build a compact text summary of user's tracks for the LLM prompt
 */
function buildTrackSummary(tracks: EnrichedTrackSummary[]): string {
  return tracks
    .map(
      (t, i) =>
        `[${i}] "${t.name}" by ${t.artistNames.join(", ")} | genres: ${t.genres.join(", ") || "unknown"} | mood: ${t.moodTags.join(", ") || "unknown"}`
    )
    .join("\n");
}

/**
 * Create a staging bin from LLM-selected track indices
 */
async function createBinFromSelection(
  userId: string,
  binName: string,
  description: string | null,
  source: string,
  promptText: string | null,
  allTracks: EnrichedTrackSummary[],
  selectedIndices: number[],
  extraTrackIds: string[] = []
): Promise<any> {
  // Filter valid indices
  const validIndices = selectedIndices.filter(
    (i) => i >= 0 && i < allTracks.length
  );

  if (validIndices.length === 0 && extraTrackIds.length === 0) return null;

  const [bin] = await db
    .insert(stagingBins)
    .values({
      userId,
      name: binName,
      description,
      source,
      promptText,
    })
    .returning();

  const binTrackValues = validIndices.map((idx, position) => ({
    binId: bin.id,
    trackId: allTracks[idx].trackId,
    position,
  }));

  // Append discovery tracks after library tracks
  const offset = binTrackValues.length;
  const extraValues = extraTrackIds.map((trackId, i) => ({
    binId: bin.id,
    trackId,
    position: offset + i,
  }));

  const allValues = [...binTrackValues, ...extraValues];
  if (allValues.length > 0) {
    await db.insert(stagingBinTracks).values(allValues).onConflictDoNothing();
  }

  return { ...bin, trackCount: allValues.length };
}

/**
 * Upsert a Spotify track found via search into the tracks table.
 * Returns the internal UUID.
 */
async function upsertDiscoveryTrack(t: SpotifySearchTrack): Promise<string> {
  const existing = await db.query.tracks.findFirst({
    where: eq(tracks.spotifyTrackId, t.id),
  });
  if (existing) return existing.id;

  const [inserted] = await db
    .insert(tracks)
    .values({
      spotifyTrackId: t.id,
      name: t.name,
      artistNames: t.artists.map((a) => a.name),
      artistIds: t.artists.map((a) => a.id),
      albumName: t.album?.name ?? null,
      albumArtUrl: t.album?.images?.[0]?.url ?? null,
      durationMs: t.duration_ms,
      previewUrl: t.preview_url,
      isrc: t.external_ids?.isrc ?? null,
      popularity: t.popularity,
      explicit: t.explicit,
    })
    .onConflictDoUpdate({
      target: tracks.spotifyTrackId,
      set: {
        name: t.name,
        artistNames: t.artists.map((a) => a.name),
        artistIds: t.artists.map((a) => a.id),
        albumName: t.album?.name ?? null,
        albumArtUrl: t.album?.images?.[0]?.url ?? null,
        durationMs: t.duration_ms,
        previewUrl: t.preview_url,
        popularity: t.popularity,
      },
    })
    .returning({ id: tracks.id });

  return inserted.id;
}

// ──── Routes ────

export async function vibeRoutes(app: FastifyInstance) {
  // POST /api/vibe/generate — Generate bin from natural language prompt
  app.post("/generate", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const schema = z.object({
      prompt: z.string().min(1).max(500),
      trackCount: z.number().int().min(10).max(100).default(25),
      includeDiscovery: z.boolean().default(false),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const enrichedTracks = await getUserEnrichedTracks(user.sub);

    if (enrichedTracks.length === 0) {
      return reply.status(400).send({
        error: "No enriched tracks available. Please wait for your library scan to complete.",
      });
    }

    const { trackCount, includeDiscovery } = parsed.data;

    // When discovery is on, ask AI for ~70% from library; rest will be discovery
    const libraryTarget = includeDiscovery
      ? Math.max(10, Math.round(trackCount * 0.7))
      : trackCount;

    // Cap at 500 tracks for prompt size management
    const tracksForPrompt = enrichedTracks.slice(0, 500);
    const trackSummary = buildTrackSummary(tracksForPrompt);

    const systemPrompt = includeDiscovery
      ? `You are a music curator AI. The user has a Spotify library. Given their prompt describing a vibe or mood, select tracks from their library that best match AND suggest new tracks they don't have that would fit the vibe.

DISCOVERY INSTRUCTIONS:
- Search the web for trending songs, viral hits, and new releases from 2024-2026 that match the requested vibe.
- Also include timeless classics and iconic tracks that perfectly capture the mood — these are songs that have stood the test of time and are universally recognized.
- Aim for a balanced mix: roughly half discovery tracks should be recent/trending hits and half should be beloved classics or deep cuts.
- Every suggested track must be a real song that exists on Spotify. Do not invent tracks.

Return a JSON object with:
- "bin_name": a short creative name for this playlist (max 50 chars)
- "description": a one-sentence description of the vibe
- "track_indices": an array of integer indices from the track list below that match the requested vibe
- "discovery_tracks": an array of objects with {"name": "track name", "artist": "artist name"} for songs NOT in the user's library that would fit the vibe perfectly.

You MUST select approximately ${libraryTarget} tracks from the library. Suggest approximately ${trackCount - libraryTarget} discovery tracks. Use genres, mood tags, artist names, and song titles to judge fit. Tracks with "unknown" mood can still match based on genre and artist.

TRACK LIST:
${trackSummary}`
      : `You are a music curator AI. The user has a Spotify library. Given their prompt describing a vibe or mood, select tracks from their library that best match.

Return a JSON object with:
- "bin_name": a short creative name for this playlist (max 50 chars)
- "description": a one-sentence description of the vibe
- "track_indices": an array of integer indices from the track list below that match the requested vibe

You MUST select approximately ${libraryTarget} tracks. Use genres, mood tags, artist names, and song titles to judge fit. Tracks with "unknown" mood can still match based on genre and artist.

TRACK LIST:
${trackSummary}`;

    const content = await chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: parsed.data.prompt },
      ],
      {
        temperature: 0.8,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        plugins: includeDiscovery ? [{ id: "web" }] : undefined,
      }
    );

    if (!content || !content.trim()) {
      return reply.status(500).send({ error: "AI returned an empty response. Try a different model or prompt." });
    }

    let result: { bin_name: string; description: string; track_indices: number[]; discovery_tracks?: { name: string; artist: string }[] };
    try {
      result = parseLLMJson(content);
    } catch {
      return reply.status(500).send({ error: "Failed to parse AI response" });
    }

    if (!result.track_indices || !Array.isArray(result.track_indices)) {
      return reply.status(500).send({ error: "AI returned invalid track selection" });
    }

    // ── Discovery tracks via AI suggestions + Spotify Search ──
    let discoveryTrackIds: string[] = [];

    if (includeDiscovery && result.discovery_tracks?.length) {
      try {
        const accessToken = await getSpotifyToken(user.sub);
        const userSpotifyIds = new Set(enrichedTracks.map((t) => t.spotifyTrackId));

        console.log(`[Vibe] Searching for ${result.discovery_tracks.length} AI-suggested discovery tracks`);

        for (const suggestion of result.discovery_tracks) {
          const found = await searchTrack(accessToken, suggestion.name, suggestion.artist);
          if (found && !userSpotifyIds.has(found.id)) {
            const trackId = await upsertDiscoveryTrack(found);
            discoveryTrackIds.push(trackId);
          }
        }

        console.log(`[Vibe] Found ${discoveryTrackIds.length} valid discovery tracks on Spotify`);
      } catch (err) {
        console.error("[Vibe] Discovery failed, continuing with library tracks only:", err);
      }
    }

    const bin = await createBinFromSelection(
      user.sub,
      result.bin_name || "AI Vibe",
      result.description || null,
      includeDiscovery ? "ai-vibe-discovery" : "ai-vibe",
      parsed.data.prompt,
      tracksForPrompt,
      result.track_indices,
      discoveryTrackIds
    );

    if (!bin) {
      return reply.status(500).send({ error: "No matching tracks found for this vibe" });
    }

    return reply.status(201).send(bin);
  });

  // GET /api/vibe/suggestions — Auto-categorization suggestions
  app.get("/suggestions", async (request, reply) => {
    const user = (request as any).user as JwtPayload;

    const enrichedTracks = await getUserEnrichedTracks(user.sub);

    if (enrichedTracks.length === 0) {
      return reply.send({ suggestions: [] });
    }

    // Build genre/mood frequency map to suggest categories
    const genreCount = new Map<string, number>();
    const moodCount = new Map<string, number>();

    for (const t of enrichedTracks) {
      for (const g of t.genres) {
        genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
      }
      for (const m of t.moodTags) {
        moodCount.set(m, (moodCount.get(m) ?? 0) + 1);
      }
    }

    // Top genres by frequency (min 3 tracks)
    const topGenres = [...genreCount.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([genre, count]) => ({ type: "genre" as const, label: genre, trackCount: count }));

    // Top moods by frequency (min 3 tracks)
    const topMoods = [...moodCount.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([mood, count]) => ({ type: "mood" as const, label: mood, trackCount: count }));

    // Predefined vibe prompts
    const vibePrompts = [
      "Late night chill study session",
      "High energy workout",
      "Sunday morning coffee",
      "Road trip bangers",
      "Rainy day melancholy",
      "Get ready to go out",
    ];

    return reply.send({
      suggestions: [
        ...topGenres,
        ...topMoods,
      ],
      vibePrompts,
    });
  });
}
