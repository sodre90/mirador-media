import { useCallback, useEffect, useRef, useState } from "react";
import type { AppDocumentState, AppTaskState } from "../mirador/api.ts";
import { describeEdits } from "../shared/describe.ts";
import { hasEdits, NO_EDITS, renderedName, sameEdits, type Box, type MediaDocument, type Probe } from "../shared/document.ts";
import { markMessage } from "../shared/mark-message.ts";
import { applyOperation, describeWhen } from "../shared/operations.ts";
import { formatTime, frameAt, frameMiddle } from "../shared/time.ts";
import { capturedFrame, exposurePreview } from "./frame.ts";
import { usePlayhead } from "./playhead.ts";
import { Player, type ShownBox } from "./Player.tsx";
import { Timeline } from "./Timeline.tsx";

type Mode = "preview" | "source" | "rendered";

const MODE_TITLES: Record<Mode, string> = { preview: "Preview", source: "Source", rendered: "Rendered" };

const DEFAULT_FPS = 30;

/** The address the view streams a file next to the document from, asked for again when `version` changes. */
function useMediaUrl(file: string | null, version: unknown) {
  const [url, setUrl] = useState<{ file: string; url: string } | { file: string; problem: string } | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    let current = true;
    window.mirador.mediaUrl(file).then(
      (address) => current && setUrl({ file, url: address }),
      (error: Error) => current && setUrl({ file, problem: error.message }),
    );
    return () => void (current = false);
  }, [file, version]);
  return url?.file === file ? url : null;
}

/** Reads the video once a source has none of what the probe reads, unless a task is already running. */
function useProbeOnce(document: MediaDocument | undefined, task: AppTaskState | null) {
  const asked = useRef<string | null>(null);
  const source = document?.source;
  useEffect(() => {
    if (!source || source.probe || asked.current === source.file || task?.state === "running") return;
    asked.current = source.file;
    window.mirador.run("probe");
  }, [source, task?.state]);
}

function TaskBar({ task, document }: { task: AppTaskState | null; document: MediaDocument }) {
  const output = document.source && renderedName(document.source.file);
  if (task?.state === "running") {
    return (
      <div className="task running" role="status">
        <progress value={task.done ?? undefined} max={1} />
        <span>
          {task.title}
          {task.text ? `: ${task.text}` : "…"}
        </span>
        <button type="button" onClick={() => window.mirador.stopTask()}>
          Stop
        </button>
      </div>
    );
  }
  const ended = task && { done: task.summary, failed: `${task.title} failed: ${task.problem}`, stopped: `${task.title} was stopped.` }[task.state];
  return (
    <div className="task">
      <button type="button" disabled={!document.source} onClick={() => window.mirador.run("render")} title={output ? `Render the edits into ${output}` : undefined}>
        Render
      </button>
      {ended && <span className={task.state}>{ended}</span>}
    </div>
  );
}

function MarkList({ document, onSeek }: { document: MediaDocument; onSeek: (seconds: number) => void }) {
  if (document.marks.length === 0) return null;
  return (
    <ul className="marks" aria-label="Marks">
      {document.marks.map((mark) => (
        <li key={mark.id} className={mark.done ? "done" : undefined}>
          <input type="checkbox" checked={mark.done} aria-label={`${mark.id} done`} onChange={(event) => window.mirador.apply({ op: "mark-done", mark: mark.id, done: event.target.checked })} />
          <button type="button" className="link" onClick={() => onSeek(mark.at)}>
            {mark.id} {describeWhen(mark)}
          </button>
          <span className="note">{mark.note}</span>
          <button type="button" className="remove" aria-label={`Remove ${mark.id}`} onClick={() => window.mirador.apply({ op: "remove-mark", mark: mark.id })}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Where the composer's mark is: a moment, or a range from where it started to now, and maybe a box. */
const composedWhen = (time: number, rangeStart: number | null) =>
  rangeStart === null ? { at: time, end: null } : { at: Math.min(rangeStart, time), end: Math.max(rangeStart, time) };

function Composer({
  probe,
  time,
  box,
  rangeStart,
  onRange,
  onClearBox,
  send,
}: {
  probe: Probe;
  time: number;
  box: Box | null;
  rangeStart: number | null;
  onRange: (start: number | null) => void;
  onClearBox: () => void;
  send: (note: string) => Promise<string>;
}) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ sending: boolean; text: string } | null>(null);
  const when = composedWhen(time, rangeStart);
  const submit = async () => {
    setStatus({ sending: true, text: "Sending…" });
    try {
      const id = await send(note);
      setNote("");
      setStatus({ sending: false, text: `Sent to the agent as ${id}.` });
    } catch (error) {
      setStatus({ sending: false, text: (error as Error).message });
    }
  };
  return (
    <div className="composer">
      <div className="where">
        <span>
          {describeWhen(when)} · frame {frameAt(when.at, probe.fps)}
          {box ? ` · box ${box.width}×${box.height} px` : " · drag across the frame to draw a box"}
        </span>
        {box && (
          <button type="button" className="link" onClick={onClearBox}>
            Clear the box
          </button>
        )}
        <button type="button" className="link" onClick={() => onRange(rangeStart === null ? time : null)}>
          {rangeStart === null ? "Start a range here" : "Just this moment"}
        </button>
      </div>
      <textarea
        value={note}
        placeholder="What's wrong here? e.g. too dark"
        aria-label="What's wrong here"
        rows={2}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (note.trim()) void submit();
          }
        }}
      />
      <div className="send">
        <button type="button" disabled={!note.trim() || status?.sending} onClick={() => void submit()}>
          Send to the agent
        </button>
        {status && <span role="status">{status.text}</span>}
      </div>
    </div>
  );
}

const typingIn = (target: EventTarget | null) => target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;

export function App({ state }: { state: AppDocumentState<MediaDocument> }) {
  const { document, task } = state;
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [box, setBox] = useState<Box | null>(null);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  useProbeOnce(document, task);

  const probe = document.source?.probe ?? null;
  const fps = probe?.fps ?? DEFAULT_FPS;
  const sourceUrl = useMediaUrl(document.source?.file ?? null, null);
  const renderedUrl = useMediaUrl(mode === "rendered" ? (document.rendered?.file ?? null) : null, document.rendered?.at);
  const shown = mode === "rendered" ? renderedUrl : sourceUrl;
  const previewing = mode === "preview";
  const trim = previewing ? document.edits.trim : null;

  const holdInsideTrim = useCallback(
    (time: number) => {
      const element = video.current;
      if (!element || !trim || element.paused || time < trim.end) return;
      element.pause();
      element.currentTime = trim.end;
    },
    [trim],
  );
  const playhead = usePlayhead(video, shown && "url" in shown ? shown.url : null, holdInsideTrim);
  const time = playhead.time;

  const hasVideo = document.source !== null;
  const renderedFrom = document.rendered?.edits.trim?.start ?? 0;
  const pendingSeek = useRef<number | null>(null);
  const show = (next: Mode) => {
    const crossing = (mode === "rendered") !== (next === "rendered");
    if (crossing && video.current) pendingSeek.current = Math.max(0, video.current.currentTime + (next === "rendered" ? -renderedFrom : renderedFrom));
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

  const seek = (seconds: number) => {
    const element = video.current;
    if (!element) return;
    const [from, to] = trim ? [trim.start, trim.end] : [0, playhead.duration || Infinity];
    element.currentTime = Math.min(to, Math.max(from, seconds));
  };
  const step = (frames: number) => {
    video.current?.pause();
    seek(frameMiddle(frameAt(time, fps) + frames, fps));
  };
  const togglePlay = () => {
    const element = video.current;
    if (!element) return;
    if (!element.paused) return element.pause();
    if (trim && (element.currentTime >= trim.end - 0.5 / fps || element.currentTime < trim.start)) element.currentTime = trim.start;
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

  const filter = previewing ? exposurePreview(document.edits.exposure) : "none";
  const shownEdits = previewing ? document.edits : NO_EDITS;

  const send = async (note: string) => {
    if (!probe || !document.source || !video.current) throw new Error("The video isn't read yet.");
    video.current.pause();
    const operation = { op: "mark", ...composedWhen(video.current.currentTime, rangeStart), box, note };
    const mark = applyOperation(document, operation).document.marks.at(-1)!;
    const frame = await capturedFrame(video.current, probe, filter, mark.box);
    window.mirador.apply(operation);
    await window.mirador.prompt(markMessage(document.source.file, probe, mark, shownEdits, video.current.currentTime), { images: [frame] });
    setBox(null);
    setRangeStart(null);
    return mark.id;
  };

  if (!document.source) {
    return (
      <main className="empty">
        <p>No video yet. Ask the agent to open one here, e.g. “open clip.mp4 in the media app”.</p>
      </main>
    );
  }

  const atThisFrame = document.marks.filter((mark) => mark.box && !mark.done && (mark.end === null ? frameAt(mark.at, fps) === frameAt(time, fps) : time >= mark.at && time <= mark.end));
  const boxes: ShownBox[] = [
    ...(mode === "rendered" ? [] : atThisFrame.map((mark) => ({ key: mark.id, box: mark.box!, label: mark.id }))),
    ...(box && mode !== "rendered" ? [{ key: "new", box, label: "new" }] : []),
  ];
  const renderedIsCurrent = document.rendered && sameEdits(document.rendered.edits, document.edits);
  const problem = shown && "problem" in shown ? shown.problem : null;

  return (
    <main>
      <header>
        <strong>{document.source.file}</strong>
        <span className="facts">{probe ? `${probe.width}×${probe.height} · ${Math.round(probe.fps * 100) / 100} fps · ${formatTime(probe.duration)}` : "reading…"}</span>
        <div className="modes" role="group" aria-label="Show">
          {(Object.keys(MODE_TITLES) as Mode[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              disabled={candidate === "rendered" && !document.rendered}
              title={candidate === "rendered" && document.rendered && !renderedIsCurrent ? "Rendered with older edits" : undefined}
              onClick={() => show(candidate)}
            >
              {MODE_TITLES[candidate]}
              {candidate === "rendered" && document.rendered && !renderedIsCurrent ? " (older)" : ""}
            </button>
          ))}
        </div>
      </header>
      {problem && <p className="problem">{problem}</p>}
      <Player video={video} src={shown && "url" in shown ? shown.url : null} filter={filter} source={probe} boxes={boxes} canDraw={mode !== "rendered" && !!probe} onBox={setBox} />
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
        <Timeline duration={playhead.duration} time={time} trim={mode === "rendered" ? null : document.edits.trim} marks={mode === "rendered" ? [] : document.marks} rangeStart={rangeStart} onSeek={seek} />
      </div>
      <p className="edits">
        {mode === "source" ? "As shot. " : ""}Edits: {describeEdits(document.edits)}
        {mode !== "preview" && hasEdits(document.edits) ? " (Preview shows them)" : ""}
      </p>
      <TaskBar task={task} document={document} />
      {mode !== "rendered" && probe && (
        <Composer probe={probe} time={time} box={box} rangeStart={rangeStart} onRange={setRangeStart} onClearBox={() => setBox(null)} send={send} />
      )}
      <MarkList document={document} onSeek={seek} />
    </main>
  );
}
