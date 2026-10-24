import { useRef, type PointerEvent } from "react";
import { SETTING_NAMES, type Edits, type Mark, type Span } from "../shared/document.ts";
import { describeSpan } from "../shared/operations.ts";
import { formatTime, SETTING_FORMATS } from "../shared/time.ts";

const percent = (seconds: number, duration: number) => `${(Math.min(duration, Math.max(0, seconds)) / duration) * 100}%`;

/**
 * The whole length: the parts a trim and cuts keep, the ranges with a setting of their own, the marks, and where the
 * video is; pressing or dragging on it seeks.
 */
export function Timeline({
  duration,
  time,
  kept,
  settings,
  marks,
  rangeStart,
  onSeek,
}: {
  duration: number;
  time: number;
  kept: Span[] | null;
  settings: Edits | null;
  marks: Mark[];
  rangeStart: number | null;
  onSeek: (seconds: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const seekTo = (event: PointerEvent) => {
    const bounds = track.current!.getBoundingClientRect();
    onSeek(((event.clientX - bounds.left) / bounds.width) * duration);
  };
  if (duration <= 0) return <div className="timeline empty" />;
  return (
    <div
      ref={track}
      className="timeline"
      role="slider"
      aria-label="Time"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      aria-valuetext={formatTime(time)}
      onPointerDown={(event) => {
        track.current!.setPointerCapture(event.pointerId);
        seekTo(event);
      }}
      onPointerMove={(event) => event.buttons === 1 && seekTo(event)}
    >
      {kept?.map((piece) => (
        <div key={piece.start} className="kept" style={{ left: percent(piece.start, duration), width: percent(piece.end - piece.start, duration) }} title={`Kept: ${describeSpan(piece)}`} />
      ))}
      {settings &&
        SETTING_NAMES.flatMap((name) =>
          settings[name].ranges.map((range) => (
            <div
              key={`${name} ${range.start}`}
              className={`setting ${name}`}
              style={{ left: percent(range.start, duration), width: percent(range.end - range.start, duration) }}
              title={`${name} ${SETTING_FORMATS[name](range.value)}: ${describeSpan(range)}`}
            />
          )),
        )}
      {rangeStart !== null && (
        <div className="range" style={{ left: percent(Math.min(rangeStart, time), duration), width: percent(Math.abs(time - rangeStart), duration) }} />
      )}
      {marks.map((mark) => (
        <div
          key={mark.id}
          className={`tick${mark.done ? " done" : ""}`}
          style={{ left: percent(mark.at, duration), width: mark.end === null ? undefined : percent(mark.end - mark.at, duration) }}
          title={`${mark.id}: ${mark.note}`}
        />
      ))}
      <div className="playhead" style={{ left: percent(time, duration) }} />
    </div>
  );
}
