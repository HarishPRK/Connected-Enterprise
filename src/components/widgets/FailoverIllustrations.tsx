type IllustrationProps = { tint: string };

type GatewayIllustrationProps = IllustrationProps & {
  okColor: string;
  warnColor: string;
};

/** Front elevation of the edge gateway; local bounds x ±46, y −24…24. */
export function GatewayIllustration({
  tint,
  okColor,
  warnColor,
}: GatewayIllustrationProps) {
  return (
    <g fill="none" stroke={tint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M-31-2v-8l-4-13M0-2v-22M31-2v-8l4-13" strokeWidth={2.2} />
      <path d="M-38-23h6M-3-24h6M32-23h6" />
      <rect x={-40} y={-2} width={80} height={26} rx={4} fill={tint} fillOpacity={0.09} />
      <path d="M-40 5h80M-40 17h80" strokeOpacity={0.4} />
      <path d="M-40 3h-6v17h6M40 3h6v17h-6" />
      <path d="M-31 10h7M-31 13h7" strokeOpacity={0.65} />
      <circle cx={-19} cy={11.5} r={2.1} fill={okColor} stroke="none" />
      <circle cx={-11} cy={11.5} r={2.1} fill={okColor} stroke="none" />
      <circle cx={-3} cy={11.5} r={2.1} fill={warnColor} stroke="none" />
      <circle cx={5} cy={11.5} r={2.1} fill={okColor} stroke="none" />
      <circle cx={13} cy={11.5} r={2.1} fill={okColor} stroke="none" />
      <circle cx={21} cy={11.5} r={2.1} fill={okColor} stroke="none" />
      <path d="M29 9v5M33 9v5" strokeOpacity={0.65} />
      {[-29, -13, 3, 19].map((x) => (
        <g key={x}>
          <rect x={x} y={18.5} width={11} height={4.5} rx={0.8} fill={tint} fillOpacity={0.15} />
          <path d={`M${x + 3} 19v2M${x + 5.5} 19v2M${x + 8} 19v2`} strokeWidth={1.2} strokeOpacity={0.65} />
        </g>
      ))}
    </g>
  );
}

/** Duplex optical connectors and their fiber strands; x ±46, y ±21. */
export function FiberIllustration({ tint }: IllustrationProps) {
  return (
    <g fill="none" stroke={tint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M-17-10h15C9-10 10-18 23-18h15M-17 10h15C9 10 10 18 23 18h15" strokeOpacity={0.55} />
      <path d="M-17-10h15C11-10 12 0 24 0h14M-17 10h15C11 10 12 0 24 0h14" strokeWidth={2} />
      {[-10, 10].map((y) => (
        <g key={y}>
          <rect x={-41} y={y - 7} width={20} height={14} rx={2} fill={tint} fillOpacity={0.12} />
          <path d={`M-41 ${y - 4}h-5v8h5M-21 ${y - 4}h5v8h-5M-35 ${y - 7}v14M-30 ${y - 3}h5M-30 ${y + 1}h5`} />
          <path d={`M-27 ${y - 9}h-8v2`} strokeOpacity={0.6} />
        </g>
      ))}
      <path d="M38-18h8M38 0h8M38 18h8" strokeWidth={2.2} />
      <path d="M42-21v6M42-3v6M42 15v6" strokeOpacity={0.55} />
    </g>
  );
}

/** A braced radio mast with panel antennas and coverage arcs; x ±43, y ±25. */
export function CellularIllustration({ tint }: IllustrationProps) {
  return (
    <g fill="none" stroke={tint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M0-22v47M-12 25 0-17l12 42Z" fill={tint} fillOpacity={0.07} />
      <path d="M-5 0h10M-8 12h16M-5 0l13 12M5 0-8 12M-8 12l20 13M8 12l-20 13" strokeOpacity={0.7} />
      <path d="M-18 25h36M-7-15H7" strokeWidth={2} />
      <rect x={-13} y={-22} width={6} height={15} rx={1.7} fill={tint} fillOpacity={0.17} />
      <rect x={7} y={-22} width={6} height={15} rx={1.7} fill={tint} fillOpacity={0.17} />
      <path d="M-10-17v5M10-17v5" strokeOpacity={0.65} />
      <path d="M-21-20c-6 4-6 10 0 14M21-20c6 4 6 10 0 14" />
      <path d="M-29-24c-10 6-10 16 0 22M29-24c10 6 10 16 0 22" strokeOpacity={0.7} />
      <path d="M-37-25c-8 7-8 17 0 24M37-25c8 7 8 17 0 24" strokeOpacity={0.4} />
    </g>
  );
}

/** An encrypted mesh linking four fabric nodes; x ±48, y −23…23. */
export function SdwanIllustration({ tint }: IllustrationProps) {
  return (
    <g fill="none" stroke={tint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M-28-15-14-9M28-15 14-9M-28 15-12 8M28 15 12 8M-38-9v18M38-9v18" strokeOpacity={0.65} />
      {[-38, 38].flatMap((x) => [-15, 15].map((y) => (
        <g key={`${x}-${y}`}>
          <rect x={x - 10} y={y - 6} width={20} height={12} rx={2.5} fill={tint} fillOpacity={0.1} />
          <path d={`M${x - 5} ${y - 1}h10M${x - 5} ${y + 3}h3M${x + 2} ${y + 3}h3`} />
        </g>
      )))}
      <path d="M0-23 14-17v14C14 9 8 17 0 23-8 17-14 9-14-3v-14Z" fill={tint} fillOpacity={0.13} strokeWidth={2} />
      <path d="M-5-3v-5a5 5 0 0 1 10 0v5" strokeWidth={2} />
      <rect x={-8} y={-3} width={16} height={13} rx={2.5} fill={tint} fillOpacity={0.1} />
      <path d="M0 2v3" strokeWidth={2.2} />
    </g>
  );
}

/** Public network peers connected to a globe; x ±46, y ±22. */
export function InternetIllustration({ tint }: IllustrationProps) {
  return (
    <g fill="none" stroke={tint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M-38-14h9l9 6M-38 14h9l9-6M38-14h-9l-9 6M38 14h-9l-9-6" strokeOpacity={0.65} />
      {[-42, 42].flatMap((x) => [-14, 14].map((y) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={4} fill={tint} fillOpacity={0.12} />
      )))}
      <circle r={22} fill={tint} fillOpacity={0.07} strokeWidth={2} />
      <ellipse rx={9} ry={22} strokeOpacity={0.8} />
      <ellipse rx={22} ry={8} strokeOpacity={0.7} />
      <path d="M-22 0h44M0-22v44" strokeOpacity={0.55} />
    </g>
  );
}

/** Hosted applications and services connected beneath the cloud; x ±40, y ±25. */
export function CloudIllustration({ tint }: IllustrationProps) {
  return (
    <g fill="none" stroke={tint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M-25 6H24C31 6 36 1 36-5c0-6-5-11-12-11-2-6-7-9-14-9-8 0-14 4-17 10-3-3-7-5-12-5-7 0-13 6-13 13-6 2-8 7-5 11 2 2 6 2 12 2Z" fill={tint} fillOpacity={0.1} strokeWidth={2} />
      <path d="M0 6v4M-26 14v-4h52v4M0 10v4" strokeOpacity={0.6} />
      {[-26, 0, 26].map((x) => (
        <rect key={x} x={x - 10} y={14} width={20} height={11} rx={2} fill={tint} fillOpacity={0.1} />
      ))}
      <path d="M-31 18h10M-31 21h10M-4 17l-3 3 3 3M4 17l3 3-3 3" />
      <ellipse cx={26} cy={18} rx={5} ry={1.5} />
      <path d="M21 18v4c0 2 10 2 10 0v-4" />
    </g>
  );
}
