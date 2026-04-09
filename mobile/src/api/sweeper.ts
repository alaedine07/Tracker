import apiClient from "./client";

// ──── Types ────

export interface UnavailableTrack {
  trackId: string;
  spotifyTrackId: string;
  name: string;
  artistNames: string[];
  albumName: string | null;
  reason: string;
}

export interface DuplicateGroup {
  isrc: string | null;
  name: string;
  artistNames: string[];
  tracks: {
    trackId: string;
    spotifyTrackId: string;
    name: string;
    albumName: string | null;
    foundIn: string[];
  }[];
}

export interface SweeperResults {
  unavailable: { count: number; tracks: UnavailableTrack[] };
  duplicates: { count: number; groups: DuplicateGroup[] };
  scannedAt: string;
}

// ──── API Calls ────

export async function runSweeperScan(): Promise<SweeperResults> {
  const { data } = await apiClient.post("/api/sweeper/scan");
  return data;
}

export async function getSweeperResults(): Promise<SweeperResults> {
  const { data } = await apiClient.get("/api/sweeper/results");
  return data;
}

export async function cleanTracks(
  trackIds: string[],
  removeFrom: "liked" | "all" = "liked"
): Promise<{ removed: number; errors: string[] }> {
  const { data } = await apiClient.post("/api/sweeper/clean", { trackIds, removeFrom });
  return data;
}
