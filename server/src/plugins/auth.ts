import { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env";

export interface JwtPayload {
  sub: string; // user.id (UUID)
  spotify_id: string;
  iat: number;
  exp: number;
}

const secret = new TextEncoder().encode(env.JWT_SECRET);

/**
 * Sign a new JWT
 */
export async function signJwt(
  userId: string,
  spotifyId: string,
  expiresIn = "15m"
): Promise<string> {
  return new SignJWT({ spotify_id: spotifyId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

/**
 * Verify and decode a JWT
 */
export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JwtPayload;
}

/**
 * Fastify plugin: adds request.user to authenticated routes
 */
async function authPluginFn(app: FastifyInstance) {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    // Skip auth for public routes
    const publicPaths = ["/health", "/api/auth/token", "/api/auth/refresh"];
    if (publicPaths.some((p) => request.url.startsWith(p))) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.slice(7);
    try {
      const payload = await verifyJwt(token);
      (request as any).user = payload;
    } catch {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
  });
}

export const authPlugin = fp(authPluginFn, { name: "auth" });
