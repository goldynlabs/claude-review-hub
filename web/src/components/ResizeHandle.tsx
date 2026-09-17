import { useRef } from "react";

/**
 * The divider between two panels. `onDrag` receives the horizontal movement in
 * pixels; the caller decides whether that grows or shrinks its panel.
 * Double-clicking restores the default width.
 */
export function ResizeHandle({ onDrag, onReset }: { onDrag: (delta: number) => void; onReset?: () => void }) {
  const last = useRef(0);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize, double-click to reset"
      className="group relative w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/60"
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        last.current = event.clientX;
        // Without this the drag selects text across the whole dashboard.
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = event.clientX - last.current;
        if (!delta) return;
        last.current = event.clientX;
        onDrag(delta);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.style.userSelect = "";
      }}
      onPointerCancel={() => {
        document.body.style.userSelect = "";
      }}
    >
      {/* A wider invisible target, so the handle is easy to grab. */}
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
