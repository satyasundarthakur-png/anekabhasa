// Original line-art illustration inspired by the curved shikhara (Rekha Deula tower) form
// found across Odia temple architecture — most famously the Jagannath Temple in Puri, with
// its crowning Nilachakra disc and flag. Purely decorative, hidden on narrow viewports.
export default function TempleSpirePanel() {
  return (
    <div
      className="hidden 2xl:flex fixed right-0 top-0 h-screen w-[calc((100vw-42rem)/2)] max-w-[220px] items-center justify-center pointer-events-none select-none"
      aria-hidden="true"
    >
      <svg viewBox="0 0 200 400" className="w-full h-auto opacity-[0.14]" fill="none">
        <defs>
          <linearGradient id="templeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c4a464" />
            <stop offset="100%" stopColor="#3f6f66" />
          </linearGradient>
        </defs>

        {/* Flag atop the spire */}
        <line x1="100" y1="30" x2="100" y2="55" stroke="url(#templeGrad)" strokeWidth="2" />
        <path d="M 100 32 L 122 40 L 100 48 Z" fill="url(#templeGrad)" opacity="0.9" />

        {/* Nilachakra-style disc below the flag */}
        <circle cx="100" cy="62" r="10" stroke="url(#templeGrad)" strokeWidth="2.5" />
        {Array.from({ length: 8 }, (_, i) => (i * 360) / 8).map((deg) => (
          <line
            key={deg}
            x1={100 + 3 * Math.cos((deg * Math.PI) / 180)}
            y1={62 + 3 * Math.sin((deg * Math.PI) / 180)}
            x2={100 + 10 * Math.cos((deg * Math.PI) / 180)}
            y2={62 + 10 * Math.sin((deg * Math.PI) / 180)}
            stroke="url(#templeGrad)"
            strokeWidth="1.5"
          />
        ))}

        {/* Curved rekha-deula tower body, tapering outward toward the base */}
        <path
          d="M 100 76
             C 90 100, 86 130, 84 165
             C 81 210, 74 250, 62 290
             L 138 290
             C 126 250, 119 210, 116 165
             C 114 130, 110 100, 100 76 Z"
          stroke="url(#templeGrad)"
          strokeWidth="2.5"
          fill="url(#templeGrad)"
          fillOpacity="0.07"
        />

        {/* Horizontal carved bands (pidha-style ledges) running up the tower */}
        {[100, 130, 160, 190, 220, 250, 280].map((y) => {
          const t = (y - 76) / (290 - 76);
          const width = 16 + t * 42;
          return (
            <line
              key={y}
              x1={100 - width / 2}
              y1={y}
              x2={100 + width / 2}
              y2={y}
              stroke="url(#templeGrad)"
              strokeWidth="1.25"
              opacity="0.8"
            />
          );
        })}

        {/* Temple base / plinth */}
        <rect x="55" y="290" width="90" height="14" stroke="url(#templeGrad)" strokeWidth="2" />
        <rect x="45" y="304" width="110" height="10" stroke="url(#templeGrad)" strokeWidth="2" />

        {/* Pattachitra-inspired zigzag border beneath, echoing traditional scroll-painting
            borders used throughout Odia decorative art */}
        <polyline
          points="30,340 45,325 60,340 75,325 90,340 105,325 120,340 135,325 150,340 165,325 170,340"
          stroke="url(#templeGrad)"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}
