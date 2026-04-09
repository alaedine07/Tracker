import apiClient from "./client";

export interface ScanStatus {
  status: "none" | "running" | "completed" | "failed" | "pending";
  scanJobId?: string;
  totalTracks?: number;
  processedTracks?: number;
  currentPhase?: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
}

export async function triggerScan(): Promise<{ scanJobId: string }> {
  const { data } = await apiClient.post("/api/library/scan");
  return data;
}

export async function getScanStatus(): Promise<ScanStatus> {
  const { data } = await apiClient.get("/api/library/scan/status");
  return data;
}

export interface LibraryTrack {
  id: string;
  spotifyTrackId: string;
  name: string;
  artistNames: string[];
  albumName: string | null;
  albumArtUrl: string | null;
  durationMs: number;
  previewUrl: string | null;
  addedAt: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getLibraryTracks(
  page = 1,
  limit = 50,
  search?: string
): Promise<PaginatedResponse<LibraryTrack>> {
  const params: Record<string, any> = { page, limit };
  if (search) params.search = search;
  const { data } = await apiClient.get("/api/library/tracks", { params });
  return data;
}

export interface PlaylistSummary {
  id: string;
  spotifyPlaylistId: string;
  name: string;
  description: string | null;
  trackCount: number;
  imageUrl: string | null;
  isOwner: boolean;
  syncedAt: string;
}

export async function getPlaylists(): Promise<{
  items: PlaylistSummary[];
  total: number;
}> {
  const { data } = await apiClient.get("/api/library/playlists");
  return data;
}

export async function getPlaylistTracks(
  playlistId: string
): Promise<{
  playlist: Pick<PlaylistSummary, "id" | "name" | "description" | "trackCount" | "imageUrl">;
  items: (LibraryTrack & { position: number })[];
  total: number;
}> {
  const { data } = await apiClient.get(`/api/library/playlists/${playlistId}/tracks`);
  return data;
}
