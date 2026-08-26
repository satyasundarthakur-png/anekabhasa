// Runs entirely in the browser: mammoth reads the uploaded .docx into HTML, we split
// that into paragraph blocks (with heading level), and the "docx" package rebuilds a
// fresh translated .docx from the reassembled paragraphs. Replaces the old
// parse-docx / assemble-docx Supabase edge functions.
import mammoth from "mammoth/mammoth.browser.js";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";

export interface TextBlock {
  text: string;
  heading: number; // 0 = body paragraph, 1-6 = heading level
}

const CHUNK_CHAR_BUDGET = 8000;

export interface Chunk {
  paragraphs: string[];
  headings: number[];
}

export async function parseDocxToBlocks(file: File): Promise<TextBlock[]> {
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  const blocks: TextBlock[] = [];
  const blockRegex = /<(h[1-6]|p)[^>]*>(.*?)<\/\1>/gis;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const tag = (m[1] ?? "").toLowerCase();
    const text = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    const heading = tag.startsWith("h") ? parseInt(tag.slice(1), 10) : 0;
    blocks.push({ text, heading });
  }

  if (blocks.length === 0) throw new Error("No text extracted from document");
  return blocks;
}

// Batches blocks into char-budget chunks, never splitting a paragraph across chunks.
export function chunkBlocks(blocks: TextBlock[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk = { paragraphs: [], headings: [] };
  let currentLen = 0;

  for (const b of blocks) {
    if (currentLen + b.text.length > CHUNK_CHAR_BUDGET && current.paragraphs.length > 0) {
      chunks.push(current);
      current = { paragraphs: [], headings: [] };
      currentLen = 0;
    }
    current.paragraphs.push(b.text);
    current.headings.push(b.heading);
    currentLen += b.text.length;
  }
  if (current.paragraphs.length > 0) chunks.push(current);

  return chunks;
}

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

export interface DocxMetadata {
  // Explicit empty string, not omitted — omitting lets the "docx" package fall back to its
  // own default of "Un-named", which is just as much a giveaway of tooling as a real name.
  creator?: string;
  title?: string;
}

// Rebuilds a .docx Blob from translated chunks (paragraphs + heading levels), in order.
export async function buildDocx(
  translatedChunks: { paragraphs: string[]; headings: number[] }[],
  metadata: DocxMetadata = {},
): Promise<Blob> {
  const paragraphs: Paragraph[] = [];
  for (const chunk of translatedChunks) {
    chunk.paragraphs.forEach((text, i) => {
      const headingNum = chunk.headings[i] ?? 0;
      const level = headingNum ? HEADING_MAP[headingNum] : undefined;
      paragraphs.push(level ? new Paragraph({ text, heading: level }) : new Paragraph({ text }));
    });
  }

  const creator = metadata.creator ?? "";
  const doc = new Document({
    creator,
    lastModifiedBy: creator,
    title: metadata.title ?? "",
    description: "",
    subject: "",
    keywords: "",
    sections: [{ children: paragraphs }],
  });
  return Packer.toBlob(doc);
}
