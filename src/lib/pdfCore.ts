// Shared pdfjs-dist bootstrapping. Kept in its own module so both text-layer extraction
// (pdfFile.ts) and OCR page rendering (ocr.ts) configure the worker exactly once.
import * as pdfjsLib from "pdfjs-dist";
// Vite-friendly worker import: bundles the pdf.js worker as a same-origin asset URL.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib };

// Single source of truth for "is this a PDF" — used by the dropzone, the app UI, and the
// pipeline dispatcher, so the check (extension + MIME type) can't drift between them.
export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
}

export async function loadPdf(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

// Renders a pdfjs page to an in-memory canvas, used as OCR input for scanned/image pages.
// Upscaled beyond the page's native size (default PDF resolution is low, ~72–96dpi
// equivalent) since Tesseract's accuracy drops sharply on small text.
export async function renderPageToCanvas(page: any, targetScale = 2.5): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: targetScale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context for PDF page rendering");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}
