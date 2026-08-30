// All state lives in the browser now — there's no backend to hold secrets for us.
// API keys are supplied by the user and kept only in localStorage on their own device;
// they're sent directly from the browser to the provider's API on each request.
const GEMINI_KEY = "anekabhasa.gemini_api_key";
const GROQ_KEY = "anekabhasa.groq_api_key";
const PROVIDER_KEY = "anekabhasa.provider";
const MODEL_KEY = "anekabhasa.model";

export type Provider = "gemini" | "groq" | "google";

export interface ModelOption {
  provider: Provider;
  id: string;
  label: string;
  note: string;
}

// Kept short and curated on purpose — these are the models worth surfacing in the
// dropdown, not an exhaustive mirror of each provider's catalog.
export const MODEL_OPTIONS: ModelOption[] = [
  {
    provider: "gemini",
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    note: "Balanced default",
  },
  {
    provider: "gemini",
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    note: "Fastest, cheapest Gemini",
  },
  {
    provider: "groq",
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    note: "Groq's latest free model, 131K context",
  },
  {
    provider: "google",
    id: "google-translate-free",
    label: "Google Translate (Free, no key)",
    note: "Unlimited, zero-cost machine translation — no glossary or domain tuning",
  },
];

export function getApiKey(): string {
  return localStorage.getItem(GEMINI_KEY) ?? "";
}

export function setApiKey(key: string): void {
  if (key) {
    localStorage.setItem(GEMINI_KEY, key);
  } else {
    localStorage.removeItem(GEMINI_KEY);
  }
}

export function getGroqApiKey(): string {
  return localStorage.getItem(GROQ_KEY) ?? "";
}

export function setGroqApiKey(key: string): void {
  if (key) {
    localStorage.setItem(GROQ_KEY, key);
  } else {
    localStorage.removeItem(GROQ_KEY);
  }
}

export function getProvider(): Provider {
  const v = localStorage.getItem(PROVIDER_KEY);
  if (v === "groq" || v === "google") return v;
  return "gemini";
}

export function setProvider(p: Provider): void {
  localStorage.setItem(PROVIDER_KEY, p);
}

export function getModel(): string {
  const stored = localStorage.getItem(MODEL_KEY);
  const provider = getProvider();
  const validForProvider = MODEL_OPTIONS.some((m) => m.id === stored && m.provider === provider);
  if (stored && validForProvider) return stored;
  return MODEL_OPTIONS.find((m) => m.provider === provider)!.id;
}

export function setModel(id: string): void {
  localStorage.setItem(MODEL_KEY, id);
}
