import { db } from "../src/config/database";
import { trackMetadata } from "../src/db/schema";
import { classifyTags } from "../src/utils/genreNormalization";
import { isNotNull, eq } from "drizzle-orm";

async function reclassify() {
  const rows = await db
    .select({
      trackId: trackMetadata.trackId,
      lastfmTags: trackMetadata.lastfmTags,
    })
    .from(trackMetadata)
    .where(isNotNull(trackMetadata.lastfmTags));

  console.log(`Total tracks with stored tags: ${rows.length}`);

  let updatedMoods = 0;
  let updatedGenres = 0;

  for (const row of rows) {
    if (!row.lastfmTags || !Array.isArray(row.lastfmTags)) continue;

    const tags = row.lastfmTags as { name: string; count: number }[];
    const { genres, moodTags } = classifyTags(tags);

    await db
      .update(trackMetadata)
      .set({
        genres: genres.length > 0 ? genres : null,
        moodTags: moodTags.length > 0 ? moodTags : null,
        enrichedAt: new Date(),
      })
      .where(eq(trackMetadata.trackId, row.trackId));

    if (moodTags.length > 0) updatedMoods++;
    if (genres.length > 0) updatedGenres++;
  }

  console.log(`Tracks with genres: ${updatedGenres}`);
  console.log(`Tracks with mood tags: ${updatedMoods}`);
  console.log("Done!");
  process.exit(0);
}

reclassify().catch((err) => {
  console.error("Reclassify failed:", err);
  process.exit(1);
});
