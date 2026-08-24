// Direct browser -> Groq calls, mirroring gemini.ts's interface so the pipeline can swap
// providers without caring which one is actually doing the translating. Groq's API is
// OpenAI-compatible (chat/completions), unlike Gemini's generateContent shape.
import { checkAborted } from "./abort";
import { LANG_NAMES } from "./gemini";
import type { Domain, GlossaryEntry, SourceLang, TargetLang } from "./gemini";

const DEFAULT_MODEL = "openai/gpt-oss-120b";

const DOMAIN_HINTS: Record<Domain, string> = {
  spiritual:
    "This is spiritual/devotional/philosophical text — scripture, commentary, or Vedantic, Ayurvedic-philosophical, or devotional material. Preserve register, reverence, and nuance faithfully. Keep Sanskrit/Odia names of deities, texts, mantras, and philosophical terms (e.g. Brahman, Atman, Advaita) transliterated consistently rather than loosely translated, unless a standard target-language equivalent is already well established. Do not modernize, simplify, or paraphrase away subtlety.",
  literature:
    "This is literary text — poetry, prose, fiction, or narrative manuscript material. Preserve tone, voice, rhythm, and imagery; prioritize natural, idiomatic phrasing in the target language over literal word-for-word rendering, while staying faithful to meaning. Preserve figures of speech and cultural references rather than flattening them.",
  medical:
    "This is medical/clinical text — case notes, textbook material, formularies, or traditional-medicine (Ayurvedic) content. Use precise standard medical terminology in the target language; keep drug names, dosages, anatomical terms, and clinical measurements unchanged. For Ayurvedic/traditional-medicine terms without a direct clinical equivalent, keep the original term (transliterated) alongside a brief clarifying gloss on first use rather than inventing a translation.",
};

export class GroqError extends Error {
  public readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1500;

async function callGroq(
  apiKey: string,
  system: string,
  user: string,
  signal?: AbortSignal,
  model: string = DEFAULT_MODEL,
): Promise<string> {
  if (!apiKey) throw new GroqError("Missing Groq API key. Add it above before translating.");

  let lastErr: GroqError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    checkAborted(signal);
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      await sleep(delay);
      checkAborted(signal);
    }

    let res: Response;
    try {
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: signal ?? null,
      });
    } catch (networkErr) {
      if (signal?.aborted) throw networkErr;
      lastErr = new GroqError(`Network error calling Groq: ${String(networkErr)}`);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      const err = new GroqError(`Groq API error ${res.status}: ${errText}`, res.status);
      if (!isRetryableStatus(res.status)) throw err;
      lastErr = err;
      continue;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (!text) {
      lastErr = new GroqError("Groq returned an empty response");
      continue;
    }
    return text;
  }

  throw lastErr ?? new GroqError("Groq call failed after retries");
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
    if (num !== i + 1) return null;
    results.push(output.slice(start, end).trim());
  }
  return results;
}

export async function translateChunk(
  apiKey: string,
  paragraphs: string[],
  sourceLang: SourceLang,
  targetLang: TargetLang,
  domain: Domain,
  glossary: GlossaryEntry[] | null,
  previousContext: string | null,
  signal?: AbortSignal,
  model?: string,
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
    const raw = await callGroq(apiKey, system, prompt, signal, model);
    translated = parseMarkedOutput(raw, paragraphs.length);
  }

  if (!translated) {
    translated = [];
    for (const p of paragraphs) {
      const single = await callGroq(apiKey, system, `[[P1]]\n${p}`, signal, model);
      const parsed = parseMarkedOutput(single, 1);
      translated.push(parsed?.[0] ?? single.trim());
    }
  }

  return translated;
}

const MAX_GLOSSARY_SAMPLE_CHARS = 12000;

export async function buildGlossary(
  apiKey: string,
  allParagraphs: string[],
  sourceLang: SourceLang,
  targetLang: TargetLang,
  signal?: AbortSignal,
  model?: string,
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
    const raw = await callGroq(apiKey, system, sample, signal, model);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}
