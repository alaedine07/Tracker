import apiClient from "./client";

export interface AuthTokenResponse {
  jwt: string;
  user: {
    id: string;
    spotify_id: string;
    display_name: string | null;
    email: string;
    avatar_url: string | null;
  };
}

export async function exchangeAuthCode(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<AuthTokenResponse> {
  const { data } = await apiClient.post<AuthTokenResponse>("/api/auth/token", {
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  return data;
}

export async function refreshToken(userId: string): Promise<{ jwt: string }> {
  const { data } = await apiClient.post<{ jwt: string }>("/api/auth/refresh", {
    user_id: userId,
  });
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.delete("/api/auth/logout");
}
