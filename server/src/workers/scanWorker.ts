import { Queue, Worker, Job } from "bullmq";
import { redis } from "../config/redis";
import { eq, and } from "drizzle-orm";
import { db } from "../config/database";
import {
  tracks,
  userTracks,
  playlists,
  playlistTracks,
  scanJobs,
} from "../db/schema";
import { spotifyFetch } from "../services/spotifyService";
import { getSpotifyToken } from "../utils/spotifyToken";
import { completeScan, startEnrichment } from "../services/scanService";

// ──── Queue Definition ────

export const scanQueue = new Queue("library-scan", { connection: redis });

// ──── Types ────

interface ScanJobData {
  userId: string;
  scanJobId: string;
  phase: "liked-songs" | "playlists";
}

interface SpotifySavedTrack {
  added_at: string;
  track: {
    id: string;
    name: string;
    artists: { id: string; name: string }[];
    album: { name: string; images: { url: string }[] };
    duration_ms: number;
    preview_url: string | null;
    external_ids?: { isrc?: string };
    popularity: number;
    explicit: boolean;
  };
}

interface SpotifyPlaylistItem {
  id: string;
  name: string;
  description: string;
  tracks?: { total: number };
  items?: { href: string; total: number };
  images: { url: string }[] | null;
  owner: { id: string };
  snapshot_id: string;
}

interface SpotifyPlaylistTrack {
  track?: {
    id: string;
    name: string;
    artists: { id: string; name: string }[];
    album: { name: string; images: { url: string }[] };
    duration_ms: number;
    preview_url: string | null;
    external_ids?: { isrc?: string };
    popularity: number;
    explicit: boolean;
  } | null;
  item?: {
    id: string;
    name: string;
    artists: { id: string; name: string }[];
    album: { name: string; images: { url: string }[] };
    duration_ms: number;
    preview_url: string | null;
    external_ids?: { isrc?: string };
    popularity: number;
    explicit: boolean;
  } | null;
}

// ──── Helpers ────

async function upsertTrack(t: SpotifySavedTrack["track"]) {
  if (!t || !t.id) return null;

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

async function updateScanProgress(
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

// ──── Phase 1: Fetch Liked Songs ────

async function fetchLikedSongs(userId: string, scanJobId: string) {
  const accessToken = await getSpotifyToken(userId);
  let offset = 0;
  const limit = 50;
  let total = 0;
  let processed = 0;

  await updateScanProgress(scanJobId, 0, 0, "liked-songs");

  // First request to get total
  const firstRes = await spotifyFetch(
    `/me/tracks?limit=${limit}&offset=0`,
    accessToken
  );
  if (!firstRes.ok) throw new Error(`Failed to fetch liked songs: ${firstRes.status}`);

  const firstPage = (await firstRes.json()) as {
    total: number;
    items: SpotifySavedTrack[];
    next: string | null;
  };

  total = firstPage.total;
  await updateScanProgress(scanJobId, 0, total, "liked-songs");

  // Process first page
  for (const item of firstPage.items) {
    const trackId = await upsertTrack(item.track);
    if (trackId) {
      await db
        .insert(userTracks)
        .values({
          userId,
          trackId,
          addedAt: item.added_at ? new Date(item.added_at) : null,
        })
        .onConflictDoNothing();
    }
    processed++;
  }
  await updateScanProgress(scanJobId, processed);

  // Remaining pages
  let nextUrl = firstPage.next;
  while (nextUrl) {
    // Re-get token in case it expired during long scan
    const token = await getSpotifyToken(userId);
    const res = await spotifyFetch(nextUrl, token);
    if (!res.ok) throw new Error(`Liked songs pagination failed: ${res.status}`);

    const page = (await res.json()) as {
      items: SpotifySavedTrack[];
      next: string | null;
    };

    for (const item of page.items) {
      const trackId = await upsertTrack(item.track);
      if (trackId) {
        await db
          .insert(userTracks)
          .values({
            userId,
            trackId,
            addedAt: item.added_at ? new Date(item.added_at) : null,
          })
          .onConflictDoNothing();
      }
      processed++;
    }

    await updateScanProgress(scanJobId, processed);
    nextUrl = page.next;
  }

  return { total, processed };
}

// ──── Phase 2: Fetch Playlists + Tracks ────

async function fetchPlaylists(userId: string, scanJobId: string) {
  const accessToken = await getSpotifyToken(userId);

  await updateScanProgress(scanJobId, 0, 0, "playlists");

  // Get user's Spotify ID for ownership check
  const profileRes = await spotifyFetch("/me", accessToken);
  if (!profileRes.ok) throw new Error("Failed to fetch profile");
  const profile = (await profileRes.json()) as { id: string };

  // Paginate all playlists
  const allPlaylists: SpotifyPlaylistItem[] = [];
  let nextUrl: string | null = `/me/playlists?limit=50&offset=0`;

  while (nextUrl) {
    const token = await getSpotifyToken(userId);
    const res = await spotifyFetch(nextUrl, token);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Playlists fetch failed: ${res.status} ${errText}`);
      throw new Error(`Playlists fetch failed: ${res.status}`);
    }

    const page = (await res.json()) as {
      items: SpotifyPlaylistItem[];
      next: string | null;
    };
    allPlaylists.push(...(page.items || []).filter((p) => p && p.id));
    nextUrl = page.next;
  }

  await updateScanProgress(scanJobId, 0, allPlaylists.length, "playlists");

  let processed = 0;

  for (const pl of allPlaylists) {
    // Upsert playlist
    const trackCount = pl.tracks?.total ?? pl.items?.total ?? 0;
    const [upsertedPlaylist] = await db
      .insert(playlists)
      .values({
        userId,
        spotifyPlaylistId: pl.id,
        name: pl.name,
        description: pl.description || null,
        trackCount,
        imageUrl: pl.images?.[0]?.url ?? null,
        isOwner: pl.owner.id === profile.id,
        snapshotId: pl.snapshot_id,
      })
      .onConflictDoUpdate({
        target: [playlists.userId, playlists.spotifyPlaylistId],
        set: {
          name: pl.name,
          description: pl.description || null,
          trackCount,
          imageUrl: pl.images?.[0]?.url ?? null,
          isOwner: pl.owner.id === profile.id,
          snapshotId: pl.snapshot_id,
          syncedAt: new Date(),
        },
      })
      .returning({ id: playlists.id });

    const playlistId = upsertedPlaylist.id;

    // Clear existing playlist tracks for fresh re-sync
    await db
      .delete(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId));

    // Fetch all tracks in this playlist
    let trackNextUrl: string | null = `/playlists/${pl.id}/items?limit=100&offset=0`;
    let position = 0;

    while (trackNextUrl) {
      const token = await getSpotifyToken(userId);
      const res = await spotifyFetch(trackNextUrl, token);
      if (!res.ok) {
        // 403 is expected for non-owned playlists in Spotify dev mode
        break;
      }

      const pageData = await res.json();
      const page = pageData as {
        items: SpotifyPlaylistTrack[];
        next: string | null;
      };

      if (!page.items || page.items.length === 0) {
        break;
      }

      for (const item of page.items) {
        const trackData = item.track || item.item;
        if (!trackData || !trackData.id) {
          position++;
          processed++;
          continue; // Skip local files and null tracks
        }

        const trackId = await upsertTrack(trackData);
        if (trackId) {
          await db
            .insert(playlistTracks)
            .values({ playlistId, trackId, position })
            .onConflictDoNothing();
        }
        position++;
        processed++;
      }

      await updateScanProgress(scanJobId, processed);
      trackNextUrl = page.next;
    }

    // Update playlist track count with actual count
    if (position > 0) {
      await db
        .update(playlists)
        .set({ trackCount: position })
        .where(eq(playlists.id, playlistId));
    }
  }

  return { playlists: allPlaylists.length, tracks: processed };
}

// ──── Worker ────

export const scanWorker = new Worker<ScanJobData>(
  "library-scan",
  async (job: Job<ScanJobData>) => {
    const { userId, scanJobId, phase } = job.data;

    try {
      if (phase === "liked-songs") {
        return await fetchLikedSongs(userId, scanJobId);
      } else if (phase === "playlists") {
        const result = await fetchPlaylists(userId, scanJobId);
        // Queue enrichment phases (3a: track tags, 3b: artist tags)
        await startEnrichment(userId, scanJobId);
        return result;
      }
    } catch (err: any) {
      // Mark scan as failed
      await db
        .update(scanJobs)
        .set({
          status: "failed",
          errorMessage: err.message,
          completedAt: new Date(),
        })
        .where(eq(scanJobs.id, scanJobId));
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 1, // One scan at a time to respect rate limits
  }
);

scanWorker.on("failed", (job, err) => {
  console.error(`Scan job ${job?.id} failed:`, err.message);
});
