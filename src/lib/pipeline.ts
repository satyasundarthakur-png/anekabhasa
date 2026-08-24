import * as geminiEngine from "./gemini";
import * as groqEngine from "./groq";
import type { Domain, GlossaryEntry, SourceLang, TargetLang } from "./gemini";
import type { Provider } from "./settings";

// Both engines expose the same shape (translateChunk / buildGlossary), so the provider
// choice is just which module we point at — the rest of the pipeline doesn't need to care.
function engineFor(provider: Provider) {
  return provider === "groq" ? groqEngine : geminiEngine;
}
import { buildDocx, chunkBlocks, parseDocxToBlocks } from "./docxFile";
import type { Chunk, TextBlock } from "./docxFile";
import { parsePdfToBlocks } from "./pdfFile";
import { isPdfFile } from "./pdfCore";
import { stripInvisibleMarksFromAll } from "./sanitize";
import { clearCheckpoint, computeJobKey, loadCheckpoint, saveCheckpoint } from "./checkpoint";
import type { Checkpoint } from "./checkpoint";
import type { OcrProgress } from "./ocr";
import { checkAborted, isStoppedError } from "./abort";

export type Stage = "idle" | "parsing" | "ocr" | "translating" | "assembling" | "done" | "error";

export interface PipelineProgress {
  stage: Stage;
  completed: number;
  total: number;
  failed: number;
  error?: string;
  resumedFromCheckpoint?: boolean;
  // Only populated while stage === "ocr".
  ocr?: OcrProgress;
  // Available from the moment translation starts: builds a .docx from whatever has
  // finished translating so far. Safe to call at any time, including mid-run — this is
  // what lets someone download progress at 25%/50%/whatever without waiting for the whole
  // (possibly very long) job to finish, and it's what a failure/stop handler falls back to
  // instead of discarding completed work.
  buildPartial?: () => Promise<Blob>;
}

export interface PipelineOptions {
  // Skip text-layer extraction and OCR the whole PDF instead — see pdfFile.ts.
  forceOcr?: boolean;
  // Raises translation AND OCR concurrency (see the *_FAST_CONCURRENCY constants below).
  // Trades a little cross-chunk continuity during translation — the model sees less of
  // the previous chunk's already-finished translation before starting the next one — for
  // meaningfully faster completion on long documents.
  fastMode?: boolean;
  // .docx "creator"/"last modified by" metadata. Left blank (the default) the output file
  // carries no author/software signature at all — docx-js's own default of "Un-named" is
  // deliberately overridden rather than left in place. Set this if you *want* your name on
  // the file; leave it blank for a clean, unattributed document.
  authorName?: string;
  // Resume from a matching localStorage checkpoint if one exists (default true). Set false
  // to force a clean restart even if a checkpoint is present.
  resume?: boolean;
  // Lets the caller stop the run cooperatively (e.g. a "Stop" button). Checked between
  // OCR pages and between translation chunks; whatever finished before the signal fired is
  // already checkpointed, so the run can be resumed later.
  signal?: AbortSignal | undefined;
}

export class PipelineFailure extends Error {
  public readonly buildPartial: () => Promise<Blob>;
  public readonly completed: number;
  public readonly failed: number;
  public readonly total: number;
  // True when this was thrown because the caller stopped the run (via `signal`), rather
  // than because something actually went wrong.
  public readonly stopped: boolean;
  // Which stage was in flight when this was thrown — the UI uses this to decide whether
  // a "download what's done" affordance makes sense (nothing to download yet if this
  // happened during OCR, before any chunk has been translated).
  public readonly stageAtStop: Stage;

  constructor(
    message: string,
    buildPartial: () => Promise<Blob>,
    completed: number,
    failed: number,
    total: number,
    extra: { stopped?: boolean; stageAtStop?: Stage } = {},
  ) {
    super(message);
    this.buildPartial = buildPartial;
    this.completed = completed;
    this.failed = failed;
    this.total = total;
    this.stopped = extra.stopped ?? false;
    this.stageAtStop = extra.stageAtStop ?? "translating";
  }
}

// Gemini reads the previous chunk's translated tail for continuity, so a small
// concurrency window means more chunks actually see that context land in time.
const STANDARD_CONCURRENCY = 3;
const FAST_CONCURRENCY = 6;

// A chunk gets this many attempts (on top of translateChunk's own internal marker-mismatch
// retry) before it's given up on and marked failed — at that point the rest of the job
// keeps going rather than aborting everything.
const MAX_CHUNK_ATTEMPTS = 2;

interface ParseAllOptions {
  forceOcr: boolean;
  fastMode: boolean;
  signal?: AbortSignal | undefined;
  existingOcrPages?: Record<number, string[]> | undefined;
  onOcrPageDone?: ((pageNum: number, paragraphs: string[]) => void) | undefined;
}

interface ParseAllOptionsWithLang extends ParseAllOptions {
  sourceLang: SourceLang;
}

async function parseAnyToBlocks(
  file: File,
  options: ParseAllOptionsWithLang,
  onProgress: (p: PipelineProgress) => void,
): Promise<TextBlock[]> {
  if (!isPdfFile(file)) return parseDocxToBlocks(file);

  return parsePdfToBlocks(file, {
    sourceLang: options.sourceLang,
    forceOcr: options.forceOcr,
    fastMode: options.fastMode,
    signal: options.signal,
    existingOcrPages: options.existingOcrPages,
    onOcrPageDone: options.onOcrPageDone,
    onOcrProgress: (ocr) => {
      onProgress({
        stage: "ocr",
        completed: ocr.page - 1,
        total: ocr.totalPages,
        failed: 0,
        ocr,
      });
    },
  });
}

// Chunks that permanently failed keep their original (untranslated) text in the output,
// clearly flagged, rather than silently vanishing — so a partial download is always
// complete in structure, just with a few marked gaps to revisit.
function withFailureFallback(chunk: Chunk): string[] {
  return chunk.paragraphs.map((p) => `[UNTRANSLATED — retry needed] ${p}`);
}

async function unavailablePartial(): Promise<Blob> {
  throw new Error("Nothing has been translated yet — resume the job to continue, then download.");
}

export async function runTranslationPipeline(
  apiKey: string,
  file: File,
  sourceLang: SourceLang,
  targetLang: TargetLang,
  domain: Domain,
  onProgress: (p: PipelineProgress) => void,
  options: PipelineOptions = {},
  provider: Provider = "gemini",
  model?: string,
): Promise<Blob> {
  const signal = options.signal;
  const forceOcr = options.forceOcr ?? false;
  const fastMode = options.fastMode ?? false;
  const { buildGlossary, translateChunk } = engineFor(provider);

  // Computed up front (doesn't need parsed content) so OCR progress can be checkpointed
  // under the same key translation progress will use later.
  const jobKey = computeJobKey(file, sourceLang, targetLang, domain, forceOcr);
  const priorCheckpoint = (options.resume ?? true) ? loadCheckpoint(jobKey) : null;

  const ocrPagesSoFar: Record<number, string[]> = { ...(priorCheckpoint?.ocrCompletedPages ?? {}) };
  let ocrTotalPagesSoFar = priorCheckpoint?.ocrTotalPages ?? 0;

  function persistOcrCheckpoint() {
    const cp: Checkpoint = {
      jobKey,
      fileName: file.name,
      fileSize: file.size,
      sourceLang,
      targetLang,
      domain,
      totalChunks: priorCheckpoint?.totalChunks ?? 0,
      completedParagraphs: priorCheckpoint?.completedParagraphs ?? {},
      failedIndices: priorCheckpoint?.failedIndices ?? [],
      glossary: priorCheckpoint?.glossary ?? null,
      ocrTotalPages: ocrTotalPagesSoFar,
      ocrCompletedPages: ocrPagesSoFar,
      lastStage: "ocr",
      savedAt: Date.now(),
    };
    saveCheckpoint(cp);
  }

  onProgress({ stage: "parsing", completed: 0, total: 0, failed: 0 });

  let blocks: TextBlock[];
  try {
    blocks = await parseAnyToBlocks(
      file,
      {
        sourceLang,
        forceOcr,
        fastMode,
        signal,
        existingOcrPages: Object.keys(ocrPagesSoFar).length > 0 ? ocrPagesSoFar : undefined,
        onOcrPageDone: (pageNum, paragraphs) => {
          ocrPagesSoFar[pageNum] = paragraphs;
          persistOcrCheckpoint();
        },
      },
      (p) => {
        if (p.ocr) ocrTotalPagesSoFar = p.ocr.totalPages;
        onProgress(p);
      },
    );
  } catch (err) {
    if (isStoppedError(err)) {
      const completedPages = Object.keys(ocrPagesSoFar).length;
      throw new PipelineFailure(
        completedPages > 0
          ? `Stopped — ${completedPages} of ${ocrTotalPagesSoFar || "?"} page(s) already read are saved. Resume to pick up where OCR left off.`
          : "Stopped before any pages were read.",
        unavailablePartial,
        0,
        0,
        0,
        { stopped: true, stageAtStop: "ocr" },
      );
    }
    throw err;
  }

  const chunks: Chunk[] = chunkBlocks(blocks);
  const total = chunks.length;

  const checkpoint =
    priorCheckpoint && priorCheckpoint.totalChunks === total ? priorCheckpoint : null;
  const resumed = checkpoint !== null;

  onProgress({
    stage: "translating",
    completed: 0,
    total,
    failed: 0,
    resumedFromCheckpoint: resumed,
  });

  let glossary: GlossaryEntry[] | null = resumed ? (checkpoint!.glossary ?? null) : null;
  if (!resumed) {
    // Kicked off but not awaited: the first wave of chunks starts translating in parallel
    // with the glossary call rather than waiting on it — see the earlier note on this
    // trade-off. Skipped entirely on resume since a checkpointed glossary is reused as-is.
    buildGlossary(
      apiKey,
      blocks.map((b) => b.text),
      sourceLang,
      targetLang,
      signal,
      model,
    ).then((g) => {
      glossary = g;
    });
  }

  const translatedParagraphsByChunk: (string[] | undefined)[] = new Array(total);
  const failedIndices = new Set<number>();

  if (resumed) {
    for (const [idxStr, paras] of Object.entries(checkpoint!.completedParagraphs)) {
      translatedParagraphsByChunk[Number(idxStr)] = paras;
    }
    // Deliberately NOT carrying forward checkpoint.failedIndices as a permanent skip list —
    // the whole point of resuming is to retry what didn't make it last time. Only slots that
    // actually succeeded are pre-filled; anything else (failed or never attempted) is left
    // undefined so the worker loop below picks it up fresh.
  }

  function persistCheckpoint() {
    const completedParagraphs: Record<number, string[]> = {};
    translatedParagraphsByChunk.forEach((paras, i) => {
      if (paras) completedParagraphs[i] = paras;
    });
    const cp: Checkpoint = {
      jobKey,
      fileName: file.name,
      fileSize: file.size,
      sourceLang,
      targetLang,
      domain,
      totalChunks: total,
      completedParagraphs,
      failedIndices: [...failedIndices],
      glossary,
      lastStage: "translating",
      savedAt: Date.now(),
    };
    saveCheckpoint(cp);
  }

  async function buildPartial(): Promise<Blob> {
    const translatedChunks = chunks.map((c, i) => ({
      paragraphs: translatedParagraphsByChunk[i] ?? withFailureFallback(c),
      headings: c.headings,
    }));
    return buildDocx(translatedChunks, {
      creator: options.authorName ?? "",
      title: file.name.replace(/\.(docx|pdf)$/i, ""),
    });
  }

  function completedCount(): number {
    return translatedParagraphsByChunk.filter(Boolean).length;
  }

  function reportProgress() {
    onProgress({
      stage: "translating",
      completed: completedCount(),
      total,
      failed: failedIndices.size,
      resumedFromCheckpoint: resumed,
      buildPartial,
    });
  }

  let nextIndex = 0;

  async function worker() {
    while (true) {
      checkAborted(signal);
      const i = nextIndex++;
      if (i >= total) return;
      if (translatedParagraphsByChunk[i] || failedIndices.has(i)) continue; // already done (resume)

      let previousContext: string | null = null;
      const prevParas = i > 0 ? translatedParagraphsByChunk[i - 1] : undefined;
      if (prevParas) {
        previousContext = prevParas[prevParas.length - 1]?.slice(-500) ?? null;
      }

      let lastErr: unknown = null;
      let succeeded = false;
      for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS && !succeeded; attempt++) {
        try {
          const translated = await translateChunk(
            apiKey,
            chunks[i]!.paragraphs,
            sourceLang,
            targetLang,
            domain,
            glossary,
            previousContext,
            signal,
            model,
          );
          translatedParagraphsByChunk[i] = stripInvisibleMarksFromAll(translated);
          succeeded = true;
        } catch (err) {
          if (isStoppedError(err)) throw err; // a deliberate stop is not a retryable failure
          lastErr = err;
        }
      }

      if (!succeeded) {
        failedIndices.add(i);
        console.error(`Chunk ${i} failed after ${MAX_CHUNK_ATTEMPTS} attempts:`, lastErr);
      }

      persistCheckpoint();
      reportProgress();
    }
  }

  const concurrency = fastMode ? FAST_CONCURRENCY : STANDARD_CONCURRENCY;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  } catch (err) {
    if (isStoppedError(err)) {
      throw new PipelineFailure(
        completedCount() > 0
          ? `Stopped — ${completedCount()} of ${total} chunk(s) already translated are saved. Resume to continue, or download what's done.`
          : "Stopped before any chunks finished translating.",
        buildPartial,
        completedCount(),
        failedIndices.size,
        total,
        { stopped: true, stageAtStop: "translating" },
      );
    }
    throw err;
  }

  if (completedCount() === 0) {
    throw new PipelineFailure(
      "Every chunk failed to translate — check your API key and connection.",
      buildPartial,
      0,
      failedIndices.size,
      total,
    );
  }

  if (failedIndices.size > 0) {
    // Partial success: don't throw the work away. The checkpoint is left in place (not
    // cleared) so a retry picks up only the failed chunks instead of starting over.
    throw new PipelineFailure(
      `${failedIndices.size} of ${total} chunk(s) failed to translate after retries. The rest completed — download what's done, or try again to retry just the failed parts.`,
      buildPartial,
      completedCount(),
      failedIndices.size,
      total,
    );
  }

  onProgress({ stage: "assembling", completed: total, total, failed: 0 });

  const blob = await buildPartial();
  clearCheckpoint(jobKey);
  onProgress({ stage: "done", completed: total, total, failed: 0 });
  return blob;
}
