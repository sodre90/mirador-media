import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppDocumentState } from "../mirador/api.ts";
import { changesSetting, NO_EDITS, type Box, type MediaDocument } from "../shared/document.ts";
import { markMessage } from "../shared/mark-message.ts";
import { applyOperation } from "../shared/operations.ts";
import { formatTime, frameAt, frameMiddle } from "../shared/time.ts";
import { keptMoment, keptParts, keptPieces, looksAt, removedParts, resultTime, sourceTime } from "../shared/timeline.ts";
import { capturedFrame, exposurePreview } from "./frame.ts";
import { NextFrameIcon, PauseIcon, PlayIcon, PreviousFrameIcon } from "./icons.tsx";
import { BoxToggle, Composer, EditChips, Header, markNumber, MarkList, TaskResult, useMediaUrl, type Mode } from "./parts.tsx";
import { usePlayhead } from "./playhead.ts";
import { Player, type ShownBox } from "./Player.tsx";
import { useSoundLevel } from "./sound.ts";
import { useThumbnails } from "./thumbnails.ts";
import { Timeline } from "./Timeline.tsx";

const DEFAULT_FPS = 30;

/** Where the composer's mark is: a moment, or a range from where it started to now, and maybe a box. */
const composedWhen = (time: number, rangeStart: number | null) =>
  rangeStart === null ? { at: time, end: null } : { at: Math.min(rangeStart, time), end: Math.max(rangeStart, time) };

/** What the note is about: the moment, or the range from where it started to now, and the box. */
function MomentAndBox({ time, box, rangeStart, onRange, onClearBox }: { time: number; box: Box | null; rangeStart: number | null; onRange: (start: number | null) => void; onClearBox: () => void }) {
  const when = composedWhen(time, rangeStart);
  return (
    <>
      <span className="when">{when.end === null ? `at ${formatTime(when.at)}` : `${formatTime(when.at)}–${formatTime(when.end)}`}</span>
      <button
        type="button"
        className={`toggle${rangeStart === null ? "" : " on"}`}
        aria-label={rangeStart === null ? "Start a range here" : "Just this moment"}
        title={rangeStart === null ? "Start a range here, then play or scrub to its end" : "Just this moment"}
        onClick={() => onRange(rangeStart === null ? time : null)}
      >
        ⟷ Range
      </button>
      <BoxToggle box={box} onClear={onClearBox} hint="drag on the frame" />
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
  const shownUrl = shown && "url" in shown ? shown.url : null;
  const playhead = usePlayhead(video, shownUrl, playOnlyKeptPieces);
  const time = playhead.time;
  const thumbnails = useThumbnails(shownUrl);

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
    ...(mode === "rendered" ? [] : atThisFrame.map((mark) => ({ key: mark.id, box: mark.box!, label: markNumber(mark) }))),
    ...(box && mode !== "rendered" ? [{ key: "new", box, label: "new" }] : []),
  ];
  const problem = shown && "problem" in shown ? shown.problem : null;

  return (
    <main>
      <Header
        file={document.source.file}
        facts={probe ? `${probe.width}×${probe.height} · ${Math.round(probe.fps * 100) / 100} fps · ${formatTime(probe.duration)}` : "reading…"}
        document={document}
        task={task}
        mode={mode}
        onShow={show}
      />
      <TaskResult task={task} document={document} mode={mode} onShowRendered={() => show("rendered")} />
      {problem && <p className="problem">{problem}</p>}
      <EditChips mode={mode} document={document} />
      <Player
        picture={{ kind: "video", ref: video }}
        src={shownUrl}
        filter={filter}
        frameEdits={previewing ? edits : NO_EDITS}
        sizing={{ even: true }}
        boxes={boxes}
        canDraw={mode !== "rendered" && !!probe}
        onBox={setBox}
      />
      <div className="transport">
        <button type="button" className="icon" aria-label="Previous frame" title="Previous frame (←)" onClick={() => step(-1)}>
          <PreviousFrameIcon />
        </button>
        <button type="button" className="icon play" aria-label={playhead.playing ? "Pause" : "Play"} title={playhead.playing ? "Pause (Space)" : "Play (Space)"} onClick={togglePlay}>
          {playhead.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="icon" aria-label="Next frame" title="Next frame (→)" onClick={() => step(1)}>
          <NextFrameIcon />
        </button>
        <span className="time" aria-label="Current time" title={probe ? `Frame ${frameAt(time, probe.fps)}` : undefined}>
          <b>{formatTime(time)}</b> <span>/ {formatTime(playhead.duration)}</span>
        </span>
        <span className="hint keys">Space plays · ← → step a frame</span>
      </div>
      <Timeline
        duration={playhead.duration}
        time={time}
        thumbnails={thumbnails}
        removed={mode === "rendered" ? [] : removedParts(edits, playhead.duration)}
        settings={mode === "rendered" ? null : edits}
        marks={mode === "rendered" ? null : document.marks}
        rangeStart={rangeStart}
        onSeek={(seconds) => seek(seconds)}
      />
      {mode !== "rendered" && probe && <Composer marked={<MomentAndBox time={time} box={box} rangeStart={rangeStart} onRange={setRangeStart} onClearBox={() => setBox(null)} />} send={send} />}
      <MarkList document={document} onSeek={seek} />
    </main>
  );
}
