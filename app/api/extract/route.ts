import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { TAG_VOCAB } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The `us.` prefix is the cross-region inference profile and is REQUIRED.
 * The bare id fails with:
 *   ValidationException: Invocation of model ID anthropic.claude-haiku-4-5-...
 *   with on-demand throughput isn't supported. Retry your request with the ID
 *   or ARN of an inference profile.
 */
const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const REQUEST_TIMEOUT_MS = 9_000;
const MAX_INPUT_CHARS = 4_000;
const MAX_TAGS = 7;

/**
 * Verified working against Bedrock us-east-2 with this exact model: the
 * structured-output path returns bare JSON (no markdown fence, no prose), so
 * that is what we ship. The parser below is still defensive in case Bedrock
 * ever falls back to a fenced response.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    softSkills: {
      type: "array",
      items: { type: "string" },
      description: "4-7 soft skills",
    },
    interests: {
      type: "array",
      items: { type: "string" },
      description: "4-7 interests or domains",
    },
  },
  required: ["softSkills", "interests"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "You tag entrepreneurs for a matchmaking app that pairs people on soft skills",
  "and interests rather than resumes.",
  "",
  "Read the user's free-text blurb and extract:",
  `- softSkills: 4 to ${MAX_TAGS} interpersonal / working-style strengths`,
  `- interests: 4 to ${MAX_TAGS} domains, industries or passions they care about`,
  "",
  "CANONICAL VOCABULARY — strongly prefer these exact strings whenever a concept",
  "is close in meaning. Reuse beats novelty: matching on shared vocabulary is how",
  "this product works. Only invent a new tag when nothing in the list fits.",
  "",
  `softSkills vocabulary: ${TAG_VOCAB.softSkills.join(", ")}`,
  "",
  `interests vocabulary: ${TAG_VOCAB.interests.join(", ")}`,
  "",
  "Rules:",
  "- Copy canonical tags verbatim, including capitalization.",
  "- Infer implied strengths (e.g. a former teacher implies Mentorship, Empathy).",
  "- Never repeat a tag within a list. Never put an interest in softSkills.",
  "- Any new tag you invent must be Title Case and at most three words.",
].join("\n");

/* -------------------------------------------------------------------------- */
/* canonicalisation                                                           */
/* -------------------------------------------------------------------------- */

/** lowercase canonical tag -> exact-cased canonical tag */
function vocabIndex(list: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of list) map.set(tag.toLowerCase(), tag);
  return map;
}

const SOFT_SKILL_INDEX = vocabIndex(TAG_VOCAB.softSkills);
const INTEREST_INDEX = vocabIndex(TAG_VOCAB.interests);

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Snaps model output onto the canonical vocabulary (case-insensitively) so the
 * real user actually overlaps with the seeded personas. Non-vocab tags are kept
 * but Title Cased. Tags belonging to the *other* list's vocabulary are dropped
 * — the model occasionally files e.g. "Fundraising" under interests, and a
 * misfiled tag can never score an overlap where it landed. Dedupes and caps.
 */
function cleanTags(
  value: unknown,
  index: Map<string, string>,
  foreignIndex: Map<string, string>,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().replace(/\s+/g, " ");
    if (!trimmed || trimmed.length > 40) continue;

    const lower = trimmed.toLowerCase();
    if (!index.has(lower) && foreignIndex.has(lower)) continue;

    const canonical = index.get(lower) ?? titleCase(trimmed);
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(canonical);
    if (out.length >= MAX_TAGS) break;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** Strips markdown fences and grabs the outermost {...} before parsing. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) text = fence[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* client                                                                     */
/* -------------------------------------------------------------------------- */

let cachedClient: AnthropicBedrock | null = null;

function getClient(): AnthropicBedrock {
  if (cachedClient) return cachedClient;

  // Bedrock long-lived API key, if present. Otherwise the SDK falls through to
  // the standard AWS credential chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,
  // shared profile, instance role). Never log or echo either.
  const bearer =
    process.env.AWS_BEARER_TOKEN_BEDROCK ?? process.env.AWS_BEDROCK_API_KEY ?? undefined;

  cachedClient = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION ?? "us-east-2",
    ...(bearer ? { apiKey: bearer } : {}),
  });
  return cachedClient;
}

function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/* -------------------------------------------------------------------------- */
/* handler                                                                    */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("invalid_json", 400);
    }

    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || text.trim().length < 2) {
      return fail("missing_text", 400);
    }

    const message = await getClient().messages.create(
      {
        model: MODEL_ID,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text.trim().slice(0, MAX_INPUT_CHARS) }],
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      },
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 },
    );

    const raw = message.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!raw) return fail("empty_model_response", 502);

    const parsed = parseJsonObject(raw);
    if (!parsed) return fail("unparseable_model_response", 502);

    const softSkills = cleanTags(parsed.softSkills, SOFT_SKILL_INDEX, INTEREST_INDEX);
    const interests = cleanTags(parsed.interests, INTEREST_INDEX, SOFT_SKILL_INDEX);

    if (softSkills.length === 0 || interests.length === 0) {
      return fail("incomplete_extraction", 502);
    }

    return Response.json({ softSkills, interests });
  } catch (err) {
    // Never surface the prompt text or credentials. Log only the error shape.
    const name = err instanceof Error ? err.name : "UnknownError";
    const detail = err instanceof Error ? err.message.slice(0, 200) : "";
    console.error(`[api/extract] ${name}: ${detail}`);
    return fail("extraction_failed", 502);
  }
}
