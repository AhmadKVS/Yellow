/**
 * Apple Contacts monogram grammar: first initial of the first word plus first
 * initial of the last word when a surname exists ("Ahmad Noori" → "AN"),
 * single initial otherwise ("Ahmad" → "A"). Used everywhere an avatar has no
 * photo, so every surface must derive the same letters — import this, never
 * reimplement it.
 */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));

  if (words.length === 0) return '•';

  const first = [...words[0]][0]?.toUpperCase() ?? '';
  if (words.length === 1) return first;

  const last = [...words[words.length - 1]][0]?.toUpperCase() ?? '';
  return `${first}${last}`;
}
