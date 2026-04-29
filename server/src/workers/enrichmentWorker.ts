import { Queue, Worker, Job } from "bullmq";
import { redis } from "../config/redis";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../config/database";
import { tracks, userTracks, trackMetadata, scanJobs } from "../db/schema";
import { getTrackTopTags, getArtistTopTags } from "../services/lastfmService";
import { getAudioFeaturesBatch } from "../services/spotifyService";
import { getSpotifyToken } from "../utils/spotifyToken";
import { classifyTags } from "../utils/genreNormalization";
import { completeScan } from "../services/scanService";

// ──── Queue Definition ────

export const enrichmentQueue = new Queue("enrichment", { connection: redis });

// ──── Types ────

interface EnrichmentJobData {
  userId: string;
  scanJobId: string;
  phase: "track-tags" | "artist-tags" | "audio-features";
}

// ──── Helpers ────

async function updateEnrichmentProgress(
  scanJobId: string,
  processed: number,
  total?: number,
  phase?: string
) {
  const updates: Record<string, any> = { processedTracks: processed };
  if (total !== undefined) updates.totalTracks = total;
  if (phase) updates.currentPhase = phase;
  await db.update(scanJobs).set(updates).where(eq(scanJobs.id, scanJobId));
}

// ──── Phase 3a: Track Tag Enrichment ────

async function enrichTrackTags(userId: string, scanJobId: string) {
  await updateEnrichmentProgress(scanJobId, 0, 0, "track-tags");

  // Get all user tracks that don't have metadata yet
  const unenrichedTracks = await db
    .select({
      trackId: tracks.id,
      name: tracks.name,
      artistNames: tracks.artistNames,
    })
    .from(userTracks)
    .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
    .leftJoin(trackMetadata, eq(tracks.id, trackMetadata.trackId))
    .where(
      and(
        eq(userTracks.userId, userId),
        isNull(trackMetadata.trackId) // not enriched yet
      )
    );

  const total = unenrichedTracks.length;
  await updateEnrichmentProgress(scanJobId, 0, total, "track-tags");

  let processed = 0;

  // Process in batches to manage memory
  const BATCH_SIZE = 50;
  for (let i = 0; i < unenrichedTracks.length; i += BATCH_SIZE) {
    const batch = unenrichedTracks.slice(i, i + BATCH_SIZE);

    for (const track of batch) {
      const primaryArtist = track.artistNames[0] ?? "";
      const tags = await getTrackTopTags(primaryArtist, track.name);

      const { genres, moodTags } = classifyTags(tags);

      // Store raw tags + classified metadata
      await db
        .insert(trackMetadata)
        .values({
          trackId: track.trackId,
          lastfmTags: tags.slice(0, 20), // store top 20 raw tags
          genres: genres.length > 0 ? genres : null,
          moodTags: moodTags.length > 0 ? moodTags : null,
        })
        .onConflictDoUpdate({
          target: trackMetadata.trackId,
          set: {
            lastfmTags: tags.slice(0, 20),
            genres: genres.length > 0 ? genres : null,
            moodTags: moodTags.length > 0 ? moodTags : null,
            enrichedAt: new Date(),
          },
        });

      processed++;
    }

    await updateEnrichmentProgress(scanJobId, processed);
  }

  return { total, processed };
}

// ──── Phase 3b: Artist Tag Fallback ────

async function enrichArtistTags(userId: string, scanJobId: string) {
  await updateEnrichmentProgress(scanJobId, 0, 0, "artist-tags");

  // Find tracks that still have empty genres after track-tag enrichment
  // We'll use artist-level tags as fallback
  const tracksNeedingFallback = await db
    .select({
      trackId: tracks.id,
      artistNames: tracks.artistNames,
      artistIds: tracks.artistIds,
    })
    .from(userTracks)
    .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
    .innerJoin(trackMetadata, eq(tracks.id, trackMetadata.trackId))
    .where(
      and(
        eq(userTracks.userId, userId),
        // genres is null or empty — needs artist fallback
        sql`(${trackMetadata.genres} IS NULL OR array_length(${trackMetadata.genres}, 1) IS NULL)`
      )
    );

  // Deduplicate artists — cache artist tags to avoid redundant API calls
  const artistTagCache = new Map<string, { genres: string[]; moodTags: string[] }>();

  const total = tracksNeedingFallback.length;
  await updateEnrichmentProgress(scanJobId, 0, total, "artist-tags");

  let processed = 0;

  for (const track of tracksNeedingFallback) {
    const primaryArtist = track.artistNames[0] ?? "";
    if (!primaryArtist) {
      processed++;
      continue;
    }

    // Check cache first
    let classified = artistTagCache.get(primaryArtist);
    if (!classified) {
      const artistTags = await getArtistTopTags(primaryArtist);
      classified = classifyTags(artistTags);
      artistTagCache.set(primaryArtist, classified);
    }

    if (classified.genres.length > 0 || classified.moodTags.length > 0) {
      await db
        .update(trackMetadata)
        .set({
          genres: classified.genres.length > 0 ? classified.genres : undefined,
          moodTags: classified.moodTags.length > 0 ? classified.moodTags : undefined,
          enrichedAt: new Date(),
        })
        .where(eq(trackMetadata.trackId, track.trackId));
    }

    processed++;
    if (processed % 50 === 0) {
      await updateEnrichmentProgress(scanJobId, processed);
    }
  }

  await updateEnrichmentProgress(scanJobId, processed);
  return { total, processed, uniqueArtists: artistTagCache.size };
}

// ──── Phase 3c: Audio Features from Spotify ────

async function enrichAudioFeatures(userId: string, scanJobId: string) {
  await updateEnrichmentProgress(scanJobId, 0, 0, "audio-features");

  // Get all user tracks that are missing BPM/energy data
  const tracksNeedingFeatures = await db
    .select({
      trackId: tracks.id,
      spotifyTrackId: tracks.spotifyTrackId,
    })
    .from(userTracks)
    .innerJoin(tracks, eq(userTracks.trackId, tracks.id))
    .leftJoin(trackMetadata, eq(tracks.id, trackMetadata.trackId))
    .where(
      and(
        eq(userTracks.userId, userId),
        sql`(${trackMetadata.bpmEstimate} IS NULL OR ${trackMetadata.energyEstimate} IS NULL)`
      )
    );

  const total = tracksNeedingFeatures.length;
  await updateEnrichmentProgress(scanJobId, 0, total, "audio-features");

  if (total === 0) return { total: 0, processed: 0 };

  const accessToken = await getSpotifyToken(userId);
  let processed = 0;

  // Process in batches of 100 (Spotify API limit)
  const BATCH_SIZE = 100;
  for (let i = 0; i < tracksNeedingFeatures.length; i += BATCH_SIZE) {
    const batch = tracksNeedingFeatures.slice(i, i + BATCH_SIZE);
    const spotifyIds = batch.map((t) => t.spotifyTrackId);

    const featuresMap = await getAudioFeaturesBatch(accessToken, spotifyIds);

    for (const track of batch) {
      const features = featuresMap.get(track.spotifyTrackId);
      if (features) {
        await db
          .insert(trackMetadata)
          .values({
            trackId: track.trackId,
            bpmEstimate: Math.round(features.tempo),
            energyEstimate: features.energy,
          })
          .onConflictDoUpdate({
            target: trackMetadata.trackId,
            set: {
              bpmEstimate: Math.round(features.tempo),
              energyEstimate: features.energy,
              enrichedAt: new Date(),
            },
          });
      }
      processed++;
    }

    await updateEnrichmentProgress(scanJobId, processed);
  }

  return { total, processed };
}

// ──── Worker ────

export const enrichmentWorker = new Worker<EnrichmentJobData>(
  "enrichment",
  async (job: Job<EnrichmentJobData>) => {
    const { userId, scanJobId, phase } = job.data;

    try {
      if (phase === "track-tags") {
        return await enrichTrackTags(userId, scanJobId);
      } else if (phase === "artist-tags") {
        return await enrichArtistTags(userId, scanJobId);
      } else if (phase === "audio-features") {
        const result = await enrichAudioFeatures(userId, scanJobId);
        // Audio features is the last enrichment phase — mark scan complete
        await completeScan(scanJobId);
        return result;
      }
    } catch (err: any) {
      // Mark scan as failed
      await db
        .update(scanJobs)
        .set({
          status: "failed",
          errorMessage: `Enrichment failed: ${err.message}`,
          completedAt: new Date(),
        })
        .where(eq(scanJobs.id, scanJobId));
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 1, // Respect Last.fm rate limits
  }
);

enrichmentWorker.on("failed", (job, err) => {
  console.error(`Enrichment job ${job?.id} failed:`, err.message);
});
