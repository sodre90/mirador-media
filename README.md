# Media for Mirador

A [Mirador](https://github.com/sodre90/mirador) app for editing a video with the agent. You show the agent what's wrong
instead of describing it in words, and the agent changes it.

- **Watch the video** in a canvas tab. Play it, scrub through it and step one frame at a time.
- **Mark where:** a moment or a range, and maybe a box drawn on the frame. Type what's wrong there and send it. The agent
  gets the file, the time and frame number, the box in the source's pixels, and the frame itself with the box drawn on it.
- **The agent edits** with operations: trim, cut a part out, and set the exposure, speed and volume, for the whole clip
  or for a range, whose value then replaces the clip's there. The source file stays as it was. The edits are a list in
  the app's document, and every one can be undone.
- **The pane previews edits at once:** playback keeps to what the trim and the cuts keep, at each range's speed, as bright
  and as loud as it is set there. When its edits are done, the agent renders them into `clip.edited.mp4` next to
  `clip.mp4` (a WebM stays WebM). Each render replaces the previous one, and you compare the rendered file with the
  source in the pane, at the same moment of the video.
- **Marks stay as notes** on the timeline. The agent ticks each one off when it has dealt with it.

The app's document is a `.media.json` file next to the video. Ask the agent something like "open clip.mp4 in the media
app". It opens `clip.media.json` with `app_open` and names the video with `{ op: "source", file: "clip.mp4" }`.

## Install

In Mirador, Settings → Plugins → install from this repository's git address. Mirador runs `bun install && bun run build`.

ffmpeg and ffprobe aren't in this repository. At install, the
[ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) and
[@derhuerst/ffprobe-static](https://github.com/derhuerst/ffprobe-static) packages download builds for your machine from
their own releases. Those builds are GPL, and the macOS one is built with `--enable-nonfree`, so it may not be
redistributed. This repository never ships them.

## Develop

```bash
bun install
bun run build        # the view, into dist/view.js
bun run typecheck
bun run test         # unit tests, with real renders of generated clips
scripts/e2e.sh       # e2e in a Mirador test host; MIRADOR_DIR names Mirador's checkout (default: ../visualized-claude-sessions)
```

To use a working copy in your own Mirador, link it into Mirador's plugin folder and restart Mirador:
`ln -s "$PWD" ~/.mirador/plugins/media`.

- `mirador/host.ts` is the host module Mirador loads: parse, serialize, apply, describe, and the `probe` and `render`
  tasks. `mirador/api.ts` is a copy of Mirador's plugin API 2.
- `shared/` holds the document, its operations and what the agent reads. The view uses them too.
- `host/` runs ffmpeg and ffprobe.
- `view/` is the React view Mirador shows in the canvas.
