import ffprobePath from "@derhuerst/ffprobe-static";
import ffmpegPath from "ffmpeg-static";
import type { Edits, Probe } from "../shared/document.ts";
import { keptPieces } from "../shared/timeline.ts";

export const binaries = { ffmpeg: ffmpegPath, ffprobe: ffprobePath };

/** The preview brightens with CSS brightness(), which multiplies each sRGB channel; the render multiplies the same way. */
export const exposureFactor = (ev: number) => 2 ** ev;

export function exposureFilter(ev: number) {
  const factor = exposureFactor(ev).toFixed(6);
  return `lutrgb=r=val*${factor}:g=val*${factor}:b=val*${factor}`;
}

const seconds = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * ffmpeg's arguments to render the edits of `input` into `output`. It seeks to the first kept piece and reads to the end
 * of the last, takes each piece with its sound, and joins them. An MP4 gets its index first, so it plays while it streams.
 */
export function renderArguments(input: string, output: string, edits: Edits, probe: Probe) {
  const pieces = keptPieces(edits, probe.duration);
  if (pieces.length === 0) throw new Error("the edits leave nothing of the video");
  const [from, to] = [pieces[0]!.start, pieces.at(-1)!.end];
  const inRead = (time: number) => seconds(time - from);
  const pieceFilters = pieces.flatMap(({ start, end }, index) => [
    `[0:v]trim=start=${inRead(start)}:end=${inRead(end)},setpts=PTS-STARTPTS[v${index}]`,
    ...(probe.audio ? [`[0:a]atrim=start=${inRead(start)}:end=${inRead(end)},asetpts=PTS-STARTPTS[a${index}]`] : []),
  ]);
  const joined = pieces.map((_, index) => `[v${index}]${probe.audio ? `[a${index}]` : ""}`).join("");
  const looks = [...(edits.exposure !== 0 ? [exposureFilter(edits.exposure)] : []), "format=yuv420p"].join(",");
  const graph = [...pieceFilters, `${joined}concat=n=${pieces.length}:v=1:a=${probe.audio ? 1 : 0}[joined]${probe.audio ? "[sound]" : ""}`, `[joined]${looks}[picture]`].join(";");
  const webm = /\.webm$/i.test(output);
  const video = webm ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "30", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"];
  const sound = probe.audio ? ["-map", "[sound]", ...(webm ? ["-c:a", "libopus", "-b:a", "128k"] : ["-c:a", "aac", "-b:a", "192k"])] : [];
  return [
    ...["-hide_banner", "-nostdin", "-loglevel", "error", "-y"],
    ...["-ss", seconds(from), "-t", seconds(to - from), "-i", input],
    ...["-filter_complex", graph, "-map", "[picture]", ...video, ...sound],
    ...(webm ? [] : ["-movflags", "+faststart"]),
    ...["-progress", "pipe:1", "-nostats", output],
  ];
}

export const PROBE_ARGUMENTS = ["-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate:stream_side_data=rotation:format=duration", "-of", "json"];

interface ProbedStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  side_data_list?: { rotation?: number }[];
}

const rate = (fraction: string | undefined) => {
  const [numerator, denominator] = (fraction ?? "").split("/").map(Number);
  return numerator && denominator ? numerator / denominator : null;
};

/** The video's size as it is shown (a phone's portrait video is stored on its side), length, frame rate and whether it has sound. */
export function probeFrom(output: string): Probe {
  const { streams = [], format = {} } = JSON.parse(output) as { streams?: ProbedStream[]; format?: { duration?: string } };
  const video = streams.find(({ codec_type }) => codec_type === "video");
  if (!video?.width || !video.height) throw new Error("it has no video stream");
  const turned = Math.abs(video.side_data_list?.find(({ rotation }) => rotation !== undefined)?.rotation ?? 0) % 180 === 90;
  const fps = rate(video.avg_frame_rate) ?? rate(video.r_frame_rate) ?? 30;
  const duration = Number(format.duration);
  if (!Number.isFinite(duration)) throw new Error("ffprobe couldn't tell how long it is");
  return {
    width: turned ? video.height : video.width,
    height: turned ? video.width : video.height,
    duration: Math.round(duration * 1000) / 1000,
    fps: Math.round(fps * 1000) / 1000,
    audio: streams.some(({ codec_type }) => codec_type === "audio"),
  };
}

/** How far ffmpeg has got, in seconds of output, from a line of its -progress report. */
export function progressSeconds(line: string): number | null {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  return match ? Number(match[1]) / 1_000_000 : null;
}

async function eachChunk(stream: ReadableStream<string>, take: (chunk: string) => void) {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    take(value);
  }
}

const lastLines = (text: string) => text.trim().split("\n").slice(-5).join("\n");

/** Runs a program until it ends, killed when the signal aborts; each line it writes goes to `onLine`, and all of it is the result. */
export async function runProgram(binary: string | null, args: string[], signal: AbortSignal, onLine: (line: string) => void = () => {}) {
  if (!binary) throw new Error("ffmpeg-static has no binary for this machine; run bun install in the plugin's folder again");
  if (signal.aborted) throw new Error("stopped");
  const process = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const kill = () => process.kill();
  signal.addEventListener("abort", kill, { once: true });
  try {
    const errors = new Response(process.stderr).text();
    let written = "";
    let pending = "";
    await eachChunk(process.stdout.pipeThrough(new TextDecoderStream()), (chunk) => {
      written += chunk;
      const lines = (pending + chunk).split("\n");
      pending = lines.pop()!;
      lines.forEach(onLine);
    });
    const [code, complaint] = [await process.exited, await errors];
    if (signal.aborted) throw new Error("stopped");
    if (code !== 0) throw new Error(`${binary.split("/").pop()} failed: ${lastLines(complaint) || `exit code ${code}`}`);
    return written;
  } finally {
    signal.removeEventListener("abort", kill);
  }
}
