// Free, keyless machine translation via Google Translate's public web endpoint — the same
// unauthenticated `translate_a/single` endpoint used by well-known open-source clients like
// "googletrans" and "google-translate-api". No account, no billing, no quota key. Mirrors
// gemini.ts / groq.ts's translateChunk/buildGlossary shape so the pipeline can swap this in
// as just another provider.
//
// Trade-off, stated plainly: this is raw machine translation, not an LLM. It has no concept
// of "domain" (spiritual/literature/medical), no glossary enforcement, and no cross-chunk
// continuity — each paragraph is translated independently. What it buys you is translation
// at zero cost and no signup, which is why it's offered as an explicit opt-in choice rather
// than the default.
import { checkAborted } from "./abort";
import type { Domain, GlossaryEntry, SourceLang, TargetLang } from "./gemini";

export class GoogleTranslateError extends Error {
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
const BASE_DELAY_MS = 1200;
// The free endpoint is generous but not infinite — keep well under any per-IP burst limit
// so a big manuscript doesn't get itself soft-blocked mid-run.
const CONCURRENCY = 4;
// Individual GET requests, not a batch API — there's a practical URL-length ceiling per call.
const MAX_CHARS_PER_CALL = 1800;

async function callGoogleTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!text.trim()) return text;

  let lastErr: GoogleTranslateError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    checkAborted(signal);
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      await sleep(delay);
      checkAborted(signal);
    }

    const url =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}` +
      `&dt=t&dt=bd&ie=UTF-8&oe=UTF-8&q=${encodeURIComponent(text)}`;

    let res: Response;
    try {
      res = await fetch(url, { method: "GET", signal: signal ?? null });
    } catch (networkErr) {
      if (signal?.aborted) throw networkErr;
      lastErr = new GoogleTranslateError(
        `Network error calling Google Translate: ${String(networkErr)}`,
      );
      continue;
    }

    if (!res.ok) {
      const err = new GoogleTranslateError(`Google Translate error ${res.status}`, res.status);
      if (!isRetryableStatus(res.status)) throw err;
      lastErr = err;
      continue;
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      lastErr = new GoogleTranslateError("Google Translate returned an unparsable response");
      continue;
    }

    // Response shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
    // Long input gets split into multiple sentence-ish chunks in that first array —
    // stitch them back together in order.
    const sentences = Array.isArray(data) ? (data[0] as unknown) : undefined;
    if (!Array.isArray(sentences)) {
      lastErr = new GoogleTranslateError("Google Translate returned an empty response");
      continue;
    }
    const out = sentences
      .map((s: unknown) => {
        const first = Array.isArray(s) ? (s[0] as unknown) : undefined;
        return typeof first === "string" ? first : "";
      })
      .join("");
    if (!out) {
      lastErr = new GoogleTranslateError("Google Translate returned an empty response");
      continue;
    }
    return out;
  }

  throw lastErr ?? new GoogleTranslateError("Google Translate call failed after retries");
}

// Splits a paragraph on sentence-ish boundaries so no single request exceeds
// MAX_CHARS_PER_CALL, then reassembles with the same separators it split on.
async function translateLongParagraph(
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<string> {
  if (text.length <= MAX_CHARS_PER_CALL) {
    return callGoogleTranslate(text, sourceLang, targetLang, signal);
  }
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHARS_PER_CALL) {
    let cut = rest.lastIndexOf("\n", MAX_CHARS_PER_CALL);
    if (cut < MAX_CHARS_PER_CALL * 0.4) cut = rest.lastIndexOf(" ", MAX_CHARS_PER_CALL);
    if (cut < MAX_CHARS_PER_CALL * 0.4) cut = MAX_CHARS_PER_CALL;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);

  const translatedParts: string[] = [];
  for (const part of parts) {
    translatedParts.push(await callGoogleTranslate(part, sourceLang, targetLang, signal));
  }
  return translatedParts.join("");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// Signature deliberately mirrors gemini.ts/groq.ts's translateChunk so pipeline.ts's
// engineFor() can select this module interchangeably. apiKey/domain/glossary/previousContext
// are accepted for interface parity but unused — the free endpoint takes no key and has no
// instruction-following ability.
export async function translateChunk(
  _apiKey: string,
  paragraphs: string[],
  sourceLang: SourceLang,
  targetLang: TargetLang,
  _domain: Domain,
  _glossary: GlossaryEntry[] | null,
  _previousContext: string | null,
  signal?: AbortSignal,
  _model?: string,
): Promise<string[]> {
  return mapWithConcurrency(paragraphs, CONCURRENCY, async (p) => {
    if (!p.trim()) return p;
    try {
      return await translateLongParagraph(p, sourceLang, targetLang, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      // One paragraph failing shouldn't sink the whole chunk — surface it inline the same
      // way the pipeline's own permanent-failure fallback does, so it's easy to spot and
      // retranslate later, instead of silently dropping content.
      return `[TRANSLATION FAILED — retry needed] ${p}`;
    }
  });
}

// Free MT has no glossary-extraction ability — return an empty glossary rather than
// pretending to support term consistency the engine can't actually enforce.
export async function buildGlossary(
  _apiKey: string,
  _allParagraphs: string[],
  _sourceLang: SourceLang,
  _targetLang: TargetLang,
  _signal?: AbortSignal,
  _model?: string,
): Promise<GlossaryEntry[]> {
  return [];
}
