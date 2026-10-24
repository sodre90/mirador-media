import { useEffect, useRef, useState, type PointerEvent } from "react";
import { SETTING_NAMES, type Edits, type Mark } from "../shared/document.ts";
import { SETTING_TITLES } from "../shared/describe.ts";
import { describeSpan } from "../shared/operations.ts";
import { formatTime, SETTING_FORMATS } from "../shared/time.ts";
import type { RemovedPart } from "../shared/timeline.ts";
import { markNumber } from "./parts.tsx";
import type { Thumbnail } from "./thumbnails.ts";
import { formatTick, rulerTicks } from "./scale.ts";

const PIXELS_PER_TICK_LABEL = 80;

const REMOVED_TITLES: Record<RemovedPart["by"], string> = { trim: "Trimmed", cut: "Cut" };

function useWidth() {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const resizes = new ResizeObserver(() => setWidth(element.current!.clientWidth));
    resizes.observe(element.current!);
    return () => resizes.disconnect();
  }, []);
  return [element, width] as const;
}

/**
 * The whole length as tracks under a time scale: the video's frames with what the trim and cuts take out, a lane for
 * each setting with ranges of its own, the marks, and where the video is; pressing or dragging on them seeks.
 */
export function Timeline({
  duration,
  time,
  thumbnails,
  removed,
  settings,
  marks,
  rangeStart,
  onSeek,
}: {
  duration: number;
  time: number;
  thumbnails: Thumbnail[];
  removed: RemovedPart[];
  settings: Edits | null;
  marks: Mark[] | null;
  rangeStart: number | null;
  onSeek: (seconds: number) => void;
}) {
  const [tracks, width] = useWidth();
  const at = (seconds: number) => `${(Math.min(duration, Math.max(0, seconds)) / duration) * 100}%`;
  const spanning = (start: number, end: number) => ({ left: at(start), width: at(end - start) });
  const seekTo = (event: PointerEvent) => {
    const bounds = tracks.current!.getBoundingClientRect();
    onSeek(((event.clientX - bounds.left) / bounds.width) * duration);
  };
  const ranged = SETTING_NAMES.filter((name) => settings && settings[name].ranges.length > 0);
  const known = duration > 0;
  return (
    <div className="timeline">
      <div className="labels" aria-hidden="true">
        <span className="ruler-row" />
        <span className="label video">Video</span>
        {ranged.map((name) => (
          <span key={name} className={`label ${name}`}>
            {SETTING_TITLES[name]}
          </span>
        ))}
        {marks && <span className="label marks">Marks</span>}
      </div>
      <div
        ref={tracks}
        className="tracks"
        role="slider"
        aria-label="Time"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={formatTime(time)}
        onPointerDown={(event) => {
          if (!known) return;
          tracks.current!.setPointerCapture(event.pointerId);
          seekTo(event);
        }}
        onPointerMove={(event) => known && event.buttons === 1 && seekTo(event)}
      >
        <div className="ruler">
          {known &&
            rulerTicks(duration, Math.max(2, Math.floor(width / PIXELS_PER_TICK_LABEL))).map((tick) => (
              <span key={tick} className="tick-label" style={{ left: at(tick) }}>
                {formatTick(tick)}
              </span>
            ))}
        </div>
        <div className="lane video">
          <div className="filmstrip">
            {thumbnails.map(({ at, src }) => (
              <img key={at} src={src} data-at={at} alt="" draggable={false} />
            ))}
          </div>
          {known &&
            removed.map((part) => (
              <div key={`${part.by} ${part.start}`} className={`removed ${part.by}`} style={spanning(part.start, part.end)} title={`${REMOVED_TITLES[part.by]}: ${describeSpan(part)}`} />
            ))}
        </div>
        {known &&
          ranged.map((name) => (
            <div key={name} className={`lane ${name}`}>
              {settings![name].ranges.map((range) => (
                <div key={range.start} className={`bar ${name}`} style={spanning(range.start, range.end)} title={`${SETTING_TITLES[name]} ${SETTING_FORMATS[name](range.value)}: ${describeSpan(range)}`}>
                  {SETTING_FORMATS[name](range.value)}
                </div>
              ))}
            </div>
          ))}
        {marks && (
          <div className="lane marks">
            {known && rangeStart !== null && <div className="drafting" style={spanning(Math.min(rangeStart, time), Math.max(rangeStart, time))} />}
            {known &&
              marks.map((mark) => (
                <div
                  key={mark.id}
                  className={`mark${mark.end === null ? "" : " ranged"}${mark.done ? " done" : ""}`}
                  style={mark.end === null ? { left: at(mark.at) } : spanning(mark.at, mark.end)}
                  title={`${mark.id}: ${mark.note}`}
                >
                  <span className="pin">{markNumber(mark)}</span>
                </div>
              ))}
          </div>
        )}
        {known && <div className="playhead" style={{ left: at(time) }} />}
      </div>
    </div>
  );
}
