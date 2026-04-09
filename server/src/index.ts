import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env";
import { authPlugin } from "./plugins/auth";
import { authRoutes } from "./routes/auth";
import { libraryRoutes } from "./routes/library";
import { stagingRoutes } from "./routes/staging";
import { vibeRoutes } from "./routes/vibe";
import { setsRoutes } from "./routes/sets";
import { sweeperRoutes } from "./routes/sweeper";
import { scanWorker } from "./workers/scanWorker";
import { enrichmentWorker } from "./workers/enrichmentWorker";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

async function start() {
  // Plugins
  await app.register(cors, {
    origin: true, // Allow mobile app
  });
  await app.register(authPlugin);

  // Health check
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // Routes
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(libraryRoutes, { prefix: "/api/library" });
  await app.register(stagingRoutes, { prefix: "/api/staging" });
  await app.register(vibeRoutes, { prefix: "/api/vibe" });
  await app.register(setsRoutes, { prefix: "/api/sets" });
  await app.register(sweeperRoutes, { prefix: "/api/sweeper" });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    const err = error as any;

    // Zod / validation errors
    if (err.validation || err.code === "FST_ERR_VALIDATION") {
      return reply.status(400).send({
        error: "ValidationError",
        message: "Request validation failed",
        details: err.validation ?? err.message,
      });
    }

    // Axios errors from Spotify API calls
    if (err.isAxiosError && err.response) {
      const status = err.response.status;
      const spotifyError = err.response.data?.error;

      if (status === 401) {
        app.log.warn({ userId: (request as any).userId }, "Spotify token expired");
        return reply.status(401).send({
          error: "SpotifyAuthError",
          message: "Spotify session expired. Please re-authenticate.",
        });
      }
      if (status === 403) {
        return reply.status(403).send({
          error: "SpotifyForbidden",
          message: spotifyError?.message ?? "Spotify denied access to this resource.",
        });
      }
      if (status === 429) {
        const retryAfter = err.response.headers?.["retry-after"] ?? "30";
        app.log.warn({ retryAfter }, "Spotify rate limited");
        return reply
          .status(429)
          .header("Retry-After", retryAfter)
          .send({
            error: "RateLimited",
            message: `Rate limited by Spotify. Retry after ${retryAfter}s.`,
            retryAfter: Number(retryAfter),
          });
      }
      if (status === 404) {
        return reply.status(404).send({
          error: "SpotifyNotFound",
          message: spotifyError?.message ?? "Resource not found on Spotify.",
        });
      }
    }

    // Determine status code
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error(error);
    } else {
      app.log.warn({ statusCode, message: err.message }, "Client error");
    }

    reply.status(statusCode).send({
      error: err.name || "InternalServerError",
      message:
        env.NODE_ENV === "production" && statusCode === 500
          ? "Internal server error"
          : err.message,
    });
  });

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`🚀 Server running on http://localhost:${env.PORT}`);
    app.log.info("📦 Scan worker started");
    app.log.info("🏷️  Enrichment worker started");
  } catch (err) {
    app.log.error(err);
    await scanWorker.close();
    await enrichmentWorker.close();
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info("Shutting down...");
    await scanWorker.close();
    await enrichmentWorker.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
