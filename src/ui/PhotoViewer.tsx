import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Full-screen photo view with pinch-to-zoom.
 *
 * The app sets `user-scalable=no` so the page itself never zooms while
 * framing a shot, which also disables the browser's own pinch here — so the
 * gesture is handled directly with pointer events.
 */
const MAX_SCALE = 5;
const ZOOM_STEP = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;

interface Props {
  url: string;
  alt: string;
  onClose: () => void;
}

interface Point {
  x: number;
  y: number;
}

export default function PhotoViewer({ url, alt, onClose }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  /** Gesture start state, so a pinch scales from where it began. */
  const gesture = useRef({ distance: 0, scale: 1, offset: { x: 0, y: 0 }, center: { x: 0, y: 0 } });
  const tap = useRef({ time: 0, x: 0, y: 0, moved: false });

  const lastTapAt = useRef(0);
  const closeTimer = useRef<number | null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** How far the photo may be dragged before its edge would come into view. */
  const clampOffset = useCallback((next: Point, atScale: number): Point => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image || !image.naturalWidth) return { x: 0, y: 0 };

    const box = stage.getBoundingClientRect();
    const fit = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const shownWidth = image.naturalWidth * fit * atScale;
    const shownHeight = image.naturalHeight * fit * atScale;
    const maxX = Math.max(0, (shownWidth - box.width) / 2);
    const maxY = Math.max(0, (shownHeight - box.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  const applyScale = useCallback(
    (nextScale: number, nextOffset: Point) => {
      const clamped = Math.min(MAX_SCALE, Math.max(1, nextScale));
      setScale(clamped);
      setOffset(clampOffset(clamped === 1 ? { x: 0, y: 0 } : nextOffset, clamped));
    },
    [clampOffset],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      tap.current = { time: Date.now(), x: e.clientX, y: e.clientY, moved: false };
      gesture.current.offset = offset;
      gesture.current.center = { x: e.clientX, y: e.clientY };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.distance = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.scale = scale;
      gesture.current.offset = offset;
      tap.current.moved = true; // a pinch is never a tap
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.distance > 0) {
        applyScale(
          (gesture.current.scale * distance) / gesture.current.distance,
          gesture.current.offset,
        );
      }
      return;
    }

    const dx = e.clientX - gesture.current.center.x;
    const dy = e.clientY - gesture.current.center.y;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) tap.current.moved = true;
    if (scale > 1) {
      setOffset(
        clampOffset({ x: gesture.current.offset.x + dx, y: gesture.current.offset.y + dy }, scale),
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0 || tap.current.moved) return;

    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      // Double tap: zoom in, or back out to fit.
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
      lastTapAt.current = 0;
      applyScale(scale > 1 ? 1 : ZOOM_STEP, { x: 0, y: 0 });
      return;
    }

    lastTapAt.current = now;
    // A single tap on the unzoomed photo closes — but wait in case a second
    // tap is coming.
    if (scale === 1) {
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        onClose();
      }, DOUBLE_TAP_MS);
    }
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="写真">
      <div className="viewer-bar">
        <span className="viewer-hint">{scale > 1 ? `${scale.toFixed(1)}倍` : 'ピンチで拡大'}</span>
        <button className="camera-round" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      <div
        className="viewer-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imageRef}
          src={url}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        />
      </div>
    </div>
  );
}
