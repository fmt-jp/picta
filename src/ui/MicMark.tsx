import { useId } from 'react';

/**
 * Vintage microphone: a meshed capsule in a gold yoke.
 *
 * Adapted for a dark UI — the reference art has a dark capsule with light
 * mesh holes, which would disappear against the button, so the capsule is
 * drawn in the current text colour and the holes are punched through it. The
 * holes therefore take the button's own colour, including the red it turns
 * while listening.
 */
const DOT_ROWS = [
  { y: 11, xs: [27, 32, 37] },
  { y: 16, xs: [29.5, 34.5] },
  { y: 21, xs: [27, 32, 37] },
  { y: 26, xs: [29.5, 34.5] },
  { y: 31, xs: [27, 32, 37] },
];

export default function MicMark({ size = 36 }: { size?: number }) {
  const maskId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      <mask id={maskId}>
        <rect x="22" y="4" width="20" height="36" rx="10" fill="#fff" />
        {DOT_ROWS.map((row) =>
          row.xs.map((x) => <circle key={`${x}-${row.y}`} cx={x} cy={row.y} r="1.8" fill="#000" />),
        )}
      </mask>

      {/* capsule with the mesh punched out */}
      <rect x="22" y="4" width="20" height="36" rx="10" fill="currentColor" mask={`url(#${maskId})`} />

      {/* yoke, stem and base */}
      <g
        fill="none"
        stroke="var(--mic-stand, var(--accent))"
        strokeWidth="4.5"
        strokeLinecap="round"
      >
        <path d="M15 27v3a17 17 0 0 0 34 0v-3" />
        <path d="M32 47v7" />
        <path d="M21 57h22" />
      </g>
    </svg>
  );
}
