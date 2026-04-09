import { eq } from "drizzle-orm";
import { db } from "../config/database";
import { users } from "../db/schema";
import { decrypt, encrypt } from "./encryption";
import { refreshAccessToken } from "../services/spotifyService";

/**
 * Get a valid Spotify access token for a user.
 * Automatically refreshes if expired and updates the DB.
 */
export async function getSpotifyToken(userId: string): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) throw new Error(`User not found: ${userId}`);

  // Check if token is still valid (with 60s buffer)
  const now = new Date();
  if (user.tokenExpiresAt && user.tokenExpiresAt.getTime() > now.getTime() + 60_000) {
    return decrypt(user.accessToken);
  }

  // Token expired — refresh it
  const refreshToken = decrypt(user.refreshToken);
  const tokens = await refreshAccessToken(refreshToken);

  const encryptedAccess = encrypt(tokens.access_token);
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const updateData: Record<string, any> = {
    accessToken: encryptedAccess,
    tokenExpiresAt,
    updatedAt: new Date(),
  };

  if (tokens.refresh_token) {
    updateData.refreshToken = encrypt(tokens.refresh_token);
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  return tokens.access_token;
}
