import { useState } from "react";
import { MODEL_OPTIONS } from "@/lib/settings";
import type { Provider } from "@/lib/settings";

interface Props {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  model: string;
  onModelChange: (m: string) => void;
  geminiKey: string;
  onGeminiKeyChange: (v: string) => void;
  groqKey: string;
  onGroqKeyChange: (v: string) => void;
}

const PROVIDER_INFO: Record<Provider, { label: string; keyUrl: string; placeholder: string }> = {
  gemini: {
    label: "Gemini API key",
    keyUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
  },
  groq: {
    label: "Groq API key",
    keyUrl: "https://console.groq.com/keys",
    placeholder: "gsk_…",
  },
};

export default function ApiKeyInput({
  provider,
  onProviderChange,
  model,
  onModelChange,
  geminiKey,
  onGeminiKeyChange,
  groqKey,
  onGroqKeyChange,
}: Props) {
  const [show, setShow] = useState(false);
  const info = PROVIDER_INFO[provider];
  const value = provider === "groq" ? groqKey : geminiKey;
  const onChange = provider === "groq" ? onGroqKeyChange : onGeminiKeyChange;
  const modelsForProvider = MODEL_OPTIONS.filter((m) => m.provider === provider);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium mb-2">Model</p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as Provider;
              onProviderChange(p);
              const first = MODEL_OPTIONS.find((m) => m.provider === p);
              if (first) onModelChange(first.id);
            }}
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm bg-card"
          >
            <option value="gemini">Gemini</option>
            <option value="groq">Groq</option>
          </select>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm bg-card"
          >
            {modelsForProvider.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-ink/45 mt-1.5">
          {modelsForProvider.find((m) => m.id === model)?.note}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">{info.label}</p>
          <a
            href={info.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-brand hover:underline"
          >
            Get a free key ↗
          </a>
        </div>
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={info.placeholder}
            className="w-full rounded-lg border border-ink/20 px-4 py-2 pr-16 text-sm bg-card font-mono"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink/50 hover:text-ink"
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <p className="text-xs text-ink/45 mt-1.5">
          Stored only in your browser (localStorage) and sent directly to{" "}
          {provider === "groq" ? "Groq's" : "Google's"} API — this app has no server of its own.
        </p>
      </div>
    </div>
  );
}
