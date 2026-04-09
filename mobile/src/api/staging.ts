import apiClient from "./client";

// ──── Types ────

export interface StagingBin {
  id: string;
  name: string;
  description: string | null;
  source: string;
  promptText: string | null;
  createdAt: string;
  updatedAt: string;
  trackCount: number;
}

export interface BinTrack {
  trackId: string;
  spotifyTrackId: string;
  name: string;
  artistNames: string[];
  albumName: string | null;
  albumArtUrl: string | null;
  durationMs: number;
  previewUrl: string | null;
  position: number;
}

export interface StagingBinDetail extends StagingBin {
  tracks: BinTrack[];
}

// ──── API Calls ────

export async function getStagingBins(): Promise<{ items: StagingBin[]; total: number }> {
  const { data } = await apiClient.get("/api/staging/bins");
  return data;
}

export async function createBin(name: string, description?: string): Promise<StagingBin> {
  const { data } = await apiClient.post("/api/staging/bins", { name, description });
  return data;
}

export async function getBinDetail(binId: string): Promise<StagingBinDetail> {
  const { data } = await apiClient.get(`/api/staging/bins/${binId}`);
  return data;
}

export async function updateBin(binId: string, updates: { name?: string; description?: string }): Promise<StagingBin> {
  const { data } = await apiClient.patch(`/api/staging/bins/${binId}`, updates);
  return data;
}

export async function deleteBin(binId: string): Promise<void> {
  await apiClient.delete(`/api/staging/bins/${binId}`);
}

export async function addTracksToBin(binId: string, trackIds: string[]): Promise<{ added: number }> {
  const { data } = await apiClient.post(`/api/staging/bins/${binId}/tracks`, { trackIds });
  return data;
}

export async function removeTracksFromBin(binId: string, trackIds: string[]): Promise<{ removed: number }> {
  const { data } = await apiClient.delete(`/api/staging/bins/${binId}/tracks`, { data: { trackIds } });
  return data;
}

export async function reorderBinTracks(binId: string, trackIds: string[]): Promise<{ reordered: number }> {
  const { data } = await apiClient.patch(`/api/staging/bins/${binId}/reorder`, { trackIds });
  return data;
}

export async function pushBinToSpotify(
  binId: string,
  options?: { playlistName?: string; description?: string; isPublic?: boolean }
): Promise<{ spotifyPlaylistId: string; spotifyUrl: string; trackCount: number }> {
  const { data } = await apiClient.post(`/api/staging/bins/${binId}/push`, options ?? {});
  return data;
}
