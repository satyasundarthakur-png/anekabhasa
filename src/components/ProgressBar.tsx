interface Props {
  completed: number;
  total: number;
}

export default function ProgressBar({ completed, total }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between text-sm text-ink/60 mb-1">
        <span>
          {completed} / {total || "…"} chunks
        </span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-ink/10 overflow-hidden">
        <div
          className="rainbow-fill h-full transition-all duration-500 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
