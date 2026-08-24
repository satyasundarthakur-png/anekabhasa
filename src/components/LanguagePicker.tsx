import { Lang } from "../lib/gemini";

const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "or", label: "Odia" },
  { value: "hi", label: "Hindi" },
  { value: "mr", label: "Marathi" },
  { value: "gu", label: "Gujarati" },
  { value: "kn", label: "Kannada" },
  { value: "ml", label: "Malayalam" },
  { value: "te", label: "Telugu" },
  { value: "bn", label: "Bengali" },
  { value: "ta", label: "Tamil" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ru", label: "Russian" },
];

export { LANGUAGES };

interface Props {
  value: Lang;
  onChange: (v: Lang) => void;
  // Optional: hide one language from the list (e.g. hide the currently-chosen source
  // language from the target picker, and vice versa) so the same language can't be
  // picked on both sides at once.
  exclude?: Lang;
}

export default function LanguagePicker({ value, onChange, exclude }: Props) {
  const languages = exclude ? LANGUAGES.filter((l) => l.value !== exclude) : LANGUAGES;

  return (
    <div className="flex flex-wrap gap-2">
      {languages.map((lang) => (
        <button
          key={lang.value}
          type="button"
          onClick={() => onChange(lang.value)}
          className={`px-4 py-2 rounded-full text-sm font-medium border transition-all duration-300 ${
            value === lang.value
              ? "rainbow-fill text-white border-transparent shadow-md shadow-black/5 scale-105"
              : "border-ink/20 text-ink/70 hover:border-ink/40"
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
