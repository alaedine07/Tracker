// Shared types between mobile and server

// ──── Spotify Types ────

export interface SpotifyUser {
  id: string;
  display_name: string | null;
  email: string;
  country: string;
  product: "premium" | "free" | "open";
  images: { url: string }[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: {
    id: string;
    name: string;
    images: { url: string; width: number; height: number }[];
  };
  duration_ms: number;
  preview_url: string | null;
  popularity: number;
  explicit: boolean;
  is_playable?: boolean;
  external_ids?: { isrc?: string };
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  images: { url: string }[];
  tracks: { total: number };
  owner: { id: string; display_name: string };
  snapshot_id: string;
}

// ──── API Request/Response Types ────

export interface AuthTokenRequest {
  code: string;
  code_verifier: string;
  redirect_uri: string;
}

export interface AuthTokenResponse {
  jwt: string;
  refresh_token: string;
  user: {
    id: string;
    spotify_id: string;
    display_name: string | null;
    email: string;
    avatar_url: string | null;
  };
}

export interface ScanStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  total_tracks: number;
  processed_tracks: number;
  current_phase:
    | "fetching_liked"
    | "fetching_playlists"
    | "enriching"
    | "categorizing"
    | null;
  error_message: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface TrackWithMetadata {
  id: string;
  spotify_track_id: string;
  name: string;
  artist_names: string[];
  album_name: string;
  album_art_url: string | null;
  duration_ms: number;
  preview_url: string | null;
  popularity: number;
  explicit: boolean;
  genres: string[];
  mood_tags: string[];
}

export interface PlaylistSummary {
  id: string;
  spotify_playlist_id: string;
  name: string;
  image_url: string | null;
  track_count: number;
  is_owner: boolean;
}

export interface StagingBin {
  id: string;
  name: string;
  description: string | null;
  source: "ai_vibe" | "ai_genre" | "set_operation" | "manual";
  prompt_text: string | null;
  track_count: number;
  created_at: string;
}

export interface StagingBinDetail extends StagingBin {
  tracks: TrackWithMetadata[];
}

export interface VibeGenerateRequest {
  prompt: string;
}

export interface SetOperationRequest {
  playlist_ids: string[];
}

export interface SweeperResults {
  unavailable_tracks: TrackWithMetadata[];
  duplicate_tracks: {
    track: TrackWithMetadata;
    found_in: { playlist_id: string; playlist_name: string }[];
  }[];
}

export interface CleanRequest {
  track_ids: string[];
  playlist_ids?: string[];
}
