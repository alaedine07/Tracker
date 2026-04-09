import apiClient from "./client";
import { LibraryTrack } from "./library";

// ──── Types ────

export interface SetOperationResult {
  operation: string;
  sourceA: string;
  sourceB: string;
  trackCount: number;
  tracks: LibraryTrack[];
  bin: {
    id: string;
    name: string;
  } | null;
}

// ──── API Calls ────

export async function performSetOperation(
  operation: "union" | "intersection" | "difference",
  sourceA: string,
  sourceB: string,
  createBin = false,
  binName?: string
): Promise<SetOperationResult> {
  const { data } = await apiClient.post(`/api/sets/${operation}`, {
    sourceA,
    sourceB,
    createBin,
    binName,
  });
  return data;
}
