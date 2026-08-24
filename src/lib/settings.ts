// All state lives in the browser now — there's no backend to hold secrets for us.
// The Gemini API key is supplied by the user and kept only in localStorage on their
// own device; it's sent directly from the browser to Google's API on each request.
const STORAGE_KEY = "anekabhasa.gemini_api_key";

export function getApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setApiKey(key: string): void {
  if (key) {
    localStorage.setItem(STORAGE_KEY, key);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
