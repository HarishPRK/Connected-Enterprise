export type PacketTransferPathProps = {
  d: string;
  color: string;
  secondaryColor?: string;
  active: boolean;
  available?: boolean;
  duration?: number;
  /** Observed traffic intensity, normalized to 0…1 by the caller. */
  load?: number;
  width?: number;
  id?: string;
};

/** A signal rail with directional packet capsules in the topology's SVG units. */
export function PacketTransferPath({
  d,
  color,
  secondaryColor,
  active,
  available = true,
  duration = 1.8,
  load = 0,
  width = 2.6,
  id,
}: PacketTransferPathProps) {
  const intensity = Number.isFinite(load) ? Math.min(1, Math.max(0, load)) : 0;
  const packetCount = 2 + Math.round(intensity * 2);
  const transitSeconds = Number.isFinite(duration) && duration > 0 ? duration : 1.8;
  const railWidth = Number.isFinite(width) && width > 0 ? width : 2.6;

  if (!active) {
    return (
      <path
        id={id}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(1.1, railWidth * 0.6)}
        strokeOpacity={available ? 0.3 : 0.16}
        strokeDasharray={available ? '5 7' : '2 8'}
        strokeLinecap="round"
        aria-hidden="true"
      />
    );
  }

  return (
    <g id={id} fill="none" aria-hidden="true">
      <path
        d={d}
        stroke={color}
        strokeWidth={railWidth + 5}
        strokeOpacity={0.1}
        strokeLinecap="round"
      />
      <path
        d={d}
        stroke={color}
        strokeWidth={railWidth}
        strokeOpacity={0.78}
        strokeLinecap="round"
      />
      {Array.from({ length: packetCount }, (_, index) => {
        const packetColor = secondaryColor && index % 2 === 1 ? secondaryColor : color;
        return (
          <g key={index}>
            <rect
              x={-5.5}
              y={-3}
              width={11}
              height={6}
              rx={2}
              fill={packetColor}
              stroke={packetColor}
              strokeWidth={0.8}
            />
            <path
              d="M-2.5-1.5v3M1-1.5l1.5 1.5L1 1.5"
              stroke="white"
              strokeOpacity={0.8}
              strokeWidth={0.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <animateMotion
              path={d}
              dur={`${transitSeconds}s`}
              begin={`${-((index + 0.5) / packetCount) * transitSeconds}s`}
              rotate="auto"
              calcMode="paced"
              repeatCount="indefinite"
            />
          </g>
        );
      })}
    </g>
  );
}
