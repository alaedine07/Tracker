import { eq, and, desc } from "drizzle-orm";
import { db } from "../config/database";
import { scanJobs, users } from "../db/schema";
import { scanQueue } from "../workers/scanWorker";
import { enrichmentQueue } from "../workers/enrichmentWorker";

/**
 * Start a full library scan for a user.
 * Queues Phase 1 (liked songs) then Phase 2 (playlists) sequentially.
 */
export async function startLibraryScan(userId: string) {
  // Check for any active scan
  const activeScan = await db.query.scanJobs.findFirst({
    where: and(
      eq(scanJobs.userId, userId),
      eq(scanJobs.status, "running")
    ),
  });

  if (activeScan) {
    return { scanJobId: activeScan.id, alreadyRunning: true };
  }

  // Create scan job record
  const [scanJob] = await db
    .insert(scanJobs)
    .values({
      userId,
      status: "running",
      currentPhase: "liked-songs",
      startedAt: new Date(),
    })
    .returning({ id: scanJobs.id });

  // Update user's last scan timestamp
  await db
    .update(users)
    .set({ lastScanAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Queue Phase 1: Liked Songs
  const likedJob = await scanQueue.add(
    "liked-songs",
    { userId, scanJobId: scanJob.id, phase: "liked-songs" as const },
    { jobId: `scan-${scanJob.id}-liked` }
  );

  // Queue Phase 2: Playlists (waits for Phase 1 to complete)
  await scanQueue.add(
    "playlists",
    { userId, scanJobId: scanJob.id, phase: "playlists" as const },
    {
      jobId: `scan-${scanJob.id}-playlists`,
      delay: 0, // queued after liked-songs due to concurrency: 1
    }
  );

  return { scanJobId: scanJob.id, alreadyRunning: false };
}

/**
 * Queue enrichment phases after library scan completes.
 * Phase 3a: Track tags from Last.fm
 * Phase 3b: Artist tags as fallback for tracks with no genres
 * Phase 3c: Audio features (BPM, energy) from Spotify
 */
export async function startEnrichment(userId: string, scanJobId: string) {
  // Phase 3a: Track tag enrichment
  await enrichmentQueue.add(
    "track-tags",
    { userId, scanJobId, phase: "track-tags" as const },
    { jobId: `enrich-${scanJobId}-track-tags` }
  );

  // Phase 3b: Artist tag fallback (queued after track-tags due to concurrency: 1)
  await enrichmentQueue.add(
    "artist-tags",
    { userId, scanJobId, phase: "artist-tags" as const },
    {
      jobId: `enrich-${scanJobId}-artist-tags`,
      delay: 0,
    }
  );

  // Phase 3c: Audio features from Spotify (queued after artist-tags due to concurrency: 1)
  await enrichmentQueue.add(
    "audio-features",
    { userId, scanJobId, phase: "audio-features" as const },
    {
      jobId: `enrich-${scanJobId}-audio-features`,
      delay: 0,
    }
  );
}

/**
 * Get the current/latest scan status for a user.
 */
export async function getScanStatus(userId: string) {
  const scanJob = await db.query.scanJobs.findFirst({
    where: eq(scanJobs.userId, userId),
    orderBy: desc(scanJobs.createdAt),
  });

  if (!scanJob) {
    return { status: "none" as const };
  }

  return {
    status: scanJob.status,
    scanJobId: scanJob.id,
    totalTracks: scanJob.totalTracks,
    processedTracks: scanJob.processedTracks,
    currentPhase: scanJob.currentPhase,
    errorMessage: scanJob.errorMessage,
    startedAt: scanJob.startedAt,
    completedAt: scanJob.completedAt,
  };
}

/**
 * Mark a scan as completed. Called by the worker after all phases finish.
 */
export async function completeScan(scanJobId: string) {
  await db
    .update(scanJobs)
    .set({
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(scanJobs.id, scanJobId));
}
