/**
 * Generates the human-facing pairing code ("mango-hunt-rage") and turns it
 * into a room id the Durable Object namespace can key off of.
 *
 * Mirrors the idea from croc's codephrase.go: a short word-based code that's
 * easy to read aloud / paste, hashed down to an opaque room id so the literal
 * words never need to be treated as a lookup key anywhere sensitive.
 */

// Compact word list — short, unambiguous, easy to say out loud. Swap for the
// full EFF short wordlist (1296 words) before shipping to production; this
// smaller list is enough to prove the flow end-to-end.
const WORDS = [
  "mango", "hunt", "rage", "final", "yoyo", "shred", "stole", "utter", "couch",
  "river", "cloud", "daisy", "flame", "ferry", "tiger", "quiet", "spark", "north",
  "delta", "orbit", "amber", "pixel", "vapor", "coral", "elbow", "frost", "grove",
  "haste", "input", "joker", "kneel", "lemon", "mirth", "nudge", "olive", "prism",
  "quilt", "raven", "salsa", "tango", "ultra", "vivid", "wheat", "xenon", "yield",
  "zesty", "alloy", "brisk", "chirp", "dwell", "ember", "flint", "gully", "hinge",
  "index", "jolly", "knack", "lucid", "mango2", "nifty", "onset", "plumb", "quirk",
];

export function generateCode(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const w1 = pick();
  let w2 = pick();
  while (w2 === w1) w2 = pick();
  let w3 = pick();
  while (w3 === w1 || w3 === w2) w3 = pick();
  return `${w1}-${w2}-${w3}`;
}

/** Hash the full code down to a stable, opaque room id (hex sha-256). */
export async function codeToRoomId(code: string): Promise<string> {
  const normalized = code.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
