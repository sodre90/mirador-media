import { useRef, useState } from "react";
import type { AppDocumentState } from "../mirador/api.ts";
import { NO_EDITS, type Box, type MediaDocument } from "../shared/document.ts";
import { markMessage } from "../shared/mark-message.ts";
import { applyOperation } from "../shared/operations.ts";
import { capturedFrame, exposurePreview } from "./frame.ts";
import { ClearBox, Composer, EditsLine, Header, MarkList, TaskBar, useMediaUrl, type Mode } from "./parts.tsx";
import { Player, type ShownBox } from "./Player.tsx";

/** A photo, with its edits previewed, marked with a box. */
export function PhotoEditor({ state }: { state: AppDocumentState<MediaDocument> }) {
  const { document, task } = state;
  const image = useRef<HTMLImageElement>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [box, setBox] = useState<Box | null>(null);
  const probe = document.source?.probe ?? null;
  const sourceUrl = useMediaUrl(document.source?.file ?? null, null);
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
    const picture = await capturedFrame(image.current, probe, filter, mark.box);
    window.mirador.apply(operation);
    await window.mirador.prompt(markMessage(document.source.file, probe, mark, { exposure, frame: previewing ? edits : NO_EDITS }, 0), { images: [picture] });
    setBox(null);
    return mark.id;
  };

  if (!document.source) return null;

  const boxes: ShownBox[] =
    mode === "rendered"
      ? []
      : [...document.marks.filter((mark) => mark.box && !mark.done).map((mark) => ({ key: mark.id, box: mark.box!, label: mark.id })), ...(box ? [{ key: "new", box, label: "new" }] : [])];
  const problem = shown && "problem" in shown ? shown.problem : null;

  return (
    <main>
      <Header file={document.source.file} facts={probe ? `${probe.width}×${probe.height}` : "reading…"} document={document} mode={mode} onShow={setMode} />
      {problem && <p className="problem">{problem}</p>}
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
      <EditsLine mode={mode} edits={edits} />
      <TaskBar task={task} document={document} />
      {mode !== "rendered" && probe && (
        <Composer
          where={
            <>
              <span>{box ? `box ${box.width}×${box.height} px` : "drag across the photo to draw a box"}</span>
              <ClearBox box={box} onClear={() => setBox(null)} />
            </>
          }
          send={send}
        />
      )}
      <MarkList document={document} />
    </main>
  );
}
