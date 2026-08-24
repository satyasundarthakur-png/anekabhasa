// OCR fallback path, for PDFs that have no usable text layer — scanned pages, or pages
// exported as flattened images. Renders each page to a canvas via pdfjs, then recognizes
// it with Tesseract.js entirely in the browser (no upload anywhere).
//
// This also doubles as a manual override for text-layer PDFs whose extracted Odia comes
// out with scrambled diacritics: PDF text layers store glyphs in the order the font drew
// them, which for complex Indic shaping can differ from logical reading order, and there's
// no general way to undo that after the fact. OCR sidesteps the problem entirely because
// it reads the rendered glyphs visually and reconstructs reading order itself, the same way
// a human would.
import { createWorker } from "tesseract.js";
import { loadPdf, renderPageToCanvas } from "./pdfCore";
import type { TextBlock } from "./docxFile";
import type { SourceLang } from "./gemini";
import { checkAborted } from "./abort";

// Maps each selectable source language to its Tesseract trained-data code(s). English is
// appended as a secondary language for every non-English source (mirrors mixed-language
// reality — a lot of Indic manuscripts mix in some English/numerals), except for English
// itself where it would just be a redundant duplicate.
const OCR_LANG_BY_SOURCE: Record<SourceLang, string[]> = {
  or: ["ori", "eng"],
  hi: ["hin", "eng"],
  mr: ["mar", "eng"],
  gu: ["guj", "eng"],
  kn: ["kan", "eng"],
  ml: ["mal", "eng"],
  te: ["tel", "eng"],
  bn: ["ben", "eng"],
  ta: ["tam", "eng"],
  en: ["eng"],
  fr: ["fra", "eng"],
  de: ["deu", "eng"],
  es: ["spa", "eng"],
  ru: ["rus", "eng"],
};

// Backward-compatible default (Odia + English) for any call site that doesn't yet pass
// an explicit source language.
export const DEFAULT_OCR_LANGS = OCR_LANG_BY_SOURCE.or;

export function getOcrLangs(sourceLang: SourceLang): string[] {
  return OCR_LANG_BY_SOURCE[sourceLang] ?? DEFAULT_OCR_LANGS;
}

// Tesseract workers run in real Web Workers, so pages genuinely recognize in parallel on
// multi-core devices — this is the single biggest lever for OCR speed on longer scans.
// Kept modest by default: each worker holds its own WASM instance in memory, and after
// the first worker's language data is cached (tesseract.js uses IndexedDB), the rest just
// reuse it. Fast mode raises the pool size the same way it raises translation concurrency.
const OCR_CONCURRENCY = 3;
const OCR_FAST_CONCURRENCY = 6;

export interface OcrProgress {
  page: number;
  totalPages: number;
  status: string;
}

export interface OcrOptions {
  onProgress?: ((p: OcrProgress) => void) | undefined;
  langs?: string[] | undefined;
  // Raises OCR worker pool size, mirroring the translation stage's fast mode.
  fastMode?: boolean | undefined;
  signal?: AbortSignal | undefined;
  // Pages already recognized in a previous attempt (1-based page number -> paragraphs),
  // from a checkpoint. Skipped instead of re-recognized.
  existingPages?: Record<number, string[]> | undefined;
  // Fired the moment each new page finishes, so the caller can checkpoint progress
  // incrementally — including the page that was in flight right before a Stop.
  onPageDone?: ((pageNum: number, paragraphs: string[]) => void) | undefined;
}

function splitOcrTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/) // Tesseract separates paragraphs with blank lines.
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export async function ocrPdfToBlocks(file: File, options: OcrOptions = {}): Promise<TextBlock[]> {
  const {
    onProgress,
    langs = DEFAULT_OCR_LANGS,
    fastMode = false,
    signal,
    existingPages,
    onPageDone,
  } = options;

  const pdf = await loadPdf(file);
  const totalPages = pdf.numPages;
  const concurrencyTarget = fastMode ? OCR_FAST_CONCURRENCY : OCR_CONCURRENCY;
  const poolSize = Math.min(concurrencyTarget, totalPages);

  const pageResults: (string[] | undefined)[] = new Array(totalPages);
  if (existingPages) {
    for (const [numStr, paras] of Object.entries(existingPages)) {
      const idx = Number(numStr) - 1;
      if (idx >= 0 && idx < totalPages) pageResults[idx] = paras;
    }
  }

  // Per-worker "currently on page N" tracking, since several workers report progress
  // concurrently and the UI only needs the furthest-along page for a simple readout.
  const workerPages = new Array(poolSize).fill(0);

  function reportProgress(status: string) {
    if (!onProgress) return;
    const furthest = Math.max(...workerPages, 0);
    onProgress({ page: Math.min(furthest, totalPages), totalPages, status });
  }

  let nextPageIndex = 0; // 0-based

  async function worker(slot: number) {
    let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      while (true) {
        checkAborted(signal);
        const pageIdx = nextPageIndex++;
        if (pageIdx >= totalPages) return;
        if (pageResults[pageIdx]) continue; // already OCR'd in a previous attempt

        // Lazily spin up the Tesseract worker only once this slot actually has work to
        // do — on resume with most pages already done, a lot of slots may find nothing
        // left and return immediately without ever paying worker startup cost.
        if (!tesseractWorker) {
          tesseractWorker = await createWorker(langs, undefined, {
            logger: (m: { status: string; progress: number }) => {
              if (m.status) reportProgress(m.status);
            },
          });
        }

        const pageNum = pageIdx + 1;
        workerPages[slot] = pageNum;
        reportProgress("rendering");

        const page = await pdf.getPage(pageNum);
        const canvas = await renderPageToCanvas(page);

        const { data } = await tesseractWorker.recognize(canvas);
        const paragraphs = splitOcrTextIntoParagraphs(data.text ?? "");
        pageResults[pageIdx] = paragraphs;
        onPageDone?.(pageNum, paragraphs);
        reportProgress("done page");
      }
    } finally {
      if (tesseractWorker) await tesseractWorker.terminate();
    }
  }

  await Promise.all(Array.from({ length: poolSize }, (_, i) => worker(i)));

  // Flatten in original page order regardless of which worker finished which page when.
  const blocks: TextBlock[] = [];
  for (const paragraphs of pageResults) {
    for (const p of paragraphs ?? []) {
      blocks.push({ text: p, heading: 0 });
    }
  }

  if (blocks.length === 0) {
    throw new Error(
      "OCR could not find any recognizable text in this PDF. It may be blank, extremely low-resolution, or in a script the OCR model doesn't cover.",
    );
  }

  return blocks;
}
