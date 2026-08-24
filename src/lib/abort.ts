// Shared cooperative-cancellation primitive for the pipeline. Long-running loops (OCR
// page-by-page, translation chunk-by-chunk) check an AbortSignal between units of work
// and throw this instead of a generic Error so callers can tell "the user pressed Stop"
// apart from "something actually failed" without inspecting message strings.
export class StoppedError extends Error {
  constructor() {
    super("Stopped");
    this.name = "StoppedError";
  }
}

export function isStoppedError(err: unknown): err is StoppedError {
  return err instanceof StoppedError || (err instanceof DOMException && err.name === "AbortError");
}

export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new StoppedError();
}
