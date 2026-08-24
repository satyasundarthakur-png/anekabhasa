import manuscript from "@/assets/banner-manuscript.jpg";
import calligraphy from "@/assets/banner-calligraphy.jpg";
import motif from "@/assets/banner-motif.jpg";

const SOURCES = { manuscript, calligraphy, motif } as const;

export type BannerTheme = keyof typeof SOURCES;

/**
 * Thin themed image banner used to separate functional blocks. Kept low-contrast and
 * short so it reads as a divider, never as content — bilingual labels stay legible on
 * top thanks to the paper-tinted scrim.
 */
export default function SectionBanner({
  theme,
  label,
  labelAlt,
  className = "",
}: {
  theme: BannerTheme;
  label: string;
  labelAlt?: string;
  className?: string;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-ink/10 h-16 sm:h-20 ${className}`}
    >
      <img
        src={SOURCES[theme]}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        width={1200}
        height={400}
        className="absolute inset-0 h-full w-full object-cover opacity-35 saturate-50 transition-all duration-700 ease-out group-hover:opacity-60 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-paper via-paper/70 to-paper/20 transition-opacity duration-700 group-hover:opacity-80" />
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100"
        style={{ background: "var(--serene-gradient)", mixBlendMode: "soft-light" }}
        aria-hidden="true"
      />
      <div className="relative flex h-full items-center gap-3 px-4 sm:px-5">
        <span className="h-px w-6 bg-ink/25" aria-hidden="true" />
        <p className="text-xs sm:text-sm font-medium tracking-wide text-ink/75 font-display">
          {label}
          {labelAlt && (
            <span className="ml-2 text-ink/45 font-sans font-normal">{labelAlt}</span>
          )}
        </p>
      </div>
    </div>
  );
}
