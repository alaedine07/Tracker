import { useCallback, useRef } from "react";
import { Alert, Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_SCOPES,
  SPOTIFY_AUTH_URL,
} from "../utils/constants";
import { exchangeAuthCode } from "../api/auth";
import { useAuthStore } from "../stores/authStore";

// Dismiss browser on redirect
WebBrowser.maybeCompleteAuthSession();

function generateRandomString(length: number): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = Crypto.getRandomBytes(length);
  return Array.from(values)
    .map((v) => possible[v % possible.length])
    .join("");
}

async function sha256Base64Url(plain: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    plain,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  // Convert base64 to base64url
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function useSpotifyAuth() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const router = useRouter();
  const codeVerifierRef = useRef<string>("");

  const login = useCallback(async () => {
    // 1. Generate PKCE code verifier & challenge
    const codeVerifier = generateRandomString(64);
    codeVerifierRef.current = codeVerifier;
    const codeChallenge = await sha256Base64Url(codeVerifier);

    // 2. Compute redirect URI for the current environment:
    //    - Web: use the actual origin the user is browsing from so Spotify
    //      redirects back to the same host/port (works on any IP or tunnel).
    //    - Expo Go (dev): exp+musicmanager://callback
    //    - Standalone build: musicmanager://callback
    const redirectUri =
      Platform.OS === "web"
        ? window.location.origin
        : AuthSession.makeRedirectUri({
            scheme: "exp+musicmanager",
            path: "callback",
            preferLocalhost: false,
          });

    console.log("DEBUG: Spotify Redirect URI:", redirectUri);
    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
    });

    const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;

    // 3. Open browser for user login
    const result = await WebBrowser.openAuthSessionAsync(
      authUrl,
      redirectUri
    );

    if (result.type !== "success" || !result.url) {
      throw new Error("Authentication cancelled or failed");
    }

    // 4. Parse the authorization code from the redirect URL
    const url = new URL(result.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      throw new Error(`Spotify auth error: ${error}`);
    }

    if (!code) {
      throw new Error("No authorization code received");
    }

    // 5. Exchange code for tokens via our backend
    const response = await exchangeAuthCode(
      code,
      codeVerifierRef.current,
      redirectUri
    );

    // 6. Store auth state
    await setAuth(response.jwt, response.user);

    // 7. Navigate to scan screen to start library sync
    router.replace("/scan");

    return response.user;
  }, [setAuth, router]);

  return { login };
}
