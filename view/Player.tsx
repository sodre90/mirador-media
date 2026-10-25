import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import type { Box } from "../shared/document.ts";
import { corners, cssMatrix, framed, type FrameEdits, type Point, type Size, type Sizing } from "../shared/geometry.ts";
import { boxBetween, frameOnStage, sourcePoint } from "./geometry.ts";

export interface ShownBox {
  key: string;
  box: Box;
  label: string;
  drawing?: boolean;
}

/**
 * An element's size, kept as it resizes, and measured again before the browser paints when its shape changes: the stage
 * takes the frame's shape as the edits change, and a frame placed on its old size would show, and take a drag, in the
 * wrong place.
 */
function useSize(element: RefObject<HTMLElement | null>, shape: string) {
  const [size, setSize] = useState<Size | null>(null);
  const measure = () => {
    const observed = element.current;
    if (observed) setSize((known) => (known?.width === observed.clientWidth && known.height === observed.clientHeight ? known : { width: observed.clientWidth, height: observed.clientHeight }));
  };
  useLayoutEffect(measure, [shape]);
  useEffect(() => {
    const resizes = new ResizeObserver(measure);
    resizes.observe(element.current!);
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

/** The stage takes the shape of the frame the edits make, as wide as fits under its height limit, so no bars frame it. */
function stageShape(picture: Size | null, frameEdits: FrameEdits, sizing: Sizing) {
  const { width, height } = picture ? framed(picture, frameEdits, sizing).size : { width: 16, height: 9 };
  return { aspectRatio: `${width} / ${height}`, maxWidth: `calc(var(--stage-height) * ${width / height})` };
}

/**
 * The video's frames drawn with the preview's filter. Chrome applies a CSS filter on a video to colours of its own, so a
 * brightened video strays from the render; drawn on a canvas, the filter works on the frame's values, as ffmpeg does.
 */
function FilteredFrames({ video, filter, size, style }: { video: RefObject<HTMLVideoElement | null>; filter: string; size: Size; style: CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = video.current;
    const context = canvas.current?.getContext("2d");
    if (!element || !context) return;
    const draw = () => {
      if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      context.filter = filter;
      context.drawImage(element, 0, 0, size.width, size.height);
    };
    let next = 0;
    const drawEveryFrame = () => {
      draw();
      next = element.requestVideoFrameCallback(drawEveryFrame);
    };
    drawEveryFrame();
    element.addEventListener("seeked", draw);
    return () => {
      element.cancelVideoFrameCallback(next);
      element.removeEventListener("seeked", draw);
    };
  }, [video, filter, size.width, size.height]);
  return <canvas ref={canvas} width={size.width} height={size.height} data-filter={filter} style={style} />;
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
  const picture = usePictureSize(element);
  const shape = stageShape(picture, frameEdits, sizing);
  const stageSize = useSize(stage, shape.aspectRatio);
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
  const end = (event: PointerEvent) => {
    if (!corner) return;
    const box = boxBetween(corner.from, pointAt(event));
    setCorner(null);
    onBox(box.width >= 4 && box.height >= 4 ? box : null);
  };

  const drawing: ShownBox[] = corner ? [{ key: "drawing", box: boxBetween(corner.from, corner.to), label: "", drawing: true }] : [];
  const placed = frame ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height } : { inset: 0 };
  const placedPicture = frame && picture ? { width: picture.width, height: picture.height, transform: cssMatrix(frame.toScreen) } : { visibility: "hidden" as const };
  const drawsFrames = element.kind === "video" && filter !== "none" && frame !== null && picture !== null;
  return (
    <div ref={stage} className="stage" style={shape}>
      <div className="frame" style={placed}>
        {element.kind === "video" ? (
          <>
            <video ref={element.ref} src={src ?? undefined} crossOrigin="anonymous" preload="auto" playsInline style={drawsFrames ? { ...placedPicture, opacity: 0 } : placedPicture} />
            {drawsFrames && <FilteredFrames video={element.ref} filter={filter} size={picture} style={placedPicture} />}
          </>
        ) : (
          <img ref={element.ref} src={src ?? undefined} crossOrigin="anonymous" alt="" draggable={false} style={{ ...placedPicture, filter }} />
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
      </div>
      {frame && (
        <div
          ref={overlay}
          className={`overlay${canDraw ? " drawable" : ""}`}
          style={placed}
          aria-label="The frame: drag across it to draw a box"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => setCorner(null)}
        />
      )}
    </div>
  );
}
