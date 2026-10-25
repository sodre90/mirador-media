import { useRef, useState } from "react";
import type { AppDocumentState } from "../mirador/api.ts";
import { NO_EDITS, shownFile, type Box, type MediaDocument } from "../shared/document.ts";
import { markMessage } from "../shared/mark-message.ts";
import { applyOperation } from "../shared/operations.ts";
import { exposurePreview } from "./frame.ts";
import { BoxToggle, Composer, EditChips, Header, markNumber, MarkList, TaskResult, useMediaUrl, type Mode } from "./parts.tsx";
import { Player, type ShownBox } from "./Player.tsx";

/** A photo, with its edits previewed, marked with a box. */
export function PhotoEditor({ state }: { state: AppDocumentState<MediaDocument> }) {
  const { document, task } = state;
  const image = useRef<HTMLImageElement>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [box, setBox] = useState<Box | null>(null);
  const probe = document.source?.probe ?? null;
  const sourceUrl = useMediaUrl(document.source && shownFile(document.source), null);
  const renderedUrl = useMediaUrl(mode === "rendered" ? (document.rendered?.file ?? null) : null, document.rendered?.at);
  const shown = mode === "rendered" ? renderedUrl : sourceUrl;
  const previewing = mode === "preview";
  const { edits } = document;
  const exposure = previewing ? edits.exposure.clip : 0;
  const filter = exposurePreview(exposure);

  const send = async (note: string) => {
    if (!probe || !document.source || !image.current) throw new Error("The photo isn't read yet.");
    const operation = { op: "mark", box, note };
    const mark = applyOperation(document, operation).document.marks.at(-1)!;
    window.mirador.apply(operation);
    await window.mirador.prompt(markMessage(document.source.file, probe, mark, { exposure, frame: previewing ? edits : NO_EDITS }, 0));
    setBox(null);
    return mark.id;
  };

  if (!document.source) return null;

  const boxes: ShownBox[] =
    mode === "rendered"
      ? []
      : [...document.marks.filter((mark) => mark.box && !mark.done).map((mark) => ({ key: mark.id, box: mark.box!, label: markNumber(mark) })), ...(box ? [{ key: "new", box, label: "new" }] : [])];
  const problem = shown && "problem" in shown ? shown.problem : null;

  return (
    <main>
      <Header file={document.source.file} facts={probe ? `${probe.width}×${probe.height}` : "reading…"} document={document} task={task} mode={mode} onShow={setMode} />
      <TaskResult task={task} document={document} mode={mode} onShowRendered={() => setMode("rendered")} />
      {problem && <p className="problem">{problem}</p>}
      <EditChips mode={mode} document={document} />
      <Player
        picture={{ kind: "photo", ref: image }}
        src={shown && "url" in shown ? shown.url : null}
        filter={filter}
        frameEdits={previewing ? edits : NO_EDITS}
        sizing={{ even: false }}
        boxes={boxes}
        canDraw={mode !== "rendered" && !!probe}
        onBox={setBox}
      />
      {mode !== "rendered" && probe && <Composer marked={<BoxToggle box={box} onClear={() => setBox(null)} hint="drag on the photo" />} send={send} />}
      <MarkList document={document} />
    </main>
  );
}
