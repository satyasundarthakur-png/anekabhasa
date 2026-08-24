// Direct browser -> Gemini calls. No Supabase, no edge functions, no Hugging Face —
// this is the entire translation engine now.
import { checkAborted } from "./abort";

// A single shared language set used for BOTH the source and target side of a job. Any
// language here can be the source, translated into any other language here as the
// target — the pipeline itself doesn't care which side is which, it just needs a name
// and a script hint for whichever role a given language is playing in a given job.
export type Lang =
  | "or"
  | "hi"
  | "mr"
  | "gu"
  | "kn"
  | "ml"
  | "te"
  | "bn"
  | "ta"
  | "fr"
  | "de"
  | "es"
  | "ru"
  | "en";
// Kept as aliases (rather than replaced) so existing call sites and imports elsewhere in
// the app that refer to SourceLang/TargetLang keep working unchanged.
export type SourceLang = Lang;
export type TargetLang = Lang;
export type Domain = "spiritual" | "literature" | "medical";

export interface GlossaryEntry {
  source: string;
  target: string;
}

export const LANG_NAMES: Record<Lang, string> = {
  or: "Odia (Odia script)",
  hi: "Hindi (Devanagari script)",
  mr: "Marathi (Devanagari script)",
  gu: "Gujarati (Gujarati script)",
  kn: "Kannada (Kannada script)",
  ml: "Malayalam (Malayalam script)",
  te: "Telugu (Telugu script)",
  bn: "Bengali (Bengali script)",
  ta: "Tamil (Tamil script)",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian (Cyrillic script)",
  en: "English",
};

const DOMAIN_HINTS: Record<Domain, string> = {
  spiritual:
    "This is spiritual/devotional/philosophical text — scripture, commentary, or Vedantic, Ayurvedic-philosophical, or devotional material. Preserve register, reverence, and nuance faithfully. Keep Sanskrit/Odia names of deities, texts, mantras, and philosophical terms (e.g. Brahman, Atman, Advaita) transliterated consistently rather than loosely translated, unless a standard target-language equivalent is already well established. Do not modernize, simplify, or paraphrase away subtlety.",
  literature:
    "This is literary text — poetry, prose, fiction, or narrative manuscript material. Preserve tone, voice, rhythm, and imagery; prioritize natural, idiomatic phrasing in the target language over literal word-for-word rendering, while staying faithful to meaning. Preserve figures of speech and cultural references rather than flattening them.",
  medical:
    "This is medical/clinical text — case notes, textbook material, formularies, or traditional-medicine (Ayurvedic) content. Use precise standard medical terminology in the target language; keep drug names, dosages, anatomical terms, and clinical measurements unchanged. For Ayurvedic/traditional-medicine terms without a direct clinical equivalent, keep the original term (transliterated) alongside a brief clarifying gloss on first use rather than inventing a translation.",
};

const MODEL = "gemini-2.5-flash";

export class GeminiError extends Error {
  public readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function isRetryableStatus(status: number): boolean {
  // 429 = rate limit / quota, 500/502/503/504 = transient server-side failure. Everything
  // else (400 bad request, 401/403 bad key) is not going to fix itself on retry.
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1500;

async function callGemini(
  apiKey: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!apiKey) throw new GeminiError("Missing Gemini API key. Add it above before translating.");

  let lastErr: GeminiError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    checkAborted(signal);
    if (attempt > 0) {
      // Exponential backoff with a little jitter, so a burst of concurrent chunks that all
      // hit a rate limit at once don't all retry in lockstep and hit it again immediately.
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      await sleep(delay);
      checkAborted(signal);
    }

    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(
          apiKey,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: { temperature: 0.2 },
          }),
          signal: signal ?? null,
        },
      );
    } catch (networkErr) {
      if (signal?.aborted) throw networkErr; // propagate the abort itself, don't retry it as a network blip
      // Network-level failure (offline, DNS, CORS blip) — worth retrying the same way as
      // a transient server error.
      lastErr = new GeminiError(`Network error calling Gemini: ${String(networkErr)}`);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      const err = new GeminiError(`Gemini API error ${res.status}: ${errText}`, res.status);
      if (!isRetryableStatus(res.status)) throw err;
      lastErr = err;
      continue;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    if (!text) {
      lastErr = new GeminiError("Gemini returned an empty response");
      continue;
    }
    return text;
  }

  throw lastErr ?? new GeminiError("Gemini call failed after retries");
}

function buildTranslatePrompt(
  paragraphs: string[],
  sourceLang: SourceLang,
  targetLang: TargetLang,
  domain: Domain,
  glossary: GlossaryEntry[] | null,
  previousContext: string | null,
) {
  const sourceLangName = LANG_NAMES[sourceLang] ?? "Odia (Odia script)";
  const langName = LANG_NAMES[targetLang] ?? "Hindi (Devanagari script)";
  const domainHint = DOMAIN_HINTS[domain] ?? DOMAIN_HINTS.literature;
  const marked = paragraphs.map((p, i) => `[[P${i + 1}]]\n${p}`).join("\n\n");

  const glossaryBlock =
    glossary && glossary.length > 0
      ? `\nUse this glossary consistently — these exact renderings for these terms, every time they appear:\n${glossary
          .map((g) => `- ${g.source} → ${g.target}`)
          .join("\n")}\n`
      : "";

  const contextBlock = previousContext
    ? `\nFor continuity, here is the END of the previously translated section (context only — do not re-translate or repeat it):\n"""${previousContext}"""\n`
    : "";

  const system = `You are a professional ${sourceLangName}-to-${langName} translator.
${domainHint}${glossaryBlock}${contextBlock}
Translate the given ${sourceLangName} text faithfully and naturally into ${langName}.
The input is split into numbered paragraph blocks marked [[P1]], [[P2]], etc.
Your output MUST contain the exact same markers, in the exact same order, one per paragraph,
with only the translated paragraph text after each marker. Do not merge, split, skip, reorder,
add, or omit any paragraph. Do not add headers, notes, explanations, or commentary.
Output ONLY the marked translated paragraphs, nothing else.`;

  return { system, user: marked };
}

function parseMarkedOutput(output: string, expectedCount: number): string[] | null {
  const markerRegex = /\[\[P(\d+)\]\]/g;
  const matches = [...output.matchAll(markerRegex)];
  if (matches.length !== expectedCount) return null;

  const results: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    const start = cur.index! + cur[0].length;
    const end = next ? next.index! : output.length;
    const num = parseInt(cur[1] ?? "0", 10);
    if (num !== i + 1) return null; // out of order
    results.push(output.slice(start, end).trim());
  }
  return results;
}

// Translates one chunk (a batch of paragraphs). Falls back to paragraph-by-paragraph
// translation if the marker-based batch response ever comes back malformed.
export async function translateChunk(
  apiKey: string,
  paragraphs: string[],
  sourceLang: SourceLang,
  targetLang: TargetLang,
  domain: Domain,
  glossary: GlossaryEntry[] | null,
  previousContext: string | null,
  signal?: AbortSignal,
): Promise<string[]> {
  const { system, user } = buildTranslatePrompt(
    paragraphs,
    sourceLang,
    targetLang,
    domain,
    glossary,
    previousContext,
  );

  let translated: string[] | null = null;
  for (let attempt = 0; attempt < 2 && !translated; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nREMINDER: output exactly ${paragraphs.length} markers [[P1]]..[[P${paragraphs.length}]], one per paragraph, no extra text.`;
    const raw = await callGemini(apiKey, system, prompt, signal);
    translated = parseMarkedOutput(raw, paragraphs.length);
  }

  if (!translated) {
    translated = [];
    for (const p of paragraphs) {
      const single = await callGemini(apiKey, system, `[[P1]]\n${p}`, signal);
      const parsed = parseMarkedOutput(single, 1);
      translated.push(parsed?.[0] ?? single.trim());
    }
  }

  return translated;
}

const MAX_GLOSSARY_SAMPLE_CHARS = 12000;

// One cheap call up front: scans a representative sample of the document and asks Gemini
// for a consistent glossary of proper nouns / recurring terms, which then gets injected
// into every chunk's translation prompt. This is what stops the same name being rendered
// three different ways across a long manuscript.
export async function buildGlossary(
  apiKey: string,
  allParagraphs: string[],
  sourceLang: SourceLang,
  targetLang: TargetLang,
  signal?: AbortSignal,
): Promise<GlossaryEntry[]> {
  const sourceLangName = LANG_NAMES[sourceLang] ?? "Odia";
  const langName = LANG_NAMES[targetLang] ?? "Hindi";

  let sample = "";
  for (const p of allParagraphs) {
    if (sample.length + p.length > MAX_GLOSSARY_SAMPLE_CHARS) break;
    sample += p + "\n";
  }
  if (!sample.trim()) return [];

  const system = `You extract a translation glossary from ${sourceLangName} source text.
Identify proper nouns (people, places, deities, texts) and recurring technical/domain terms
that should be translated the SAME way every time they appear. For each, give a single
consistent ${langName} rendering. Respond ONLY with a JSON array like:
[{"source": "...", "target": "..."}, ...]
Keep it to the most important 15-40 terms. No commentary, no markdown fences, just the JSON array.`;

  try {
    const raw = await callGemini(apiKey, system, sample, signal);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    // Glossary failure is non-fatal — translation proceeds without it.
    return [];
  }
}
