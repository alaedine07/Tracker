import { env } from "../config/env";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

/**
 * Exchange authorization code for tokens (PKCE flow)
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.SPOTIFY_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spotify token exchange failed: ${response.status} ${error}`);
  }

  return response.json() as Promise<SpotifyTokenResponse>;
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.SPOTIFY_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spotify token refresh failed: ${response.status} ${error}`);
  }

  return response.json() as Promise<SpotifyTokenResponse>;
}

/**
 * Make an authenticated request to the Spotify Web API with retry logic
 */
export async function spotifyFetch(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${SPOTIFY_API_BASE}${endpoint}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "1", 10);
      const delay = Math.min(retryAfter * 1000, 30000);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }

    if (!response.ok && attempt < retries && response.status >= 500) {
      const backoff = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }

    return response;
  }

  throw new Error(`Spotify API request failed after ${retries} retries: ${endpoint}`);
}

// ──── Search ────

export interface SpotifySearchTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: {
    name: string;
    images: { url: string }[];
  };
  duration_ms: number;
  preview_url: string | null;
  popularity: number;
  explicit: boolean;
  external_ids?: { isrc?: string };
}

/**
 * Search for a track on Spotify by name and artist.
 * Returns the best match or null.
 */
export async function searchTrack(
  accessToken: string,
  trackName: string,
  artistName: string
): Promise<SpotifySearchTrack | null> {
  const query = `track:${trackName} artist:${artistName}`;
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: "1",
  });

  const response = await spotifyFetch(
    `/search?${params.toString()}`,
    accessToken
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    tracks?: { items?: SpotifySearchTrack[] };
  };
  return data.tracks?.items?.[0] ?? null;
}

// ──── Audio Features ────

export interface SpotifyAudioFeatures {
  id: string;
  tempo: number;
  energy: number;
  danceability: number;
  valence: number;
}

/**
 * Get audio features for up to 100 tracks at a time.
 * Returns a map of trackId → audio features.
 */
export async function getAudioFeaturesBatch(
  accessToken: string,
  spotifyTrackIds: string[]
): Promise<Map<string, SpotifyAudioFeatures>> {
  const result = new Map<string, SpotifyAudioFeatures>();
  if (spotifyTrackIds.length === 0) return result;

  // Spotify allows max 100 IDs per request
  const BATCH_SIZE = 100;
  for (let i = 0; i < spotifyTrackIds.length; i += BATCH_SIZE) {
    const batch = spotifyTrackIds.slice(i, i + BATCH_SIZE);
    const ids = batch.join(",");

    const response = await spotifyFetch(
      `/audio-features?ids=${ids}`,
      accessToken
    );

    if (!response.ok) {
      console.warn(`Audio features request failed: ${response.status}`);
      continue;
    }

    const data = (await response.json()) as {
      audio_features: (SpotifyAudioFeatures | null)[];
    };

    for (const feature of data.audio_features) {
      if (feature) {
        result.set(feature.id, feature);
      }
    }
  }

  return result;
}

/**
 * Paginate through a Spotify endpoint, collecting all items
 */
export async function spotifyPaginateAll<T>(
  endpoint: string,
  accessToken: string,
  limit = 50
): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = `${SPOTIFY_API_BASE}${endpoint}${
    endpoint.includes("?") ? "&" : "?"
  }limit=${limit}&offset=0`;

  while (url) {
    const response = await spotifyFetch(url, accessToken);
    if (!response.ok) {
      throw new Error(`Spotify pagination failed: ${response.status}`);
    }

    const data = (await response.json()) as { items?: T[]; next?: string | null };
    items.push(...(data.items || []));
    url = data.next || null;
  }

  return items;
}
