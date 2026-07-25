import type { MatchResult, Profile, SeedPersona } from "@/lib/types";
import { SEED_PERSONAS } from "@/lib/seed";

export interface RankedMatch extends MatchResult {
  normalized: number;
}

function depluralize(word: string): string {
  // Only a lone trailing "s" is a plural — "fitness" and "decisiveness" must survive intact.
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

export function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(depluralize)
    .join(" ");
}

function sharedTags(mine: string[], theirs: string[]): string[] {
  const mineNormalized = new Set(mine.map(normalizeTag));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of theirs) {
    const key = normalizeTag(tag);
    if (mineNormalized.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

// Soft skills count double: matching on how someone works is the whole pitch,
// versus the résumé-shaped networking this is meant to replace.
export function matchScore(me: Profile, other: Profile): number {
  return (
    sharedTags(me.softSkills, other.softSkills).length * 2 +
    sharedTags(me.interests, other.interests).length
  );
}

export function rankMatches(
  me: Profile,
  personas: SeedPersona[] = SEED_PERSONAS,
): RankedMatch[] {
  const scored: MatchResult[] = personas.map((person) => {
    const sharedSkills = sharedTags(me.softSkills, person.softSkills);
    const sharedInterests = sharedTags(me.interests, person.interests);
    return {
      person,
      sharedSkills,
      sharedInterests,
      score: sharedSkills.length * 2 + sharedInterests.length,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const max = scored[0].score;
  const min = scored[scored.length - 1].score;
  const span = max - min;

  return scored.map((match) => ({
    ...match,
    normalized: span === 0 ? 1 : (match.score - min) / span,
  }));
}
