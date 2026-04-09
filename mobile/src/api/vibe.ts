import apiClient from "./client";

// ──── Types ────

export interface VibeSuggestion {
  type: "genre" | "mood";
  label: string;
  trackCount: number;
}

export interface VibeSuggestionsResponse {
  suggestions: VibeSuggestion[];
  vibePrompts: string[];
}

export interface GeneratedBin {
  id: string;
  name: string;
  description: string | null;
  source: string;
  promptText: string | null;
  trackCount: number;
  createdAt: string;
}

// ──── API Calls ────

export async function getVibeSuggestions(): Promise<VibeSuggestionsResponse> {
  const { data } = await apiClient.get("/api/vibe/suggestions");
  return data;
}

export async function generateVibe(
  prompt: string,
  options?: { trackCount?: number; includeDiscovery?: boolean }
): Promise<GeneratedBin> {
  const { data } = await apiClient.post("/api/vibe/generate", {
    prompt,
    ...options,
  });
  return data;
}
