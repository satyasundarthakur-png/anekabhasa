import { useEffect, useRef, useState } from "react";
import ApiKeyInput from "@/components/ApiKeyInput";
import Dropzone from "@/components/Dropzone";
import DomainPicker from "@/components/DomainPicker";
import LanguagePicker from "@/components/LanguagePicker";
import ProgressBar from "@/components/ProgressBar";
import KonarkWheelPanel from "@/components/KonarkWheelPanel";
import TempleSpirePanel from "@/components/TempleSpirePanel";
import { Domain, Lang } from "@/lib/gemini";
import { PipelineFailure, PipelineProgress, runTranslationPipeline } from "@/lib/pipeline";
import {
  getApiKey,
  setApiKey as saveApiKey,
  getGroqApiKey,
  setGroqApiKey as saveGroqApiKey,
  getProvider,
  setProvider as saveProvider,
  getModel,
  setModel as saveModel,
} from "@/lib/settings";
import type { Provider } from "@/lib/settings";
import { isPdfFile } from "@/lib/pdfCore";
import {
  Checkpoint,
  clearAllCheckpoints,
  clearCheckpoint,
  computeJobKey,
  listCheckpoints,
  loadCheckpoint,
} from "@/lib/checkpoint";

const LANG_LABELS: Record<Lang, string> = {
  or: "Odia",
  hi: "Hindi",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  te: "Telugu",
  bn: "Bengali",
  ta: "Tamil",
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
};

const STAGE_LABELS: Record<PipelineProgress["stage"], string> = {
  idle: "",
  parsing: "Reading document",
  ocr: "Reading scanned pages (OCR)",
  translating: "Translating",
  assembling: "Assembling final document",
  done: "Done",
  error: "Something went wrong",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(ms: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

// A checkpoint entry may represent OCR-only progress (translation hasn't started),
// translation progress, or both — this boils it down to one number for a history list.
function checkpointProgressLabel(cp: Checkpoint): string {
  const translatedCount = Object.keys(cp.completedParagraphs ?? {}).length;
  if (cp.totalChunks > 0) {
    const pct = Math.round((translatedCount / cp.totalChunks) * 100);
    return `${translatedCount}/${cp.totalChunks} chunks translated (${pct}%)`;
  }
  const ocrDone = Object.keys(cp.ocrCompletedPages ?? {}).length;
  if (cp.ocrTotalPages) {
    const pct = Math.round((ocrDone / cp.ocrTotalPages) * 100);
    return `OCR: ${ocrDone}/${cp.ocrTotalPages} pages read (${pct}%)`;
  }
  return "In progress";
}

async function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Give the browser a moment to pick up the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function App() {
  const [apiKey, setApiKeyState] = useState("");
  const [groqKey, setGroqKeyState] = useState("");
  const [provider, setProviderState] = useState<Provider>("gemini");
  const [model, setModelState] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState<Lang>("or");
  const [targetLang, setTargetLang] = useState<Lang>("hi");
  const [domain, setDomain] = useState<Domain>("literature");
  const [forceOcr, setForceOcr] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [authorName, setAuthorName] = useState("");
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: "idle",
    completed: 0,
    total: 0,
    failed: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("translated.docx");
  const [downloadSize, setDownloadSize] = useState<number>(0);
  // Set when a job fails, is stopped, or partially completes — carries a buildPartial()
  // so completed work is never just thrown away, plus enough info to explain what
  // happened and offer a real next step.
  const [partialFailure, setPartialFailure] = useState<PipelineFailure | null>(null);
  const [resumeInfo, setResumeInfo] = useState<{ completed: number; total: number } | null>(null);
  const [skipResume, setSkipResume] = useState(false);
  const [history, setHistory] = useState<Checkpoint[]>([]);

  // Lets the Stop button cancel whatever runTranslationPipeline is currently doing —
  // OCR and translation both check this between units of work.
  const abortControllerRef = useRef<AbortController | null>(null);

  function refreshHistory() {
    setHistory(listCheckpoints());
  }

  useEffect(() => {
    setApiKeyState(getApiKey());
    setGroqKeyState(getGroqApiKey());
    setProviderState(getProvider());
    setModelState(getModel());
    refreshHistory();
  }, []);

  // Whenever the file/settings that determine the job identity change, check for a
  // matching saved checkpoint so the resume banner can appear before translation even
  // starts — nobody should have to discover this only after losing progress once.
  useEffect(() => {
    setSkipResume(false);
    if (!file) {
      setResumeInfo(null);
      return;
    }
    const jobKey = computeJobKey(file, sourceLang, targetLang, domain, forceOcr);
    const cp = loadCheckpoint(jobKey);
    if (cp) {
      const translated = Object.keys(cp.completedParagraphs).length;
      const total = cp.totalChunks > 0 ? cp.totalChunks : (cp.ocrTotalPages ?? 0);
      setResumeInfo({ completed: translated, total });
    } else {
      setResumeInfo(null);
    }
  }, [file, sourceLang, targetLang, domain, forceOcr]);

  function updateApiKey(v: string) {
    setApiKeyState(v);
    saveApiKey(v);
  }

  function updateGroqKey(v: string) {
    setGroqKeyState(v);
    saveGroqApiKey(v);
  }

  function updateProvider(p: Provider) {
    setProviderState(p);
    saveProvider(p);
  }

  function updateModel(m: string) {
    setModelState(m);
    saveModel(m);
  }

  async function handleSubmit(opts: { forceNoResume?: boolean } = {}) {
    if (!file) return;
    setError(null);
    setDownloadUrl(null);
    setPartialFailure(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const activeKey = provider === "groq" ? groqKey : apiKey;
      const blob = await runTranslationPipeline(
        activeKey,
        file,
        sourceLang,
        targetLang,
        domain,
        setProgress,
        {
          forceOcr,
          fastMode,
          authorName: authorName.trim(),
          resume: opts.forceNoResume ? false : !skipResume,
          signal: controller.signal,
        },
        provider,
        model,
      );
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadSize(blob.size);
      setDownloadName(file.name.replace(/\.(docx|pdf)$/i, "") + `-${targetLang}.docx`);
      setResumeInfo(null);
    } catch (err: any) {
      if (err instanceof PipelineFailure) {
        setPartialFailure(err);
        setError(err.message);
      } else {
        setError(err?.message ?? String(err));
      }
      setProgress((p) => ({ ...p, stage: "error" }));
    } finally {
      abortControllerRef.current = null;
      refreshHistory();
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  async function handleDownloadPartial(buildPartial: () => Promise<Blob>) {
    const blob = await buildPartial();
    const name =
      (file?.name ?? "translated").replace(/\.(docx|pdf)$/i, "") + `-${targetLang}-partial.docx`;
    await downloadBlob(blob, name);
  }

  function startOver() {
    if (file) clearCheckpoint(computeJobKey(file, sourceLang, targetLang, domain, forceOcr));
    setResumeInfo(null);
    setSkipResume(true);
    setPartialFailure(null);
    setError(null);
    // Pass this explicitly rather than relying on `skipResume` state: setSkipResume(true)
    // above hasn't taken effect yet in this closure (state updates are async), so
    // handleSubmit would otherwise read the stale pre-update value and could resume from
    // a checkpoint here failed to clear (e.g. storage errors in private browsing).
    handleSubmit({ forceNoResume: true });
    refreshHistory();
  }

  function reset() {
    setFile(null);
    setError(null);
    setDownloadUrl(null);
    setPartialFailure(null);
    setResumeInfo(null);
    setSkipResume(false);
    setProgress({ stage: "idle", completed: 0, total: 0, failed: 0 });
    refreshHistory();
  }

  function removeHistoryEntry(jobKey: string) {
    clearCheckpoint(jobKey);
    refreshHistory();
  }

  function clearHistory() {
    clearAllCheckpoints();
    refreshHistory();
    setResumeInfo(null);
  }

  const isPdf = file ? isPdfFile(file) : false;
  const isBusy =
    progress.stage === "parsing" ||
    progress.stage === "ocr" ||
    progress.stage === "translating" ||
    progress.stage === "assembling";
  // Stopping mid-"parsing" (plain .docx read) or mid-"assembling" (final docx write) is
  // near-instantaneous work — the button would mostly just add clutter there. It matters
  // for the two stages that can genuinely run long: OCR and translation.
  const isStoppable = progress.stage === "ocr" || progress.stage === "translating";
  const isStoppedFailure = partialFailure?.stopped ?? false;

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-16 relative overflow-hidden">
      <div className="serene-ambient" aria-hidden="true" />
      <KonarkWheelPanel />
      <TempleSpirePanel />

      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-semibold mb-1 serene-text tracking-tight font-display">
          Anekabhasa
        </h1>
        <p className="text-ink/60 mb-10">
          Translate manuscripts and books between 14 languages — Odia, Hindi, Marathi, Gujarati,
          Kannada, Malayalam, Telugu, Bengali, Tamil, English, French, German, Spanish, and Russian
          — from a <span className="font-medium text-ink/80">.docx or .pdf</span>, whole documents,
          in one go. Pick any source language and any target language. Runs entirely in your
          browser via the Gemini API — no server, no upload to any backend.
        </p>

        {progress.stage === "idle" && (
          <>
            <Dropzone onFileSelected={setFile} selectedFile={file} />
            <p className="text-xs text-ink/45 mt-2">
              .docx gives the most reliable extraction. Scanned/image PDFs are read automatically
              with in-browser OCR; text-based PDFs use the embedded text layer unless you force OCR
              below.
            </p>

            {resumeInfo && !skipResume && (
              <div className="mt-3 rounded-xl border border-[#3f6f66]/30 bg-[#3f6f66]/5 px-4 py-3 text-xs text-ink/70">
                <p className="font-medium text-ink/80 mb-1">Found saved progress for this file</p>
                <p className="mb-2">
                  {resumeInfo.completed}/{resumeInfo.total || "?"} already done last time. Resuming
                  picks up where it left off instead of starting over.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setResumeInfo(null)}
                    className="serene-fill rounded-lg px-3 py-1.5 text-white font-medium"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (file)
                        clearCheckpoint(computeJobKey(file, sourceLang, targetLang, domain, forceOcr));
                      setSkipResume(true);
                      setResumeInfo(null);
                      refreshHistory();
                    }}
                    className="rounded-lg border border-ink/20 px-3 py-1.5 font-medium hover:border-ink/40"
                  >
                    Start over
                  </button>
                </div>
              </div>
            )}

            {isPdf && (
              <label className="mt-3 flex items-start gap-2 text-xs text-ink/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceOcr}
                  onChange={(e) => setForceOcr(e.target.checked)}
                  className="mt-0.5 accent-[#3f6f66]"
                />
                <span>
                  Force OCR for this PDF — use if the extracted text comes out with scrambled
                  diacritics from the embedded text layer. OCR reads the page visually instead,
                  which avoids that issue, but is slower and downloads a small language model
                  for {LANG_LABELS[sourceLang]} + English on first use.
                </span>
              </label>
            )}

            <div className="mt-8 space-y-6">
              <ApiKeyInput
                provider={provider}
                onProviderChange={updateProvider}
                model={model}
                onModelChange={updateModel}
                geminiKey={apiKey}
                onGeminiKeyChange={updateApiKey}
                groqKey={groqKey}
                onGroqKeyChange={updateGroqKey}
              />

              <div>
                <p className="text-sm font-medium mb-2">Translate from</p>
                <LanguagePicker value={sourceLang} onChange={setSourceLang} exclude={targetLang} />
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Translate into</p>
                <LanguagePicker value={targetLang} onChange={setTargetLang} exclude={sourceLang} />
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Domain (tunes terminology)</p>
                <DomainPicker value={domain} onChange={setDomain} />
              </div>

              <div className="rounded-xl border border-ink/10 bg-white/40 p-4 space-y-3">
                <p className="text-sm font-medium">Speed & output</p>

                <label className="flex items-start gap-2 text-xs text-ink/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fastMode}
                    onChange={(e) => setFastMode(e.target.checked)}
                    className="mt-0.5 accent-[#3f6f66]"
                  />
                  <span>
                    <span className="font-medium text-ink/80">Fast mode</span> — raises parallelism
                    for both OCR and translation (up to 2× faster on long/scanned documents).
                    Slightly reduces cross-chunk translation continuity, since the model sees less
                    of the previous chunk's finished translation before starting the next one.
                  </span>
                </label>

                <div>
                  <label className="block text-xs font-medium text-ink/70 mb-1">
                    Document author <span className="text-ink/40 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="Leave blank for a clean, unsigned file"
                    className="w-full rounded-lg border border-ink/20 px-3 py-1.5 text-sm bg-white"
                  />
                  <p className="text-[11px] text-ink/45 mt-1">
                    The output .docx never carries a software or AI signature in its file properties
                    — this field only sets an author name if you want one. Leave it blank and the
                    file's metadata stays empty.
                  </p>
                </div>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            <button
              onClick={() => handleSubmit()}
              disabled={!file || !(provider === "groq" ? groqKey : apiKey)}
              className="serene-fill mt-8 w-full rounded-xl text-white font-semibold py-3 shadow-lg shadow-black/5 disabled:opacity-40 disabled:animate-none transition-opacity hover:brightness-105"
            >
              Translate document
            </button>

            {history.length > 0 && (
              <div className="mt-10">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-ink/70">Recent jobs ({history.length})</p>
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="text-xs text-ink/45 hover:text-red-600"
                  >
                    Clear history
                  </button>
                </div>
                <div className="space-y-2">
                  {history.map((cp) => (
                    <div
                      key={cp.jobKey}
                      className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white/40 px-4 py-2.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink/80">{cp.fileName}</p>
                        <p className="text-ink/45">
                          {LANG_LABELS[cp.sourceLang ?? "or"] ?? cp.sourceLang} →{" "}
                          {LANG_LABELS[cp.targetLang] ?? cp.targetLang} ·{" "}
                          {checkpointProgressLabel(cp)} · {formatRelativeTime(cp.savedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeHistoryEntry(cp.jobKey)}
                        className="shrink-0 text-ink/40 hover:text-red-600"
                        title="Remove from history"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-ink/40 mt-2">
                  Select the same file again above to pick a job back up where it left off.
                </p>
              </div>
            )}
          </>
        )}

        {progress.stage !== "idle" && progress.stage !== "done" && (
          <div>
            <button onClick={reset} className="text-sm text-ink/50 hover:text-ink mb-4">
              ← New translation
            </button>

            <h2 className="text-2xl font-semibold mb-1">{file?.name}</h2>
            <p className="text-ink/60 mb-8">
              {STAGE_LABELS[progress.stage]}
              {progress.stage === "ocr" && progress.ocr && (
                <span className="text-ink/40">
                  {" "}
                  — page {progress.ocr.page}/{progress.ocr.totalPages} ({progress.ocr.status})
                </span>
              )}
              {progress.stage === "translating" && progress.resumedFromCheckpoint && (
                <span className="text-ink/40"> — resumed from saved progress</span>
              )}
              {progress.stage === "translating" && progress.failed > 0 && (
                <span className="text-amber-600"> · {progress.failed} chunk(s) retrying</span>
              )}
            </p>

            {isBusy && <ProgressBar completed={progress.completed} total={progress.total} />}

            <div className="mt-4 flex flex-wrap gap-2">
              {progress.stage === "translating" &&
                progress.completed > 0 &&
                progress.buildPartial && (
                  <button
                    type="button"
                    onClick={() =>
                      progress.buildPartial && handleDownloadPartial(progress.buildPartial)
                    }
                    className="serene-border rounded-xl px-5 py-2.5 text-sm font-medium hover:brightness-105"
                  >
                    Download progress so far (
                    {Math.round((progress.completed / Math.max(progress.total, 1)) * 100)}%)
                  </button>
                )}

              {isStoppable && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="rounded-xl border border-red-300 px-5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Stop (progress is saved)
                </button>
              )}
            </div>

            {progress.stage === "error" && (
              <div className="mt-4">
                <p className={`text-sm mb-3 ${isStoppedFailure ? "text-ink/70" : "text-red-600"}`}>
                  {error}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleSubmit()}
                    className="serene-fill rounded-xl px-6 py-3 font-medium text-white hover:brightness-105"
                  >
                    {isStoppedFailure
                      ? "Resume"
                      : partialFailure && partialFailure.completed > 0
                        ? "Retry remaining chunks"
                        : "Retry"}
                  </button>
                  {partialFailure &&
                    partialFailure.completed > 0 &&
                    partialFailure.stageAtStop === "translating" && (
                      <button
                        onClick={() => handleDownloadPartial(partialFailure.buildPartial)}
                        className="serene-border rounded-xl px-6 py-3 font-medium hover:brightness-105"
                      >
                        Download what's done ({partialFailure.completed}/{partialFailure.total}{" "}
                        chunks)
                      </button>
                    )}
                  <button
                    onClick={startOver}
                    className="text-sm text-ink/50 hover:text-ink px-3 py-3"
                  >
                    Start over from scratch
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {progress.stage === "done" && downloadUrl && (
          <div className="serene-border rounded-3xl p-10 text-center bg-white/60 backdrop-blur-sm shadow-xl shadow-black/5">
            <div className="serene-fill mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full shadow-lg shadow-black/10 serene-glow">
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-white" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2 className="text-2xl font-semibold serene-text mb-1 font-display">
              Translation complete
            </h2>
            <p className="text-ink/60 mb-6">
              {file?.name} →{" "}
              <span className="font-medium text-ink/80">{LANG_LABELS[targetLang]}</span>
            </p>

            <div className="mx-auto mb-7 flex max-w-sm items-center gap-3 rounded-xl border border-ink/10 bg-white/70 px-4 py-3 text-left">
              <div className="text-3xl">📄</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{downloadName}</p>
                <p className="text-xs text-ink/45">{formatBytes(downloadSize)} · Word document</p>
              </div>
            </div>

            <a
              href={downloadUrl}
              download={downloadName}
              className="serene-fill inline-flex items-center gap-2 rounded-xl text-white font-semibold px-8 py-3.5 shadow-lg shadow-black/10 hover:brightness-105 hover:scale-[1.02] transition-transform"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path
                  d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Download translated .docx
            </a>

            <div>
              <button onClick={reset} className="mt-6 text-sm text-ink/50 hover:text-ink">
                ← Translate another document
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
