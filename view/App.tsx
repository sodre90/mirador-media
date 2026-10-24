import type { AppDocumentState } from "../mirador/api.ts";
import type { MediaDocument } from "../shared/document.ts";
import { useProbeOnce } from "./parts.tsx";
import { VideoEditor } from "./VideoEditor.tsx";

export function App({ state }: { state: AppDocumentState<MediaDocument> }) {
  useProbeOnce(state.document, state.task);
  if (!state.document.source) {
    return (
      <main className="empty">
        <p>No video yet. Ask the agent to open one here, e.g. “open clip.mp4 in the media app”.</p>
      </main>
    );
  }
  return <VideoEditor state={state} />;
}
