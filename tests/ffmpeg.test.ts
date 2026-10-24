import { describe, expect, test } from "bun:test";
import { exposureFilter, frameFilters, probeFrom, progressSeconds, renderArguments } from "../host/ffmpeg.ts";
import { NO_EDITS } from "../shared/document.ts";

describe("renderArguments", () => {
  const probe = { width: 1920, height: 1080, duration: 83.4, fps: 29.97, audio: true };
  const filterGraph = (args: string[]) => args[args.indexOf("-filter_complex") + 1]!.split(";");

  test("reads from the first kept piece to the end of the last, takes each with its sound and joins them, and brightens", () => {
    const args = renderArguments("/v/clip.mp4", "/v/.clip.edited.rendering.mp4", { ...NO_EDITS, trim: { start: 5, end: 44 }, cuts: [{ start: 12, end: 15.5 }], exposure: { clip: 1, ranges: [] } }, probe);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-i") + 2)).toEqual(["-ss", "5", "-t", "39", "-i", "/v/clip.mp4"]);
    expect(filterGraph(args)).toEqual([
      "[0:v]trim=start=0:end=7,setpts=PTS-STARTPTS,lutrgb=r=val*2.000000:g=val*2.000000:b=val*2.000000,format=yuv420p[v0]",
      "[0:a]atrim=start=0:end=7,asetpts=PTS-STARTPTS[a0]",
      "[0:v]trim=start=10.5:end=39,setpts=PTS-STARTPTS,lutrgb=r=val*2.000000:g=val*2.000000:b=val*2.000000,format=yuv420p[v1]",
      "[0:a]atrim=start=10.5:end=39,asetpts=PTS-STARTPTS[a1]",
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[picture][sound]",
    ]);
    expect(args.join(" ")).toContain("-map [picture] -c:v libx264 -preset veryfast -crf 18 -map [sound] -c:a aac");
    expect(args.slice(args.indexOf("-movflags"), args.indexOf("-movflags") + 2)).toEqual(["-movflags", "+faststart"]);
    expect(args.slice(-4)).toEqual(["-progress", "pipe:1", "-nostats", "/v/.clip.edited.rendering.mp4"]);
  });

  test("keeps all of a silent video when nothing is trimmed or cut, leaves the colours be at 0 EV, and writes VP9 for a WebM", () => {
    const args = renderArguments("/v/clip.webm", "/v/out.webm", NO_EDITS, { ...probe, audio: false });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-i"))).toEqual(["-ss", "0", "-t", "83.4"]);
    expect(filterGraph(args)).toEqual(["[0:v]trim=start=0:end=83.4,setpts=PTS-STARTPTS,format=yuv420p[v0]", "[v0]concat=n=1:v=1:a=0[picture]"]);
    expect(args).toContain("libvpx-vp9");
    expect(args).not.toContain("[sound]");
    expect(args).not.toContain("-movflags");
  });

  test("gives each piece its own speed, keeping the sound's pitch, its own volume and its own exposure", () => {
    const edits = {
      ...NO_EDITS,
      speed: { clip: 1, ranges: [{ start: 10, end: 12, value: 0.25 }, { start: 20, end: 30, value: 2 }] },
      volume: { clip: 1, ranges: [{ start: 25, end: 40, value: 0 }] },
      exposure: { clip: 0, ranges: [{ start: 10, end: 12, value: -1 }] },
    };
    const graph = filterGraph(renderArguments("/v/clip.mp4", "/v/out.mp4", { ...edits, trim: { start: 5, end: 40 } }, probe));
    expect(graph).toEqual([
      "[0:v]trim=start=0:end=5,setpts=PTS-STARTPTS,format=yuv420p[v0]",
      "[0:a]atrim=start=0:end=5,asetpts=PTS-STARTPTS[a0]",
      "[0:v]trim=start=5:end=7,setpts=(PTS-STARTPTS)/0.25,fps=29.97,lutrgb=r=val*0.500000:g=val*0.500000:b=val*0.500000,format=yuv420p[v1]",
      "[0:a]atrim=start=5:end=7,asetpts=PTS-STARTPTS,atempo=0.500000,atempo=0.500000[a1]",
      "[0:v]trim=start=7:end=15,setpts=PTS-STARTPTS,format=yuv420p[v2]",
      "[0:a]atrim=start=7:end=15,asetpts=PTS-STARTPTS[a2]",
      "[0:v]trim=start=15:end=20,setpts=(PTS-STARTPTS)/2,fps=29.97,format=yuv420p[v3]",
      "[0:a]atrim=start=15:end=20,asetpts=PTS-STARTPTS,atempo=2[a3]",
      "[0:v]trim=start=20:end=25,setpts=(PTS-STARTPTS)/2,fps=29.97,format=yuv420p[v4]",
      "[0:a]atrim=start=20:end=25,asetpts=PTS-STARTPTS,atempo=2,volume=0[a4]",
      "[0:v]trim=start=25:end=35,setpts=PTS-STARTPTS,format=yuv420p[v5]",
      "[0:a]atrim=start=25:end=35,asetpts=PTS-STARTPTS,volume=0[a5]",
      "[v0][a0][v1][a1][v2][a2][v3][a3][v4][a4][v5][a5]concat=n=6:v=1:a=1[picture][sound]",
    ]);
  });

  test("crops to an even size, straightens zoomed in about the crop's middle, then turns, after the pieces are joined", () => {
    const edits = { ...NO_EDITS, crop: { x: 101, y: 50, width: 641, height: 361 }, straighten: -3, turn: 90 as const };
    expect(frameFilters(probe, edits)).toEqual(["crop=640:360:101:50", "scale=700:394", "rotate=-0.052360:ow=640:oh=360", "transpose=clock"]);
    expect(frameFilters(probe, { ...NO_EDITS, turn: 180 })).toEqual(["hflip", "vflip"]);
    expect(frameFilters({ ...probe, width: 1919 }, NO_EDITS)).toEqual(["crop=1918:1080:0:0"]);
    expect(frameFilters(probe, NO_EDITS)).toEqual([]);
    expect(filterGraph(renderArguments("/v/clip.mp4", "/v/out.mp4", { ...NO_EDITS, turn: 270 }, probe)).slice(-2)).toEqual([
      "[v0][a0]concat=n=1:v=1:a=1[joined][sound]",
      "[joined]transpose=cclock[picture]",
    ]);
  });

  test("refuses edits that leave nothing", () => {
    expect(() => renderArguments("/v/a.mp4", "/v/b.mp4", { ...NO_EDITS, trim: { start: 1, end: 2 }, cuts: [{ start: 0.5, end: 3 }] }, probe)).toThrow("the edits leave nothing of the video");
  });

  test("darkens by the same factor CSS brightness() uses", () => {
    expect(exposureFilter(-1)).toBe("lutrgb=r=val*0.500000:g=val*0.500000:b=val*0.500000");
  });
});

describe("probeFrom", () => {
  test("reads the size, length, frame rate and sound, and the shown size of a video stored on its side", () => {
    const output = (rotation: number | null) =>
      JSON.stringify({
        streams: [
          { codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30000/1001", ...(rotation !== null && { side_data_list: [{ rotation }] }) },
          { codec_type: "audio" },
        ],
        format: { duration: "83.400000" },
      });
    expect(probeFrom(output(null))).toEqual({ width: 1920, height: 1080, duration: 83.4, fps: 29.97, audio: true });
    expect(probeFrom(output(-90))).toMatchObject({ width: 1080, height: 1920 });
    expect(probeFrom(output(180))).toMatchObject({ width: 1920, height: 1080 });
  });

  test("falls back on the stream's base rate, and refuses a file with no video", () => {
    const noAverage = JSON.stringify({ streams: [{ codec_type: "video", width: 64, height: 48, avg_frame_rate: "0/0", r_frame_rate: "10/1" }], format: { duration: "45" } });
    expect(probeFrom(noAverage)).toEqual({ width: 64, height: 48, duration: 45, fps: 10, audio: false });
    expect(() => probeFrom(JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "3" } }))).toThrow("it has no video stream");
  });
});

describe("progressSeconds", () => {
  test("reads the output time of ffmpeg's progress report, and nothing from its other lines", () => {
    expect(progressSeconds("out_time_us=12500000")).toBe(12.5);
    expect(progressSeconds("out_time=00:00:12.500000")).toBeNull();
    expect(progressSeconds("progress=continue")).toBeNull();
  });
});
