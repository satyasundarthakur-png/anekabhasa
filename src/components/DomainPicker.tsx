import { Domain } from "../lib/gemini";

const DOMAINS: { value: Domain; label: string }[] = [
  { value: "spiritual", label: "Spiritual / Devotional" },
  { value: "literature", label: "Literature" },
  { value: "medical", label: "Medical" },
];

interface Props {
  value: Domain;
  onChange: (v: Domain) => void;
}

export default function DomainPicker({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Domain)}
      className="rounded-lg border border-ink/20 px-4 py-2 text-sm bg-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3f6f66]/40 focus-visible:border-transparent"
    >
      {DOMAINS.map((d) => (
        <option key={d.value} value={d.value}>
          {d.label}
        </option>
      ))}
    </select>
  );
}
