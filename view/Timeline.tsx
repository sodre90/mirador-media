import { useRef, type PointerEvent } from "react";
import type { Mark } from "../shared/document.ts";
import { describeSpan } from "../shared/operations.ts";
import type { Piece } from "../shared/timeline.ts";
import { formatTime } from "../shared/time.ts";

const percent = (seconds: number, duration: number) => `${(Math.min(duration, Math.max(0, seconds)) / duration) * 100}%`;

/** The whole length: the pieces a trim and cuts keep, the marks, and where the video is; pressing or dragging on it seeks. */
export function Timeline({
  duration,
  time,
  kept,
  marks,
  rangeStart,
  onSeek,
}: {
  duration: number;
  time: number;
  kept: Piece[] | null;
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
