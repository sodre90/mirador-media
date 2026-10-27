import type { AppDocumentState } from "../mirador/api.ts";
import { isPhoto, type MediaDocument } from "../shared/document.ts";
import { ItemsGrid } from "./ItemsGrid.tsx";
import { useProbeOnce } from "./parts.tsx";
import { PhotoEditor } from "./PhotoEditor.tsx";
import { VideoEditor } from "./VideoEditor.tsx";

export function App({ state }: { state: AppDocumentState<MediaDocument> }) {
  useProbeOnce(state.document, state.task);
  if (state.document.items.length > 0) return <ItemsGrid items={state.document.items} />;
  if (!state.document.source) {
    return (
      <main className="empty">
        <p>No video or photo yet. Ask the agent to open one here, e.g. “open clip.mp4 in the media app”, or to list files here to choose from.</p>
      </main>
    );
  }
  return isPhoto(state.document.source.file) ? <PhotoEditor state={state} /> : <VideoEditor state={state} />;
}
