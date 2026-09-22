import { useRef } from "react";

/** Below this a pointer has not moved, it has wobbled while being clicked. */
const DRAG_THRESHOLD = 4;

/**
 * Swipe a strip sideways by dragging it. A touch screen and a trackpad already
 * scroll it themselves, so this is what a mouse gets instead of a scrollbar.
 *
 * A drag must not also click what it started on, so the pointer is captured
 * only once it has actually moved, and the click that follows a real drag is
 * swallowed. A plain click never goes near any of this and reaches the button.
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const drag = useRef<{ pointerId: number; x: number; left: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  const onPointerDown = (event: React.PointerEvent<T>) => {
    // Touch scrolls natively, and a right or middle button is not a swipe.
    if (event.pointerType === "touch" || event.button !== 0) return;
    const node = ref.current;
    if (!node) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, left: node.scrollLeft, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<T>) => {
    const state = drag.current;
    const node = ref.current;
    if (!state || !node || event.pointerId !== state.pointerId) return;
    const dx = event.clientX - state.x;
    if (!state.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      state.moved = true;
      // From here the strip owns the pointer, so leaving it mid-drag, or
      // letting go outside it, still ends where the user meant.
      node.setPointerCapture(state.pointerId);
    }
    node.scrollLeft = state.left - dx;
  };

  const onPointerUp = (event: React.PointerEvent<T>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const node = ref.current;
    if (node?.hasPointerCapture(state.pointerId)) node.releasePointerCapture(state.pointerId);
    swallowClick.current = state.moved;
    drag.current = null;
  };

  const onClickCapture = (event: React.MouseEvent<T>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    ref,
    props: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture },
  };
}
