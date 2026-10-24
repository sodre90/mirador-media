import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { Box } from "../shared/document.ts";
import { boxBetween, boxOnScreen, pictureRect, sourcePoint, type Rect, type Size } from "./geometry.ts";

export interface ShownBox {
  key: string;
  box: Box;
  label: string;
  drawing?: boolean;
}

/** The picture's place in the element, kept as the pane resizes and as the video learns its size. */
function usePictureRect(video: RefObject<HTMLVideoElement | null>) {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const measure = () =>
      setRect(element.videoWidth > 0 ? pictureRect({ width: element.clientWidth, height: element.clientHeight }, { width: element.videoWidth, height: element.videoHeight }) : null);
    const resizes = new ResizeObserver(measure);
    resizes.observe(element);
    element.addEventListener("loadedmetadata", measure);
    measure();
    return () => {
      resizes.disconnect();
      element.removeEventListener("loadedmetadata", measure);
    };
  }, [video]);
  return rect;
}

/** The video, and over its picture the boxes of the marks at this moment; dragging across the picture draws a new box. */
export function Player({
  video,
  src,
  filter,
  source,
  boxes,
  canDraw,
  onBox,
}: {
  video: RefObject<HTMLVideoElement | null>;
  src: string | null;
  filter: string;
  source: Size | null;
  boxes: ShownBox[];
  canDraw: boolean;
  onBox: (box: Box | null) => void;
}) {
  const picture = usePictureRect(video);
  const [corners, setCorners] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const overlay = useRef<HTMLDivElement>(null);

  const pointAt = (event: PointerEvent) => {
    const bounds = overlay.current!.getBoundingClientRect();
    return sourcePoint(picture!, source!, event.clientX - bounds.left, event.clientY - bounds.top);
  };
  const start = (event: PointerEvent) => {
    if (!canDraw || !picture || !source || event.button !== 0) return;
    overlay.current!.setPointerCapture(event.pointerId);
    const point = pointAt(event);
    setCorners({ from: point, to: point });
  };
  const move = (event: PointerEvent) => corners && setCorners({ ...corners, to: pointAt(event) });
  const end = () => {
    if (!corners) return;
    const box = boxBetween(corners.from, corners.to);
    setCorners(null);
    onBox(box.width >= 4 && box.height >= 4 ? box : null);
  };

  const drawing: ShownBox[] = corners ? [{ key: "drawing", box: boxBetween(corners.from, corners.to), label: "", drawing: true }] : [];
  return (
    <div className="stage">
      <video ref={video} src={src ?? undefined} crossOrigin="anonymous" preload="auto" playsInline style={{ filter }} />
      {picture && source && (
        <div
          ref={overlay}
          className={`overlay${canDraw ? " drawable" : ""}`}
          aria-label="The frame: drag across it to draw a box"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => setCorners(null)}
        >
          {[...boxes, ...drawing].map(({ key, box, label, drawing: inProgress }) => {
            const { left, top, width, height } = boxOnScreen(picture, source, box);
            return (
              <div key={key} className={`box${inProgress ? " drawing" : ""}`} style={{ left, top, width, height }}>
                {label && <span>{label}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
