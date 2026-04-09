import { env } from "../config/env";

const LASTFM_API_BASE = "https://ws.audioscrobbler.com/2.0/";

interface LastfmTag {
  name: string;
  count: number;
}

interface LastfmTagsResponse {
  toptags?: { tag: LastfmTag[] };
}

// Simple rate limiter: 5 req/sec for Last.fm
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 200; // 5 req/sec

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_INTERVAL_MS - elapsed)
    );
  }
  lastRequestTime = Date.now();
}

async function lastfmFetch(params: Record<string, string>): Promise<any> {
  await rateLimit();

  const url = new URL(LASTFM_API_BASE);
  url.searchParams.set("api_key", env.LASTFM_API_KEY);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Last.fm API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get top tags for a track
 */
export async function getTrackTopTags(
  artist: string,
  track: string
): Promise<LastfmTag[]> {
  try {
    const data: LastfmTagsResponse = await lastfmFetch({
      method: "track.getTopTags",
      artist,
      track,
    });
    return data.toptags?.tag || [];
  } catch {
    return [];
  }
}

/**
 * Get top tags for an artist
 */
export async function getArtistTopTags(
  artist: string
): Promise<LastfmTag[]> {
  try {
    const data: LastfmTagsResponse = await lastfmFetch({
      method: "artist.getTopTags",
      artist,
    });
    return data.toptags?.tag || [];
  } catch {
    return [];
  }
}

/**
 * Get similar artists
 */
export async function getSimilarArtists(
  artist: string,
  limit = 10
): Promise<{ name: string; match: number }[]> {
  try {
    const data = await lastfmFetch({
      method: "artist.getSimilar",
      artist,
      limit: String(limit),
    });
    return (
      data.similarartists?.artist?.map((a: any) => ({
        name: a.name,
        match: parseFloat(a.match),
      })) || []
    );
  } catch {
    return [];
  }
}
