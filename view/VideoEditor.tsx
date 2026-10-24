import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppDocumentState } from "../mirador/api.ts";
import { changesSetting, NO_EDITS, type Box, type MediaDocument, type Probe } from "../shared/document.ts";
import { markMessage } from "../shared/mark-message.ts";
import { applyOperation, describeWhen } from "../shared/operations.ts";
import { formatTime, frameAt, frameMiddle } from "../shared/time.ts";
import { keptMoment, keptParts, keptPieces, looksAt, resultTime, sourceTime } from "../shared/timeline.ts";
import { capturedFrame, exposurePreview } from "./frame.ts";
import { ClearBox, Composer, EditsLine, Header, MarkList, TaskBar, useMediaUrl, type Mode } from "./parts.tsx";
import { usePlayhead } from "./playhead.ts";
import { Player, type ShownBox } from "./Player.tsx";
import { useSoundLevel } from "./sound.ts";
import { Timeline } from "./Timeline.tsx";

const DEFAULT_FPS = 30;

/** Where the composer's mark is: a moment, or a range from where it started to now, and maybe a box. */
const composedWhen = (time: number, rangeStart: number | null) =>
  rangeStart === null ? { at: time, end: null } : { at: Math.min(rangeStart, time), end: Math.max(rangeStart, time) };

function MomentAndBox({
  probe,
  time,
  box,
  rangeStart,
  onRange,
  onClearBox,
}: {
  probe: Probe;
  time: number;
  box: Box | null;
  rangeStart: number | null;
  onRange: (start: number | null) => void;
  onClearBox: () => void;
}) {
  const when = composedWhen(time, rangeStart);
  return (
    <>
      <span>
        {describeWhen(when)} · frame {frameAt(when.at, probe.fps)}
        {box ? ` · box ${box.width}×${box.height} px` : " · drag across the frame to draw a box"}
      </span>
      <ClearBox box={box} onClear={onClearBox} />
      <button type="button" className="link" onClick={() => onRange(rangeStart === null ? time : null)}>
        {rangeStart === null ? "Start a range here" : "Just this moment"}
      </button>
    </>
  );
}

const typingIn = (target: EventTarget | null) => target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;

/** A video: played, scrubbed and stepped through, with the edits previewed as it plays, and marked at a moment or a range. */
export function VideoEditor({ state }: { state: AppDocumentState<MediaDocument> }) {
  const { document, task } = state;
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [box, setBox] = useState<Box | null>(null);
  const [rangeStart, setRangeStart] = useState<number | null>(null);

  const probe = document.source?.probe ?? null;
  const fps = probe?.fps ?? DEFAULT_FPS;
  const sourceUrl = useMediaUrl(document.source?.file ?? null, null);
  const renderedUrl = useMediaUrl(mode === "rendered" ? (document.rendered?.file ?? null) : null, document.rendered?.at);
  const shown = mode === "rendered" ? renderedUrl : sourceUrl;
  const previewing = mode === "preview";
  const { edits } = document;
  const editedParts = useMemo(() => (probe && (edits.trim || edits.cuts.length > 0) ? keptParts(edits, probe.duration) : null), [edits, probe]);
  const pieces = previewing ? editedParts : null;

  const playOnlyKeptPieces = useCallback(
    (time: number) => {
      const element = video.current;
      if (!element || !pieces || element.paused) return;
      const kept = keptMoment(pieces, time);
      if (kept === time) return;
      if (kept >= pieces.at(-1)!.end) element.pause();
      element.currentTime = kept;
    },
    [pieces],
  );
  const playhead = usePlayhead(video, shown && "url" in shown ? shown.url : null, playOnlyKeptPieces);
  const time = playhead.time;

  const hasVideo = document.source !== null;
  const renderedPieces = useMemo(() => (document.rendered && probe ? keptPieces(document.rendered.edits, probe.duration) : null), [document.rendered, probe]);
  const pendingSeek = useRef<number | null>(null);
  const show = (next: Mode) => {
    const crossing = (mode === "rendered") !== (next === "rendered");
    const at = video.current?.currentTime;
    if (crossing && at !== undefined && renderedPieces) pendingSeek.current = next === "rendered" ? resultTime(renderedPieces, at) : sourceTime(renderedPieces, at);
    setMode(next);
  };
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const seekPending = () => {
      if (pendingSeek.current !== null) element.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    };
    element.addEventListener("loadedmetadata", seekPending);
    return () => element.removeEventListener("loadedmetadata", seekPending);
  }, [hasVideo]);

  const seek = (seconds: number, direction: 1 | -1 = 1) => {
    const element = video.current;
    if (!element) return;
    const within = Math.min(playhead.duration || Infinity, Math.max(0, seconds));
    element.currentTime = pieces ? keptMoment(pieces, within, direction) : within;
  };
  const step = (frames: number) => {
    video.current?.pause();
    const direction = frames < 0 ? -1 : 1;
    const target = frameMiddle(frameAt(time, fps) + frames, fps);
    const kept = pieces ? keptMoment(pieces, target, direction) : target;
    seek(kept === target || direction > 0 ? kept : kept - 0.5 / fps, direction);
  };
  const togglePlay = () => {
    const element = video.current;
    if (!element) return;
    if (!element.paused) return element.pause();
    if (pieces) {
      const atTheEnd = element.currentTime >= pieces.at(-1)!.end - 0.5 / fps;
      const from = atTheEnd ? pieces[0]!.start : keptMoment(pieces, element.currentTime);
      if (from !== element.currentTime) element.currentTime = from;
    }
    void element.play();
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (typingIn(event.target)) return;
      if (event.key === " ") togglePlay();
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  });

  const looks = looksAt(previewing ? edits : NO_EDITS, time);
  const filter = exposurePreview(looks.exposure);
  useSoundLevel(video, looks.volume, changesSetting(edits.volume, "volume"), playhead.playing);
  useEffect(() => {
    const element = video.current;
    if (element) element.playbackRate = element.defaultPlaybackRate = looks.speed;
  }, [looks.speed, shown]);

  const send = async (note: string) => {
    if (!probe || !document.source || !video.current) throw new Error("The video isn't read yet.");
    video.current.pause();
    const operation = { op: "mark", ...composedWhen(video.current.currentTime, rangeStart), box, note };
    const mark = applyOperation(document, operation).document.marks.at(-1)!;
    const frame = await capturedFrame(video.current, probe, filter, mark.box);
    window.mirador.apply(operation);
    await window.mirador.prompt(markMessage(document.source.file, probe, mark, { exposure: looks.exposure, frame: previewing ? edits : NO_EDITS }, video.current.currentTime), { images: [frame] });
    setBox(null);
    setRangeStart(null);
    return mark.id;
  };

  if (!document.source) return null;

  const atThisFrame = document.marks.filter((mark) => mark.box && !mark.done && (mark.end === null ? frameAt(mark.at, fps) === frameAt(time, fps) : time >= mark.at && time <= mark.end));
  const boxes: ShownBox[] = [
    ...(mode === "rendered" ? [] : atThisFrame.map((mark) => ({ key: mark.id, box: mark.box!, label: mark.id }))),
    ...(box && mode !== "rendered" ? [{ key: "new", box, label: "new" }] : []),
  ];
  const problem = shown && "problem" in shown ? shown.problem : null;

  return (
    <main>
      <Header
        file={document.source.file}
        facts={probe ? `${probe.width}×${probe.height} · ${Math.round(probe.fps * 100) / 100} fps · ${formatTime(probe.duration)}` : "reading…"}
        document={document}
        mode={mode}
        onShow={show}
      />
      {problem && <p className="problem">{problem}</p>}
      <Player
        video={video}
        src={shown && "url" in shown ? shown.url : null}
        filter={filter}
        frameEdits={previewing ? edits : NO_EDITS}
        boxes={boxes}
        canDraw={mode !== "rendered" && !!probe}
        onBox={setBox}
      />
      <div className="controls">
        <button type="button" aria-label="Previous frame" onClick={() => step(-1)}>
          ◀︎
        </button>
        <button type="button" aria-label={playhead.playing ? "Pause" : "Play"} onClick={togglePlay}>
          {playhead.playing ? "❚❚" : "▶︎"}
        </button>
        <button type="button" aria-label="Next frame" onClick={() => step(1)}>
          ▶︎❙
        </button>
        <span className="time" aria-label="Current time">
          {formatTime(time)} / {formatTime(playhead.duration)}
        </span>
        <Timeline
          duration={playhead.duration}
          time={time}
          kept={mode === "rendered" ? null : editedParts}
          settings={mode === "rendered" ? null : edits}
          marks={mode === "rendered" ? [] : document.marks}
          rangeStart={rangeStart}
          onSeek={(seconds) => seek(seconds)}
        />
      </div>
      <EditsLine mode={mode} edits={document.edits} />
      <TaskBar task={task} document={document} />
      {mode !== "rendered" && probe && (
        <Composer
          where={<MomentAndBox probe={probe} time={time} box={box} rangeStart={rangeStart} onRange={setRangeStart} onClearBox={() => setBox(null)} />}
          send={send}
        />
      )}
      <MarkList document={document} onSeek={seek} />
    </main>
  );
}
