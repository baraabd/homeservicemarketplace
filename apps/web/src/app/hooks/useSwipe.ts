import { useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface UseSwipeOptions {
  onSwipeLeft?:    () => void;
  onSwipeRight?:   () => void;
  onSwipeUp?:      () => void;
  onSwipeDown?:    () => void;
  /** px distance required to fire gesture  (default 60) */
  threshold?:      number;
  /** only activate when touch starts within X px of left edge */
  edgeStartOnly?:  boolean;
  edgeWidth?:      number;
}

export interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove:  (e: React.TouchEvent) => void;
  onTouchEnd:   (e: React.TouchEvent) => void;
  /** live horizontal drag offset – use for CSS translateX feedback */
  dragX: number;
  /** live vertical drag offset – use for CSS translateY feedback */
  dragY: number;
}

// ─────────────────────────────────────────────────────────────────────────────
export function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  threshold     = 60,
  edgeStartOnly = false,
  edgeWidth     = 50,
}: UseSwipeOptions): SwipeHandlers {
  const startX  = useRef(0);
  const startY  = useRef(0);
  const active  = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    active.current = edgeStartOnly ? t.clientX <= edgeWidth : true;
    setDragX(0);
    setDragY(0);
  }, [edgeStartOnly, edgeWidth]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!active.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > absDy) {
      // Horizontal — update dragX with light damping past 120 px
      const clamped = dx > 0
        ? Math.min(dx, 300)
        : Math.max(dx, -300);
      if ((dx > 0 && onSwipeRight) || (dx < 0 && onSwipeLeft)) {
        setDragX(clamped * (Math.abs(clamped) > 120 ? 0.5 : 1));
      }
    } else {
      // Vertical — update dragY
      const clamped = dy > 0
        ? Math.min(dy, 400)
        : Math.max(dy, -400);
      if ((dy < 0 && onSwipeUp) || (dy > 0 && onSwipeDown)) {
        setDragY(clamped);
      }
    }
  }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!active.current) {
      setDragX(0);
      setDragY(0);
      return;
    }
    const dx = e.changedTouches[0].clientX - startX.current;
    const dy = e.changedTouches[0].clientY - startY.current;

    if (Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) onSwipeRight?.();
        else         onSwipeLeft?.();
      } else {
        if (dy < 0) onSwipeUp?.();
        else         onSwipeDown?.();
      }
    }
    setDragX(0);
    setDragY(0);
  }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold]);

  return { onTouchStart, onTouchMove, onTouchEnd, dragX, dragY };
}
