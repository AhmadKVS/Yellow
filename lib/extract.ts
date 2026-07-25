import { localExtract } from "@/lib/localExtract";

export interface ExtractResult {
  softSkills: string[];
  interests: string[];
  source: "ai" | "local";
}

const REQUEST_TIMEOUT_MS = 12_000;
// The onboarding shimmer needs long enough to read as a deliberate AI moment
// rather than a flash, even when the local fallback answers instantly.
const MIN_ELAPSED_MS = 1_000;

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

async function requestAiTags(text: string): Promise<ExtractResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) return null;

    const record = data as Record<string, unknown>;
    const softSkills = cleanTags(record.softSkills);
    const interests = cleanTags(record.interests);
    if (softSkills.length === 0 || interests.length === 0) return null;

    return { softSkills, interests, source: "ai" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractTags(text: string): Promise<ExtractResult> {
  const startedAt = Date.now();

  const fallback: ExtractResult = { ...localExtract(text), source: "local" };
  const result = (await requestAiTags(text)) ?? fallback;

  const remaining = MIN_ELAPSED_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  return result;
}
