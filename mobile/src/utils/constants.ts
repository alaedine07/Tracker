// API configuration constants

export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
export const SPOTIFY_CLIENT_ID =
  process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || "";
export const SPOTIFY_REDIRECT_URI =
  process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI || "musicmanager://callback";

export const SPOTIFY_SCOPES = [
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
  "user-read-email",
].join(" ");

export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
