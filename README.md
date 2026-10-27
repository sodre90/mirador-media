# Media for Mirador

A [Mirador](https://github.com/sodre90/mirador) app for editing a video or a photo with the agent. You show the agent
what's wrong instead of describing it in words, and the agent changes it.

- **Watch the video** in a canvas tab. Play it, scrub through it and step one frame at a time.
- **Mark where:** a moment or a range, and maybe a box drawn on the frame. Type what's wrong there and send it. The agent
  gets the file, the time and frame number and the box in the source's pixels, as words: it looks at the frame itself
  when it needs to see it. On a touchscreen, such as the phone's, a finger scrubs, draws the box and removes marks.
- **The agent edits** with operations: trim, cut a part out, and set the exposure, speed and volume, for the whole clip
  or for a range, whose value then replaces the clip's there. It crops the frame, straightens it by up to 45° and turns
  it by quarter turns, for the whole clip. The source file stays as it was. The edits are a list in the app's document,
  and every one can be undone.
- **The pane previews edits at once:** playback keeps to what the trim and the cuts keep, at each range's speed, as bright
  and as loud as it is set there, in the frame the crop, the straightening and the turn make. Boxes you draw there are
  still in the source's pixels. An edit of the whole picture shows as a chip above it, which you take off with its ×.
  Under it, the timeline shows the video's frames with what the trim and the cuts take out hatched, a lane for each
  setting a range changes, and the marks. When its edits are done, the agent renders them into `clip.edited.mp4` next
  to `clip.mp4` (a WebM stays WebM). Each render replaces the previous one, and you compare the rendered file with the
  source in the pane, at the same moment of the video.
- **Marks stay as notes** on the timeline. The agent ticks each one off when it has dealt with it.
- **Photos too:** a JPEG, PNG or WebP opens the same way. You draw a box on it and send a note; the agent sets its
  exposure, crops, straightens and turns it, and renders `photo.edited.jpg` in the photo's own format. A phone photo
  shows upright, as its EXIF orientation says, in the pane and in the render alike. The render keeps the photo's EXIF, such
  as when and where it was taken and the camera, set upright and to its new size, without the old thumbnail.
- **iPhone photos:** a HEIC or HEIF photo opens too. No browser shows HEIC, so the app has ffmpeg decode it into a hidden
  PNG beside it (`.IMG_1234.HEIC.png`), and renders it as a JPEG, `IMG_1234.edited.jpg`. Display P3 colours keep their
  profile. An HDR photo, PQ or HLG as some cameras shoot HEIF, is brought to SDR, and an iPhone's HDR gain map isn't
  carried into the render.
- **Files to choose from:** in place of one video, the agent can list sounds, videos or photos, such as takes of a voice
  (`{ op: "items", items: [{ file: "takes/a.wav", label: "Take 1", group: "Narrator" }] }`). They show as a grid of
  cards in their groups, each playing in place, one at a time. Choose one per group with its Choose button; the agent
  sees the choices in the document. Play or pick one and type a note, and the agent gets "About Take 1 (takes/a.wav): …".

The app's document is a `.media.json` file next to the video or photo. Ask the agent something like "open clip.mp4 in
the media app". It calls `app_open` on `clip.mp4`, which starts `clip.media.json` beside it on that video, or opens it
again. A video and a photo of the same name, such as `IMG_1234.HEIC` and `IMG_1234.JPG`, share one document, and its
source says which it edits; `{ op: "source", file: "IMG_1234.JPG" }` switches it.

## Install

In Mirador, Settings → Plugins → install from this repository's git address. Mirador runs `bun install && bun run build`.

ffmpeg and ffprobe aren't in this repository. At install, `scripts/fetch-ffmpeg.ts` downloads static ffmpeg 9.0.2 builds
for your machine (macOS or Linux, Apple silicon, Intel or ARM) from [martin-riedl.de](https://ffmpeg.martin-riedl.de),
checks them against the checksums pinned in `host/ffmpeg-build.ts`, and puts them in `node_modules/.cache`. Those
builds are GPL and configured with `--enable-nonfree`, so they may not be redistributed. This repository never ships
them.

## Develop

```bash
bun install
bun run build        # the view, into dist/view.js
bun run typecheck
bun run test         # unit tests, with real renders of generated clips
scripts/e2e.sh       # e2e in a Mirador test host, from a copy built in a temp folder (dist/ stays as it is); MIRADOR_DIR names Mirador's checkout (default: ../visualized-claude-sessions)
```

To use a working copy in your own Mirador, link it into Mirador's plugin folder and restart Mirador:
`ln -s "$PWD" ~/.mirador/plugins/media`.

- `mirador/host.ts` is the host module Mirador loads: parse, serialize, apply, describe, and the `probe` and `render`
  tasks. `mirador/api.ts` is a copy of Mirador's plugin API 2.
- `shared/` holds the document, its operations and what the agent reads. The view uses them too.
- `host/` runs ffmpeg and ffprobe.
- `view/` is the React view Mirador shows in the canvas.
