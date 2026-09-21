/** The app's lens mark, matching the icon. */
export default function AppMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      <circle cx="256" cy="256" r="140" fill="none" stroke="currentColor" strokeWidth="34" />
      <circle cx="256" cy="256" r="86" fill="var(--accent)" />
      <circle cx="383" cy="129" r="33" fill="var(--accent)" />
    </svg>
  );
}
