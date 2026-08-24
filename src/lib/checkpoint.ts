// Persists in-progress (and recently-finished) translation jobs to localStorage as they
// progress, so a tab crash, accidental reload, a hard failure, or a deliberate Stop
// partway through a large book doesn't throw away everything already done. On a later
// attempt with the same file and settings, the pipeline picks this up and only does
// what's left.
//
// Multi-slot: keeps a small rolling history of recent jobs (keyed by jobKey) rather than
// a single overwritten slot, so starting a new file doesn't erase progress on a different
// one you might come back to. Oldest entries are evicted once the cap is exceeded.
import type { Domain, GlossaryEntry, SourceLang, TargetLang } from "./gemini";

const STORAGE_KEY = "anekabhasa.checkpoints.v2";
const OLD_SINGLE_SLOT_KEY = "anekabhasa.checkpoint.v1";

// At least a handful of recent jobs are kept around automatically.
export const MAX_HISTORY_ENTRIES = 8;

// A cap so a truly enormous book (or several of them) can't blow past localStorage's
// ~5-10MB per-origin quota. Comfortably covers books in the hundreds of pages; if
// exceeded, checkpointing for that save is skipped silently rather than breaking the
// translation itself.
const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;

export interface Checkpoint {
  jobKey: string;
  fileName: string;
  fileSize: number;
  // Optional for backward compatibility with checkpoints saved before source-language
  // selection existed — those were always Odia.
  sourceLang?: SourceLang;
  targetLang: TargetLang;
  domain: Domain;
  totalChunks: number;
  // Sparse: only chunks that finished translating successfully are present. Permanently
  // failed chunks are tracked separately in failedIndices, not here.
  completedParagraphs: Record<number, string[]>;
  failedIndices: number[];
  glossary: GlossaryEntry[] | null;
  // OCR progress, kept separately so a Stop mid-OCR (before any translation has started)
  // still saves something worth resuming. Sparse by page number (1-based).
  ocrTotalPages?: number;
  ocrCompletedPages?: Record<number, string[]>;
  // What stage the job was in the last time it was saved / stopped, purely for the
  // history list's display — not used to drive resume logic.
  lastStage?: "ocr" | "translating" | "done";
  savedAt: number;
}

// Cheap proxy for "is this the same file with the same settings" without re-reading and
// hashing the whole file content — name + size + lastModified is a reliable enough
// fingerprint in practice for this purpose.
export function computeJobKey(
  file: File,
  sourceLang: SourceLang,
  targetLang: TargetLang,
  domain: Domain,
  forceOcr: boolean,
): string {
  return [
    file.name,
    file.size,
    file.lastModified,
    sourceLang,
    targetLang,
    domain,
    forceOcr ? "ocr" : "text",
  ].join("|");
}

function readAll(): Checkpoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: Checkpoint[]): void {
  try {
    // Newest first; cap the count. If we're still over budget in bytes, drop the oldest
    // entries one at a time rather than losing the save entirely.
    let sorted = [...entries].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_HISTORY_ENTRIES);
    while (sorted.length > 0) {
      const serialized = JSON.stringify(sorted);
      if (serialized.length <= MAX_CHECKPOINT_BYTES * 2) {
        localStorage.setItem(STORAGE_KEY, serialized);
        return;
      }
      sorted = sorted.slice(0, -1);
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or unavailable (private browsing, etc.) — checkpointing is a
    // nice-to-have, never let it interrupt the actual translation.
  }
}

// One-time migration from the old single-slot format, so anyone with an in-flight job
// from before this change doesn't lose it.
function migrateLegacySlot(): void {
  try {
    const raw = localStorage.getItem(OLD_SINGLE_SLOT_KEY);
    if (!raw) return;
    localStorage.removeItem(OLD_SINGLE_SLOT_KEY);
    const legacy = JSON.parse(raw) as Checkpoint;
    if (!legacy?.jobKey) return;
    const entries = readAll();
    if (entries.some((e) => e.jobKey === legacy.jobKey)) return;
    writeAll([...entries, legacy]);
  } catch {
    // ignore — a failed migration just means that one old job isn't resumable
  }
}

export function loadCheckpoint(jobKey: string): Checkpoint | null {
  migrateLegacySlot();
  const entries = readAll();
  return entries.find((e) => e.jobKey === jobKey) ?? null;
}

export function saveCheckpoint(checkpoint: Checkpoint): void {
  const serializedSingle = JSON.stringify(checkpoint);
  if (serializedSingle.length > MAX_CHECKPOINT_BYTES) return; // silently skip, don't break the run
  const entries = readAll().filter((e) => e.jobKey !== checkpoint.jobKey);
  writeAll([...entries, checkpoint]);
}

export function clearCheckpoint(jobKey: string): void {
  const entries = readAll().filter((e) => e.jobKey !== jobKey);
  writeAll(entries);
}

export function clearAllCheckpoints(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OLD_SINGLE_SLOT_KEY);
  } catch {
    // ignore
  }
}

// Newest first, for a history panel.
export function listCheckpoints(): Checkpoint[] {
  migrateLegacySlot();
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}
