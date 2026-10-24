import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppTaskState } from "../mirador/api.ts";
import { wholeClipEdits } from "../shared/describe.ts";
import { hasEdits, renderedName, sameEdits, type Box, type Mark, type MediaDocument } from "../shared/document.ts";
import { formatTime } from "../shared/time.ts";

export type Mode = "preview" | "source" | "rendered";

const MODE_TITLES: Record<Mode, string> = { preview: "Preview", source: "Source", rendered: "Rendered" };

const TASK_TITLES: Record<string, string> = { probe: "Reading", render: "Rendering" };

/** The address the view streams a file next to the document from, asked for again when `version` changes. */
export function useMediaUrl(file: string | null, version: unknown) {
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

/** Reads the video or photo once a source has none of what the probe reads, unless a task is already running. */
export function useProbeOnce(document: MediaDocument | undefined, task: AppTaskState | null) {
  const asked = useRef<string | null>(null);
  const source = document?.source;
  useEffect(() => {
    if (!source || source.probe || asked.current === source.file || task?.state === "running") return;
    asked.current = source.file;
    window.mirador.run("probe");
  }, [source, task?.state]);
}

/** A mark as the pane numbers it: m3 is 3. */
export const markNumber = (mark: Pick<Mark, "id">) => mark.id.replace(/^m/, "");

/** The Render button, or the task under way with its progress and a way to stop it. */
function TaskControl({ task, document }: { task: AppTaskState | null; document: MediaDocument }) {
  if (task?.state === "running") {
    return (
      <span className="task running" role="status" title={task.text ?? task.title}>
        <progress value={task.done ?? undefined} max={1} />
        <span>
          {TASK_TITLES[task.name] ?? task.title}
          {task.done === null ? "…" : ` ${Math.round(task.done * 100)}%`}
        </span>
        <button type="button" onClick={() => window.mirador.stopTask()}>
          Stop
        </button>
      </span>
    );
  }
  const output = document.source && renderedName(document.source.file);
  return (
    <button type="button" className="primary" disabled={!document.source} onClick={() => window.mirador.run("render")} title={output ? `Render the edits into ${output}` : undefined}>
      Render
    </button>
  );
}

/** The file, what the probe read of it, which of the preview, the source and the render the pane shows, and the render. */
export function Header({
  file,
  facts,
  document,
  task,
  mode,
  onShow,
}: {
  file: string;
  facts: string;
  document: MediaDocument;
  task: AppTaskState | null;
  mode: Mode;
  onShow: (mode: Mode) => void;
}) {
  const renderedIsCurrent = document.rendered && sameEdits(document.rendered.edits, document.edits);
  return (
    <header>
      <strong className="file" title={file}>
        {file}
      </strong>
      <span className="facts">{facts}</span>
      <div className="modes" role="group" aria-label="Show">
        {(Object.keys(MODE_TITLES) as Mode[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            disabled={candidate === "rendered" && !document.rendered}
            title={candidate === "rendered" && document.rendered && !renderedIsCurrent ? "Rendered with older edits" : undefined}
            onClick={() => onShow(candidate)}
          >
            {MODE_TITLES[candidate]}
            {candidate === "rendered" && document.rendered && !renderedIsCurrent ? " (older)" : ""}
          </button>
        ))}
      </div>
      <TaskControl task={task} document={document} />
    </header>
  );
}

/** How the latest render went, and a failed or stopped task; reading the file needs no word when it works. */
export function TaskResult({ task, document, mode, onShowRendered }: { task: AppTaskState | null; document: MediaDocument; mode: Mode; onShowRendered: () => void }) {
  if (!task || task.state === "running") return null;
  if (task.state === "failed") return <p className="task-result failed">{`${task.title} failed: ${task.problem}`}</p>;
  if (task.state === "stopped") return <p className="task-result">{`${task.title} was stopped.`}</p>;
  if (task.name !== "render" || !document.rendered) return null;
  return (
    <p className="task-result">
      Rendered {document.rendered.file}.
      {mode !== "rendered" && (
        <button type="button" className="link" onClick={onShowRendered}>
          Compare it
        </button>
      )}
    </p>
  );
}

/** The edits of the whole picture as chips, each taken off with its ×; what the source and the render show, in their modes. */
export function EditChips({ mode, document }: { mode: Mode; document: MediaDocument }) {
  const { edits, rendered } = document;
  if (mode === "source") return hasEdits(edits) ? <p className="chips-note">As shot · Preview shows the edits</p> : null;
  if (mode === "rendered") return rendered && <p className="chips-note">The render: {rendered.file}</p>;
  const chips = wholeClipEdits(edits);
  if (chips.length === 0) return null;
  return (
    <ul className="chips" aria-label="Edits of the whole picture">
      {chips.map(({ name, value, undo }) => (
        <li key={name} className="chip">
          <b>{name}</b> {value}
          <button type="button" aria-label={`Take off the ${name.toLowerCase()}`} title={`Take off the ${name.toLowerCase()}`} onClick={() => window.mirador.apply(undo)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The box drawn for the note, which a press clears, or how to draw one. */
export const BoxToggle = ({ box, onClear, hint }: { box: Box | null; onClear: () => void; hint: string }) =>
  box ? (
    <button type="button" className="toggle on" aria-label="Clear the box" title="Clear the box" onClick={onClear}>
      ▢ {box.width}×{box.height} ×
    </button>
  ) : (
    <span className="hint">▢ {hint}</span>
  );

const describeMarkTime = ({ at, end }: Mark) => (end === null ? formatTime(at) : `${formatTime(at)}–${formatTime(end)}`);

/** The marks, numbered as on the frame and the timeline, each ticked off when dealt with; a video's go to their moment. */
export function MarkList({ document, onSeek }: { document: MediaDocument; onSeek?: (seconds: number) => void }) {
  if (document.marks.length === 0) return null;
  return (
    <ol className="marks" aria-label="Marks">
      {document.marks.map((mark) => (
        <li key={mark.id} className={mark.done ? "done" : undefined}>
          <span className="badge" title={mark.id}>
            {markNumber(mark)}
          </span>
          {onSeek && (
            <button type="button" className="time-chip" aria-label={`Go to ${mark.id}`} onClick={() => onSeek(mark.at)}>
              {describeMarkTime(mark)}
            </button>
          )}
          <span className="note">{mark.note}</span>
          <input
            type="checkbox"
            className="check"
            checked={mark.done}
            aria-label={`${mark.id} done`}
            title={mark.done ? "Open it again" : "Done"}
            onChange={(event) => window.mirador.apply({ op: "mark-done", mark: mark.id, done: event.target.checked })}
          />
          <button type="button" className="remove" aria-label={`Remove ${mark.id}`} title="Remove" onClick={() => window.mirador.apply({ op: "remove-mark", mark: mark.id })}>
            ×
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The note the user writes about what they marked, over what is marked and its sending, like a message to the agent. */
export function Composer({ marked, send }: { marked: ReactNode; send: (note: string) => Promise<string> }) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ sending: boolean; text: string } | null>(null);
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
  const canSend = note.trim() !== "" && !status?.sending;
  return (
    <div className="composer">
      <textarea
        value={note}
        rows={Math.min(6, Math.max(2, note.split("\n").length))}
        placeholder="What's wrong here? (Enter to send, Shift+Enter for a new line)"
        aria-label="What's wrong here"
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (canSend) void submit();
        }}
      />
      <div className="composer-row">
        <div className="marked">{marked}</div>
        <button type="button" className="primary" aria-label="Send to the agent" disabled={!canSend} onClick={() => void submit()}>
          Send ↵
        </button>
      </div>
      {status && (
        <p className="compose-status" role="status">
          {status.text}
        </p>
      )}
    </div>
  );
}
