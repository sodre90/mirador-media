import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { Box } from "../shared/document.ts";
import { corners, cssMatrix, type FrameEdits, type Point, type Size, type Sizing } from "../shared/geometry.ts";
import { boxBetween, frameOnStage, sourcePoint } from "./geometry.ts";

export interface ShownBox {
  key: string;
  box: Box;
  label: string;
  drawing?: boolean;
}

/** An element's size, kept as it resizes. */
function useSize(element: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const observed = element.current;
    if (!observed) return;
    const resizes = new ResizeObserver(() => setSize({ width: observed.clientWidth, height: observed.clientHeight }));
    resizes.observe(observed);
    return () => resizes.disconnect();
  }, [element]);
  return size;
}

/** The element that shows the picture: a video, or a photo's img. */
export type Picture = { kind: "video"; ref: RefObject<HTMLVideoElement | null> } | { kind: "photo"; ref: RefObject<HTMLImageElement | null> };

function naturalSize(element: HTMLVideoElement | HTMLImageElement): Size | null {
  const [width, height] = element instanceof HTMLVideoElement ? [element.videoWidth, element.videoHeight] : [element.naturalWidth, element.naturalHeight];
  return width > 0 ? { width, height } : null;
}

/** The size of the picture the element shows, as it learns it. */
function usePictureSize(picture: Picture) {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const element = picture.ref.current;
    if (!element) return;
    const measure = () => setSize(naturalSize(element));
    const events = picture.kind === "video" ? ["loadedmetadata", "resize"] : ["load"];
    events.forEach((event) => element.addEventListener(event, measure));
    measure();
    return () => events.forEach((event) => element.removeEventListener(event, measure));
  }, [picture.kind, picture.ref]);
  return size;
}

const pointsOf = (points: Point[]) => points.map(({ x, y }) => `${x},${y}`).join(" ");

/**
 * The video or photo in the frame the edits make of it, and over it the boxes of the marks shown; dragging across the
 * frame draws a new box. Boxes are in the source's pixels, so a crop, a turn or straightening moves and tilts them with
 * the picture.
 */
export function Player({
  picture: element,
  src,
  filter,
  frameEdits,
  sizing,
  boxes,
  canDraw,
  onBox,
}: {
  picture: Picture;
  src: string | null;
  filter: string;
  frameEdits: FrameEdits;
  sizing: Sizing;
  boxes: ShownBox[];
  canDraw: boolean;
  onBox: (box: Box | null) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const stageSize = useSize(stage);
  const picture = usePictureSize(element);
  const frame = stageSize && picture ? frameOnStage(stageSize, picture, frameEdits, sizing) : null;
  const [corner, setCorner] = useState<{ from: Point; to: Point } | null>(null);
  const overlay = useRef<HTMLDivElement>(null);

  const pointAt = (event: PointerEvent) => {
    const bounds = overlay.current!.getBoundingClientRect();
    return sourcePoint(frame!, picture!, event.clientX - bounds.left, event.clientY - bounds.top);
  };
  const start = (event: PointerEvent) => {
    if (!canDraw || !frame || event.button !== 0) return;
    overlay.current!.setPointerCapture(event.pointerId);
    const point = pointAt(event);
    setCorner({ from: point, to: point });
  };
  const move = (event: PointerEvent) => corner && setCorner({ ...corner, to: pointAt(event) });
  const end = () => {
    if (!corner) return;
    const box = boxBetween(corner.from, corner.to);
    setCorner(null);
    onBox(box.width >= 4 && box.height >= 4 ? box : null);
  };

  const drawing: ShownBox[] = corner ? [{ key: "drawing", box: boxBetween(corner.from, corner.to), label: "", drawing: true }] : [];
  const placed = frame ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height } : { inset: 0 };
  const placedPicture = frame && picture ? { width: picture.width, height: picture.height, transform: cssMatrix(frame.toScreen), filter } : { visibility: "hidden" as const };
  return (
    <div ref={stage} className="stage">
      <div className="frame" style={placed}>
        {element.kind === "video" ? (
          <video ref={element.ref} src={src ?? undefined} crossOrigin="anonymous" preload="auto" playsInline style={placedPicture} />
        ) : (
          <img ref={element.ref} src={src ?? undefined} crossOrigin="anonymous" alt="" draggable={false} style={placedPicture} />
        )}
        {frame && (
          <svg className="boxes" width={frame.width} height={frame.height}>
            {[...boxes, ...drawing].map(({ key, box, label, drawing: inProgress }) => {
              const points = corners(frame.toScreen, box);
              const top = points.reduce((highest, point) => (point.y < highest.y || (point.y === highest.y && point.x < highest.x) ? point : highest));
              return (
                <g key={key} className={`box${inProgress ? " drawing" : ""}`}>
                  <polygon points={pointsOf(points)} />
                  {label && (
                    <text x={top.x + 3} y={Math.max(12, top.y - 4)}>
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {frame && (
          <div
            ref={overlay}
            className={`overlay${canDraw ? " drawable" : ""}`}
            aria-label="The frame: drag across it to draw a box"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => setCorner(null)}
          />
        )}
      </div>
    </div>
  );
}
