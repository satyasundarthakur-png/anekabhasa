import { useState } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function ApiKeyInput({ value, onChange }: Props) {
  const [show, setShow] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium">Gemini API key</p>
        <a
          href="https://aistudio.google.com/apikey"
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
          placeholder="AIza…"
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
        Stored only in your browser (localStorage) and sent directly to Google's API — this app has
        no server of its own.
      </p>
    </div>
  );
}
