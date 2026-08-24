// Extracts text from a .pdf entirely in the browser, producing the same TextBlock[] shape
// that docxFile.ts produces from a .docx — so the rest of the pipeline (chunking,
// translation, reassembly into a translated .docx) doesn't need to care which kind of file
// the text originally came from.
//
// Two extraction paths:
//   1. Text layer (via pdfjs-dist) — fast, exact, used whenever the PDF actually has one.
//   2. OCR (via Tesseract.js, ocr.ts) — used automatically when a PDF turns out to be
//      scanned/image-only (no usable text layer), or when the caller forces it.
import { loadPdf } from "./pdfCore";
import { getOcrLangs, ocrPdfToBlocks } from "./ocr";
import type { OcrProgress } from "./ocr";
import type { TextBlock } from "./docxFile";
import type { SourceLang } from "./gemini";
import { checkAborted } from "./abort";

// Below this average character count per page, a PDF is treated as having no real text
// layer (either genuinely empty or scanned/image-only) and OCR is used instead.
const MIN_AVG_CHARS_PER_PAGE = 20;

// Groups a page's text items into paragraphs using vertical gaps between lines as the
// paragraph boundary signal (PDFs have no explicit paragraph markup like docx does).
function groupItemsIntoParagraphs(
  items: { str: string; y: number; fontHeight: number }[],
): string[] {
  if (items.length === 0) return [];

  const lines: { text: string; y: number; fontHeight: number }[] = [];
  let currentLine: { str: string; y: number; fontHeight: number }[] = [items[0]!];

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!;
    const cur = items[i]!;
    // Same line if y is close relative to font size; otherwise start a new line.
    if (Math.abs(cur.y - prev.y) < Math.max(prev.fontHeight, cur.fontHeight) * 0.5) {
      currentLine.push(cur);
    } else {
      lines.push({
        text: currentLine
          .map((it) => it.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        y: currentLine[0]!.y,
        fontHeight: currentLine[0]!.fontHeight,
      });
      currentLine = [cur];
    }
  }
  lines.push({
    text: currentLine
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    y: currentLine[0]!.y,
    fontHeight: currentLine[0]!.fontHeight,
  });

  const nonEmpty = lines.filter((l) => l.text.length > 0);

  const paragraphs: string[] = [];
  let buffer: string[] = [];
  for (let i = 0; i < nonEmpty.length; i++) {
    const line = nonEmpty[i]!;
    buffer.push(line.text);
    const next = nonEmpty[i + 1];
    if (next) {
      const gap = Math.abs(line.y - next.y);
      // A gap noticeably larger than one line's height signals a paragraph break.
      if (gap > line.fontHeight * 1.6) {
        paragraphs.push(buffer.join(" ").replace(/\s+/g, " ").trim());
        buffer = [];
      }
    }
  }
  if (buffer.length > 0) paragraphs.push(buffer.join(" ").replace(/\s+/g, " ").trim());

  // NFC-normalize: cheap, safe cleanup for combining-mark ordering that Unicode
  // normalization *can* fix. It won't repair full visual/logical glyph-order swaps (that's
  // a font-shaping issue, not a normalization issue) — OCR mode is the real fix for those.
  return paragraphs.filter(Boolean).map((p) => p.normalize("NFC"));
}

async function extractTextLayerBlocks(
  file: File,
): Promise<{ blocks: TextBlock[]; pageCount: number }> {
  const pdf = await loadPdf(file);
  const blocks: TextBlock[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const items = content.items
      .map((it: any) => ({
        str: typeof it.str === "string" ? it.str : "",
        y: it.transform?.[5] ?? 0,
        fontHeight: Math.abs(it.transform?.[3] ?? it.height ?? 10) || 10,
      }))
      .filter((it) => it.str.trim().length > 0);

    const paragraphs = groupItemsIntoParagraphs(items);
    for (const p of paragraphs) {
      blocks.push({ text: p, heading: 0 });
    }
  }

  return { blocks, pageCount: pdf.numPages };
}

export interface ParsePdfOptions {
  // Which language the document is written in — selects the right Tesseract trained
  // data for OCR. Defaults to Odia if not given, for backward compatibility.
  sourceLang?: SourceLang | undefined;
  // Skip text-layer extraction entirely and OCR every page — for scanned PDFs, or for
  // text-layer PDFs whose source-language text comes out with scrambled diacritic order.
  forceOcr?: boolean | undefined;
  onOcrProgress?: ((p: OcrProgress) => void) | undefined;
  // Raises OCR worker concurrency, same trade-off as translation's fast mode.
  fastMode?: boolean | undefined;
  signal?: AbortSignal | undefined;
  // OCR pages already recognized in a previous (stopped/failed) attempt on this same
  // file, keyed by 1-based page number — skipped instead of re-recognized.
  existingOcrPages?: Record<number, string[]> | undefined;
  onOcrPageDone?: ((pageNum: number, paragraphs: string[]) => void) | undefined;
}

export async function parsePdfToBlocks(
  file: File,
  options: ParsePdfOptions = {},
): Promise<TextBlock[]> {
  const ocrOptions = {
    onProgress: options.onOcrProgress,
    langs: getOcrLangs(options.sourceLang ?? "or"),
    fastMode: options.fastMode,
    signal: options.signal,
    existingPages: options.existingOcrPages,
    onPageDone: options.onOcrPageDone,
  };

  if (options.forceOcr) {
    return ocrPdfToBlocks(file, ocrOptions);
  }

  checkAborted(options.signal);
  const { blocks, pageCount } = await extractTextLayerBlocks(file);

  const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);
  const avgCharsPerPage = pageCount > 0 ? totalChars / pageCount : 0;

  if (avgCharsPerPage < MIN_AVG_CHARS_PER_PAGE) {
    // No usable text layer — most likely a scanned/image-only PDF. Fall back to OCR
    // automatically rather than making the user discover and toggle a setting.
    return ocrPdfToBlocks(file, ocrOptions);
  }

  return blocks;
}
