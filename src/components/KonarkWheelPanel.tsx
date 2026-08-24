// Original line-art illustration inspired by the Konark Sun Temple's iconic stone wheel
// (chakra) — one of the most recognizable motifs in Odia architecture. Purely decorative,
// hidden on narrow viewports where there's no side gutter to fill.
export default function KonarkWheelPanel() {
  const spokes = Array.from({ length: 12 }, (_, i) => (i * 360) / 12);

  return (
    <div
      className="hidden 2xl:flex fixed left-0 top-0 h-screen w-[calc((100vw-42rem)/2)] max-w-[220px] items-center justify-center pointer-events-none select-none"
      aria-hidden="true"
    >
      <svg viewBox="0 0 200 400" className="w-full h-auto opacity-[0.14]" fill="none">
        <defs>
          <linearGradient id="konarkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3f6f66" />
            <stop offset="100%" stopColor="#c4a464" />
          </linearGradient>
        </defs>

        <g transform="translate(100 150)">
          <circle r="85" stroke="url(#konarkGrad)" strokeWidth="3" />
          <circle r="70" stroke="url(#konarkGrad)" strokeWidth="1.5" />
          <circle r="14" stroke="url(#konarkGrad)" strokeWidth="3" />
          {/* Beaded outer rim, echoing the carved pearl border on the real chakra */}
          {spokes.map((deg) => (
            <circle
              key={`bead-${deg}`}
              cx={85 * Math.cos((deg * Math.PI) / 180)}
              cy={85 * Math.sin((deg * Math.PI) / 180)}
              r="3.5"
              fill="url(#konarkGrad)"
            />
          ))}
          {/* Spokes */}
          {spokes.map((deg) => (
            <line
              key={`spoke-${deg}`}
              x1={14 * Math.cos((deg * Math.PI) / 180)}
              y1={14 * Math.sin((deg * Math.PI) / 180)}
              x2={70 * Math.cos((deg * Math.PI) / 180)}
              y2={70 * Math.sin((deg * Math.PI) / 180)}
              stroke="url(#konarkGrad)"
              strokeWidth="2"
            />
          ))}
        </g>

        {/* Simple lotus-petal border motif running along the bottom, another recurring
            element in Odia temple carving */}
        <g transform="translate(100 300)" stroke="url(#konarkGrad)" strokeWidth="1.5">
          {Array.from({ length: 5 }, (_, i) => i - 2).map((i) => (
            <path
              key={i}
              d={`M ${i * 22} 0 Q ${i * 22 - 10} -22 ${i * 22} -40 Q ${i * 22 + 10} -22 ${i * 22} 0 Z`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
