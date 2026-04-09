/**
 * Genre normalization: maps free-text Last.fm tags to a controlled taxonomy.
 * Uses lowercase matching + fuzzy alias mapping.
 */

// Canonical genre taxonomy
const GENRE_ALIASES: Record<string, string> = {
  // Rock
  rock: "Rock",
  "alternative rock": "Alternative Rock",
  "alt rock": "Alternative Rock",
  "alt-rock": "Alternative Rock",
  "indie rock": "Indie Rock",
  "indie-rock": "Indie Rock",
  "classic rock": "Classic Rock",
  "hard rock": "Hard Rock",
  "progressive rock": "Progressive Rock",
  "prog rock": "Progressive Rock",
  "psychedelic rock": "Psychedelic Rock",
  "garage rock": "Garage Rock",
  "post-rock": "Post-Rock",
  "post rock": "Post-Rock",
  "stoner rock": "Stoner Rock",
  "southern rock": "Southern Rock",
  "soft rock": "Soft Rock",
  "punk rock": "Punk Rock",
  grunge: "Grunge",

  // Metal
  metal: "Metal",
  "heavy metal": "Heavy Metal",
  "death metal": "Death Metal",
  "black metal": "Black Metal",
  "thrash metal": "Thrash Metal",
  "doom metal": "Doom Metal",
  metalcore: "Metalcore",
  "progressive metal": "Progressive Metal",
  "prog metal": "Progressive Metal",
  "nu metal": "Nu Metal",
  "nu-metal": "Nu Metal",

  // Punk
  punk: "Punk",
  "post-punk": "Post-Punk",
  "post punk": "Post-Punk",
  "pop punk": "Pop Punk",
  "pop-punk": "Pop Punk",
  hardcore: "Hardcore",
  "post-hardcore": "Post-Hardcore",
  "post hardcore": "Post-Hardcore",
  emo: "Emo",
  screamo: "Screamo",

  // Pop
  pop: "Pop",
  "indie pop": "Indie Pop",
  "synth pop": "Synth Pop",
  "synthpop": "Synth Pop",
  "synth-pop": "Synth Pop",
  "dream pop": "Dream Pop",
  "chamber pop": "Chamber Pop",
  "art pop": "Art Pop",
  "electropop": "Electropop",
  "power pop": "Power Pop",
  "k-pop": "K-Pop",
  "kpop": "K-Pop",
  "j-pop": "J-Pop",
  "jpop": "J-Pop",

  // Electronic
  electronic: "Electronic",
  electronica: "Electronic",
  edm: "EDM",
  house: "House",
  "deep house": "Deep House",
  techno: "Techno",
  trance: "Trance",
  "drum and bass": "Drum and Bass",
  "drum & bass": "Drum and Bass",
  dnb: "Drum and Bass",
  "d&b": "Drum and Bass",
  dubstep: "Dubstep",
  ambient: "Ambient",
  idm: "IDM",
  downtempo: "Downtempo",
  "trip-hop": "Trip-Hop",
  "trip hop": "Trip-Hop",
  chillout: "Chillout",
  "chill out": "Chillout",
  chillwave: "Chillwave",
  synthwave: "Synthwave",
  retrowave: "Synthwave",
  vaporwave: "Vaporwave",
  "lo-fi": "Lo-Fi",
  lofi: "Lo-Fi",

  // Hip-Hop & R&B
  "hip-hop": "Hip-Hop",
  "hip hop": "Hip-Hop",
  hiphop: "Hip-Hop",
  rap: "Hip-Hop",
  "r&b": "R&B",
  rnb: "R&B",
  "rhythm and blues": "R&B",
  soul: "Soul",
  "neo-soul": "Neo-Soul",
  "neo soul": "Neo-Soul",
  funk: "Funk",
  trap: "Trap",

  // Jazz
  jazz: "Jazz",
  "smooth jazz": "Smooth Jazz",
  "acid jazz": "Acid Jazz",
  "jazz fusion": "Jazz Fusion",
  fusion: "Jazz Fusion",
  bebop: "Bebop",

  // Blues
  blues: "Blues",
  "electric blues": "Electric Blues",
  "delta blues": "Delta Blues",

  // Country & Folk
  country: "Country",
  folk: "Folk",
  "indie folk": "Indie Folk",
  "folk rock": "Folk Rock",
  americana: "Americana",
  bluegrass: "Bluegrass",
  singer: "Singer-Songwriter",
  "singer-songwriter": "Singer-Songwriter",
  "singer songwriter": "Singer-Songwriter",

  // Classical
  classical: "Classical",
  orchestral: "Orchestral",
  "modern classical": "Modern Classical",
  "neo-classical": "Neoclassical",
  neoclassical: "Neoclassical",
  opera: "Opera",
  baroque: "Baroque",

  // World
  latin: "Latin",
  reggae: "Reggae",
  reggaeton: "Reggaeton",
  ska: "Ska",
  afrobeat: "Afrobeat",
  afrobeats: "Afrobeats",
  bossa: "Bossa Nova",
  "bossa nova": "Bossa Nova",
  celtic: "Celtic",
  flamenco: "Flamenco",
  world: "World",

  // Other
  experimental: "Experimental",
  "noise": "Noise",
  industrial: "Industrial",
  new: "New Wave",
  "new wave": "New Wave",
  shoegaze: "Shoegaze",
  "math rock": "Math Rock",
  "math-rock": "Math Rock",
  gospel: "Gospel",
  disco: "Disco",
  "nu-disco": "Nu-Disco",
  "nu disco": "Nu-Disco",
};

// Mood-related tags to separate from genres
const MOOD_TAGS = new Set([
  // Calm / Relaxed
  "chill", "relax", "relaxing", "relaxation", "mellow", "calm", "peaceful", "soothing",
  "laid back", "laid-back", "easy listening", "soft", "gentle", "quiet", "serene", "tranquil",
  // Energetic / Upbeat
  "energetic", "upbeat", "happy", "feel good", "feel-good", "party",
  "dance", "danceable", "groovy", "funky", "bouncy", "lively", "fun", "playful",
  "quirky", "catchy", "anthemic", "euphoric", "euphoria", "hype",
  // Sad / Dark
  "sad", "melancholy", "melancholic", "dark", "moody", "brooding",
  "depressing", "depressed", "tearjerker", "heartbreak", "heartbreaking",
  "lonely", "loneliness", "sorrow", "sorrowful", "gloomy", "bleak",
  // Aggressive / Intense
  "aggressive", "angry", "intense", "heavy", "powerful",
  "raw", "brutal", "fierce", "hard", "loud",
  // Romantic / Sensual
  "romantic", "love", "sexy", "sensual", "passionate", "tender", "intimate",
  // Atmospheric / Dreamy
  "atmospheric", "dreamy", "ethereal", "hypnotic", "psychedelic",
  "spacey", "space", "meditative", "introspective", "reflective", "contemplative",
  "beautiful", "lush", "warm", "cool",
  // Cinematic / Epic
  "epic", "cinematic", "dramatic", "majestic", "anthemic", "grandiose",
  // Nostalgic
  "nostalgic", "bittersweet", "wistful", "retro", "vintage",
  // Motivational
  "motivational", "inspirational", "uplifting", "empowering", "triumphant",
  // Eerie
  "haunting", "eerie", "creepy", "mysterious", "ominous",
  // Context / Situation
  "summer", "winter", "rainy", "sunny", "night", "late night", "morning", "driving",
  "workout", "gym", "running", "study", "focus", "concentration",
  "sleep", "bedtime",
  // Emotional descriptors common on Last.fm
  "emotional", "emotive", "sentimental", "feel", "feeling", "feelgood",
  "smooth", "sophisticated", "classy", "elegant",
  "slow", "fast", "uptempo", "downtempo",
  "political", "protest", "rebellious",
]);

/**
 * Normalize a single tag to its canonical genre form.
 * Returns null if the tag doesn't map to a known genre.
 */
export function normalizeGenre(tag: string): string | null {
  const lower = tag.toLowerCase().trim();
  return GENRE_ALIASES[lower] ?? null;
}

/**
 * Check if a tag is a mood tag
 */
export function isMoodTag(tag: string): boolean {
  return MOOD_TAGS.has(tag.toLowerCase().trim());
}

/**
 * Process a list of Last.fm tags and separate into normalized genres and mood tags.
 * Uses a lower threshold for mood tags since Last.fm assigns them lower relevance scores.
 */
export function classifyTags(
  tags: { name: string; count: number }[],
  minGenreCount = 10,
  minMoodCount = 1
): { genres: string[]; moodTags: string[] } {
  const genres = new Set<string>();
  const moodTags = new Set<string>();

  for (const tag of tags) {
    const lower = tag.name.toLowerCase().trim();

    // Check mood first (with lower threshold)
    if (tag.count >= minMoodCount && isMoodTag(lower)) {
      moodTags.add(lower);
      continue;
    }

    // Try genre normalization (with standard threshold)
    if (tag.count >= minGenreCount) {
      const normalized = normalizeGenre(lower);
      if (normalized) {
        genres.add(normalized);
      }
    }
  }

  return {
    genres: [...genres],
    moodTags: [...moodTags],
  };
}
