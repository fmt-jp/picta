/**
 * Menu icons, drawn in the same language as the app mark: a thin light line
 * drawing with exactly one gold accent per icon.
 *
 * A few icons overlap themselves (the stacked photos, the sliders). Rather
 * than punching an SVG mask, the covering shape is filled with the row's own
 * background via `--menu-icon-bg`, which the active row overrides so the
 * cut-out keeps matching whatever it sits on.
 */
export type MenuIconName = 'camera' | 'records' | 'search' | 'tags' | 'export' | 'settings';

const MASK = 'var(--menu-icon-bg, var(--bg-raised))';

const BODIES: Record<MenuIconName, React.ReactNode> = {
  camera: (
    <>
      <circle className="s" cx="11" cy="13" r="7" />
      <circle className="af" cx="11" cy="13" r="3.1" />
      <circle className="af" cx="19.4" cy="4.8" r="1.9" />
    </>
  ),
  records: (
    <>
      <rect className="s" x="7" y="3.2" width="13.5" height="10" rx="2" />
      <rect fill={MASK} x="3.2" y="8.2" width="13.6" height="12.6" rx="2" />
      <rect className="s" x="3.5" y="8.5" width="13" height="12" rx="2" />
      <path className="s" d="M5.2 17.4l3-3.1 2.2 2.2 2.4-2.7 3 3.6" />
      <circle className="af" cx="7.2" cy="12.2" r="1.35" />
    </>
  ),
  search: (
    <>
      <circle className="s" cx="10.5" cy="10.5" r="6.3" />
      <path className="as" d="M15.2 15.2l5 5" />
    </>
  ),
  tags: (
    <>
      <path
        className="s"
        d="M3.5 4.9a1.4 1.4 0 0 1 1.4-1.4h7.2l8 8a1.4 1.4 0 0 1 0 2l-6.8 6.8a1.4 1.4 0 0 1-2 0l-8-8V4.9z"
      />
      <circle className="af" cx="7.9" cy="7.9" r="1.7" />
    </>
  ),
  export: (
    <>
      <path className="s" d="M4.2 14.6v3.7a1.6 1.6 0 0 0 1.6 1.6h12.4a1.6 1.6 0 0 0 1.6-1.6v-3.7" />
      <path className="s" d="M12 15.3V4.2" />
      <path className="as" d="M8 8.1l4-3.9 4 3.9" />
    </>
  ),
  settings: (
    <>
      <path className="s" d="M3.6 7h16.8" />
      <path className="s" d="M3.6 12h16.8" />
      <path className="s" d="M3.6 17h16.8" />
      <circle fill={MASK} cx="9" cy="7" r="2.6" />
      <circle className="s" cx="9" cy="7" r="2.3" />
      <circle className="af" cx="15.2" cy="12" r="2.3" />
      <circle fill={MASK} cx="7.6" cy="17" r="2.6" />
      <circle className="s" cx="7.6" cy="17" r="2.3" />
    </>
  ),
};

export default function MenuIcon({ name, size = 24 }: { name: MenuIconName; size?: number }) {
  return (
    <svg
      className="menu-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {BODIES[name]}
    </svg>
  );
}
