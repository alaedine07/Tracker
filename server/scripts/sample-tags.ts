import { db } from "../src/config/database";
import { trackMetadata, tracks, userTracks } from "../src/db/schema";
import { isNotNull, isNull, eq, sql } from "drizzle-orm";

async function sampleTags() {
  // Count enriched tracks with genres OR mood
  const enriched = await db
    .select({ count: sql<number>`count(*)` })
    .from(trackMetadata)
    .where(
      sql`(${trackMetadata.genres} IS NOT NULL AND array_length(${trackMetadata.genres}, 1) > 0) OR (${trackMetadata.moodTags} IS NOT NULL AND array_length(${trackMetadata.moodTags}, 1) > 0)`
    );

  const withMood = await db
    .select({ count: sql<number>`count(*)` })
    .from(trackMetadata)
    .where(
      sql`${trackMetadata.moodTags} IS NOT NULL AND array_length(${trackMetadata.moodTags}, 1) > 0`
    );

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(trackMetadata);

  console.log(`Total track_metadata rows: ${total[0].count}`);
  console.log(`Tracks with genres or mood: ${enriched[0].count}`);
  console.log(`Tracks with mood tags: ${withMood[0].count}`);

  // Show 5 tracks that DO have mood tags now
  const withMoodSample = await db
    .select({
      name: tracks.name,
      artists: tracks.artistNames,
      moodTags: trackMetadata.moodTags,
      genres: trackMetadata.genres,
    })
    .from(trackMetadata)
    .innerJoin(tracks, eq(trackMetadata.trackId, tracks.id))
    .where(sql`${trackMetadata.moodTags} IS NOT NULL AND array_length(${trackMetadata.moodTags}, 1) > 0`)
    .limit(5);

  console.log("\n--- Sample tracks WITH mood tags ---");
  for (const row of withMoodSample) {
    console.log(`"${row.name}" by ${row.artists[0]} | genres: ${row.genres?.join(", ") || "none"} | mood: ${row.moodTags?.join(", ")}`);
  }

  process.exit(0);
}

sampleTags().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
