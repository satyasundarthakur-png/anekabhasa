import { useCallback, useState } from "react";
import { isPdfFile } from "@/lib/pdfCore";

interface Props {
  onFileSelected: (file: File) => void;
  selectedFile: File | null;
}

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".docx") || name.endsWith(".pdf");
}

export default function Dropzone({ onFileSelected, selectedFile }: Props) {
  const [dragOver, setDragOver] = useState(false);
  // Tracked via pointer events (not CSS :hover) so the glow shows up reliably on touch
  // devices too, where :hover is either unreliable or never fires at all.
  const [active, setActive] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && isSupportedFile(file)) onFileSelected(file);
    },
    [onFileSelected],
  );

  const showGlow = active || dragOver;

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onPointerDown={() => setActive(true)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      tabIndex={0}
      className={`rainbow-glow-ring ${showGlow ? "is-active" : ""} flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-16 text-center cursor-pointer transition-all duration-300 ${
        dragOver
          ? "border-transparent rainbow-border bg-white/40 scale-[1.01]"
          : "border-ink/20 hover:border-ink/40"
      }`}
    >
      <input
        type="file"
        accept=".docx,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
        }}
      />
      <div className="text-4xl">{selectedFile && isPdfFile(selectedFile) ? "📕" : "📄"}</div>
      {selectedFile ? (
        <>
          <p className="font-medium">{selectedFile.name}</p>
          <p className="text-sm text-ink/50">Click or drop to replace</p>
        </>
      ) : (
        <>
          <p className="font-medium">Drop your .docx or .pdf here</p>
          <p className="text-sm text-ink/50">or click to browse — full-length books supported</p>
        </>
      )}
    </label>
  );
}
