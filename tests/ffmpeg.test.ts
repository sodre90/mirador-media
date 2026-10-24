import { describe, expect, test } from "bun:test";
import { exposureFilter, probeFrom, progressSeconds, renderArguments } from "../host/ffmpeg.ts";

describe("renderArguments", () => {
  test("seeks before the input and cuts the length after it, brightens, and writes an MP4 that plays while it streams", () => {
    const args = renderArguments("/v/clip.mp4", "/v/.clip.edited.rendering.mp4", { trim: { start: 5, end: 44 }, exposure: 1 });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-i") + 4)).toEqual(["-ss", "5", "-i", "/v/clip.mp4", "-t", "39"]);
    expect(args[args.indexOf("-vf") + 1]).toBe("lutrgb=r=val*2.000000:g=val*2.000000:b=val*2.000000,format=yuv420p");
    expect(args).toContain("libx264");
    expect(args.slice(args.indexOf("-movflags"), args.indexOf("-movflags") + 2)).toEqual(["-movflags", "+faststart"]);
    expect(args.slice(-4)).toEqual(["-progress", "pipe:1", "-nostats", "/v/.clip.edited.rendering.mp4"]);
  });

  test("keeps all of the video when there is no trim, leaves the colours be at 0 EV, and writes VP9 for a WebM", () => {
    const args = renderArguments("/v/clip.webm", "/v/out.webm", { trim: null, exposure: 0 });
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("-t");
    expect(args[args.indexOf("-vf") + 1]).toBe("format=yuv420p");
    expect(args).toContain("libvpx-vp9");
    expect(args).not.toContain("-movflags");
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
