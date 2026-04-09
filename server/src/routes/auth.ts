import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../config/database";
import { users } from "../db/schema";
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  spotifyFetch,
} from "../services/spotifyService";
import { encrypt, decrypt } from "../utils/encryption";
import { signJwt } from "../plugins/auth";

const tokenRequestSchema = z.object({
  code: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  redirect_uri: z.string().min(1),
});

const refreshRequestSchema = z.object({
  user_id: z.string().uuid(),
});

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /api/auth/token
   * Exchange Spotify auth code for tokens, upsert user, return JWT
   */
  app.post("/token", async (request, reply) => {
    const parsed = tokenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        details: parsed.error.flatten(),
      });
    }

    const { code, code_verifier, redirect_uri } = parsed.data;

    // 1. Exchange code for Spotify tokens
    let spotifyTokens;
    try {
      spotifyTokens = await exchangeCodeForTokens(code, code_verifier, redirect_uri);
    } catch (err: any) {
      app.log.error(err, "Spotify token exchange failed");
      return reply.status(401).send({ error: "Spotify authentication failed" });
    }

    // 2. Fetch Spotify user profile
    const profileRes = await spotifyFetch("/me", spotifyTokens.access_token);
    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      app.log.error({ status: profileRes.status, errorText }, "Spotify /me request failed");
      return reply.status(502).send({ error: "Failed to fetch Spotify profile", details: errorText });
    }
    const profile = (await profileRes.json()) as {
      id: string;
      display_name: string | null;
      email: string;
      country: string;
      product: string;
      images: { url: string }[];
    };

    // 3. Encrypt tokens before storage
    const encryptedAccessToken = encrypt(spotifyTokens.access_token);
    const encryptedRefreshToken = encrypt(spotifyTokens.refresh_token || "");
    const tokenExpiresAt = new Date(Date.now() + spotifyTokens.expires_in * 1000);

    // 4. Upsert user
    const existingUser = await db.query.users.findFirst({
      where: eq(users.spotifyId, profile.id),
    });

    let userId: string;

    if (existingUser) {
      await db
        .update(users)
        .set({
          displayName: profile.display_name,
          email: profile.email,
          country: profile.country,
          product: profile.product,
          avatarUrl: profile.images?.[0]?.url || null,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(users.spotifyId, profile.id));

      userId = existingUser.id;
    } else {
      const [newUser] = await db
        .insert(users)
        .values({
          spotifyId: profile.id,
          displayName: profile.display_name,
          email: profile.email,
          country: profile.country,
          product: profile.product,
          avatarUrl: profile.images?.[0]?.url || null,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt,
        })
        .returning({ id: users.id });

      userId = newUser.id;
    }

    // 5. Sign JWT
    const jwt = await signJwt(userId, profile.id);

    return reply.send({
      jwt,
      user: {
        id: userId,
        spotify_id: profile.id,
        display_name: profile.display_name,
        email: profile.email,
        avatar_url: profile.images?.[0]?.url || null,
      },
    });
  });

  /**
   * POST /api/auth/refresh
   * Refresh the Spotify access token and issue new JWT
   */
  app.post("/refresh", async (request, reply) => {
    const parsed = refreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        details: parsed.error.flatten(),
      });
    }

    const { user_id } = parsed.data;

    const user = await db.query.users.findFirst({
      where: eq(users.id, user_id),
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const refreshToken = decrypt(user.refreshToken);
    if (!refreshToken) {
      return reply.status(401).send({ error: "No refresh token available" });
    }

    let spotifyTokens;
    try {
      spotifyTokens = await refreshAccessToken(refreshToken);
    } catch (err: any) {
      app.log.error(err, "Spotify token refresh failed");
      return reply.status(401).send({ error: "Spotify token refresh failed. Please re-login." });
    }

    const encryptedAccessToken = encrypt(spotifyTokens.access_token);
    const tokenExpiresAt = new Date(Date.now() + spotifyTokens.expires_in * 1000);

    const updateData: Record<string, any> = {
      accessToken: encryptedAccessToken,
      tokenExpiresAt,
      updatedAt: new Date(),
    };

    if (spotifyTokens.refresh_token) {
      updateData.refreshToken = encrypt(spotifyTokens.refresh_token);
    }

    await db.update(users).set(updateData).where(eq(users.id, user_id));

    const jwt = await signJwt(user.id, user.spotifyId);

    return reply.send({ jwt });
  });

  /**
   * DELETE /api/auth/logout
   * Clear stored tokens
   */
  app.delete("/logout", async (request, reply) => {
    const user = (request as any).user;
    if (!user?.sub) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    await db
      .update(users)
      .set({
        accessToken: "",
        refreshToken: "",
        tokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.sub));

    return reply.send({ success: true });
  });
}
