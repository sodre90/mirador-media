import { describe, expect, test } from "bun:test";
import { exposureFilter, probeFrom, progressSeconds, renderArguments } from "../host/ffmpeg.ts";
import { NO_EDITS } from "../shared/document.ts";

describe("renderArguments", () => {
  const probe = { width: 1920, height: 1080, duration: 83.4, fps: 29.97, audio: true };
  const filterGraph = (args: string[]) => args[args.indexOf("-filter_complex") + 1]!.split(";");

  test("reads from the first kept piece to the end of the last, takes each with its sound and joins them, and brightens", () => {
    const args = renderArguments("/v/clip.mp4", "/v/.clip.edited.rendering.mp4", { trim: { start: 5, end: 44 }, cuts: [{ start: 12, end: 15.5 }], exposure: 1 }, probe);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-i") + 2)).toEqual(["-ss", "5", "-t", "39", "-i", "/v/clip.mp4"]);
    expect(filterGraph(args)).toEqual([
      "[0:v]trim=start=0:end=7,setpts=PTS-STARTPTS[v0]",
      "[0:a]atrim=start=0:end=7,asetpts=PTS-STARTPTS[a0]",
      "[0:v]trim=start=10.5:end=39,setpts=PTS-STARTPTS[v1]",
      "[0:a]atrim=start=10.5:end=39,asetpts=PTS-STARTPTS[a1]",
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[joined][sound]",
      "[joined]lutrgb=r=val*2.000000:g=val*2.000000:b=val*2.000000,format=yuv420p[picture]",
    ]);
    expect(args.join(" ")).toContain("-map [picture] -c:v libx264 -preset veryfast -crf 18 -map [sound] -c:a aac");
    expect(args.slice(args.indexOf("-movflags"), args.indexOf("-movflags") + 2)).toEqual(["-movflags", "+faststart"]);
    expect(args.slice(-4)).toEqual(["-progress", "pipe:1", "-nostats", "/v/.clip.edited.rendering.mp4"]);
  });

  test("keeps all of a silent video when nothing is trimmed or cut, leaves the colours be at 0 EV, and writes VP9 for a WebM", () => {
    const args = renderArguments("/v/clip.webm", "/v/out.webm", NO_EDITS, { ...probe, audio: false });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-i"))).toEqual(["-ss", "0", "-t", "83.4"]);
    expect(filterGraph(args)).toEqual(["[0:v]trim=start=0:end=83.4,setpts=PTS-STARTPTS[v0]", "[v0]concat=n=1:v=1:a=0[joined]", "[joined]format=yuv420p[picture]"]);
    expect(args).toContain("libvpx-vp9");
    expect(args).not.toContain("[sound]");
    expect(args).not.toContain("-movflags");
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
