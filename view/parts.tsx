import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppTaskState } from "../mirador/api.ts";
import { describeEdits } from "../shared/describe.ts";
import { hasEdits, renderedName, sameEdits, type Box, type Edits, type MediaDocument } from "../shared/document.ts";
import { describeWhen } from "../shared/operations.ts";

export type Mode = "preview" | "source" | "rendered";

const MODE_TITLES: Record<Mode, string> = { preview: "Preview", source: "Source", rendered: "Rendered" };

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

export function TaskBar({ task, document }: { task: AppTaskState | null; document: MediaDocument }) {
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

/** The file, what the probe read of it, and which of the preview, the source and the render the pane shows. */
export function Header({ file, facts, document, mode, onShow }: { file: string; facts: string; document: MediaDocument; mode: Mode; onShow: (mode: Mode) => void }) {
  const renderedIsCurrent = document.rendered && sameEdits(document.rendered.edits, document.edits);
  return (
    <header>
      <strong>{file}</strong>
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
    </header>
  );
}

export function EditsLine({ mode, edits }: { mode: Mode; edits: Edits }) {
  return (
    <p className="edits">
      {mode === "source" ? "As shot. " : ""}Edits: {describeEdits(edits)}
      {mode !== "preview" && hasEdits(edits) ? " (Preview shows them)" : ""}
    </p>
  );
}

export const ClearBox = ({ box, onClear }: { box: Box | null; onClear: () => void }) =>
  box && (
    <button type="button" className="link" onClick={onClear}>
      Clear the box
    </button>
  );

/** The marks, each ticked off when dealt with; a video's go to their moment, while a photo's have none. */
export function MarkList({ document, onSeek }: { document: MediaDocument; onSeek?: (seconds: number) => void }) {
  if (document.marks.length === 0) return null;
  return (
    <ul className="marks" aria-label="Marks">
      {document.marks.map((mark) => (
        <li key={mark.id} className={mark.done ? "done" : undefined}>
          <input type="checkbox" checked={mark.done} aria-label={`${mark.id} done`} onChange={(event) => window.mirador.apply({ op: "mark-done", mark: mark.id, done: event.target.checked })} />
          {onSeek ? (
            <button type="button" className="link" onClick={() => onSeek(mark.at)}>
              {mark.id} {describeWhen(mark)}
            </button>
          ) : (
            <span>{mark.id}</span>
          )}
          <span className="note">{mark.note}</span>
          <button type="button" className="remove" aria-label={`Remove ${mark.id}`} onClick={() => window.mirador.apply({ op: "remove-mark", mark: mark.id })}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The note the user writes about what they marked, and its sending; `where` says what is marked. */
export function Composer({ where, send }: { where: ReactNode; send: (note: string) => Promise<string> }) {
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
  return (
    <div className="composer">
      <div className="where">{where}</div>
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

