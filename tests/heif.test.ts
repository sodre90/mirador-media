import { describe, expect, test } from "bun:test";
import { shownCrop, storedCropFrom } from "../host/heif.ts";

const crop = { top: 1, right: 2, bottom: 3, left: 4 };
const report = (sideData: object[]) => JSON.stringify({ streams: [{ side_data_list: sideData }] });
const turnedQuarter = "\n00000000:            0       65536           0\n00000001:       -65536           0           0\n00000002:            0           0  1073741824\n";
const mirroredAndTurned = "\n00000000:            0       65536           0\n00000001:        65536           0           0\n00000002:            0           0  1073741824\n";

describe("a HEIF photo's crop", () => {
  test("turns with the photo: each stored edge lands where the turn takes it", () => {
    expect(shownCrop(crop, 0)).toEqual(crop);
    expect(shownCrop(crop, 90)).toEqual({ top: 4, right: 1, bottom: 2, left: 3 });
    expect(shownCrop(crop, 180)).toEqual({ top: 3, right: 4, bottom: 1, left: 2 });
    expect(shownCrop(crop, 270)).toEqual({ top: 2, right: 3, bottom: 4, left: 1 });
  });

  test("is read with the turn from ffprobe's side data, ffmpeg's rotation being counterclockwise", () => {
    const cropping = { side_data_type: "Frame Cropping", crop_top: 0, crop_bottom: 1, crop_left: 0, crop_right: 1 };
    expect(storedCropFrom(report([cropping, { side_data_type: "Display Matrix", displaymatrix: turnedQuarter, rotation: -90 }]))).toEqual({
      crop: { top: 0, bottom: 1, left: 0, right: 1 },
      clockwise: 90,
    });
    expect(storedCropFrom(report([cropping]))).toEqual({ crop: { top: 0, bottom: 1, left: 0, right: 1 }, clockwise: 0 });
  });

  test("is left to ffmpeg when there is none, or when the photo is mirrored too", () => {
    expect(storedCropFrom(report([]))).toBeNull();
    expect(storedCropFrom(JSON.stringify({ streams: [] }))).toBeNull();
    const cropping = { side_data_type: "Frame Cropping", crop_top: 0, crop_bottom: 1, crop_left: 0, crop_right: 1 };
    expect(storedCropFrom(report([cropping, { side_data_type: "Display Matrix", displaymatrix: mirroredAndTurned, rotation: -90 }]))).toBeNull();
  });
});
