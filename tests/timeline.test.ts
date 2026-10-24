import { describe, expect, test } from "bun:test";
import { NO_EDITS } from "../shared/document.ts";
import { painted, remainingOf, withoutSpan, withSpan } from "../shared/spans.ts";
import { keptMoment, keptParts, keptPieces, resultLength, resultTime, sourceTime } from "../shared/timeline.ts";

describe("painted", () => {
  const speeds = [
    { start: 10, end: 20, value: 0.5 },
    { start: 30, end: 40, value: 2 },
  ];
  const sameValue = (a: { value: number }, b: { value: number }) => a.value === b.value;

  test("gives way to what is painted over it, splitting a range it lands inside, and keeps what lies outside", () => {
    expect(painted(speeds, { start: 12, end: 15 }, { start: 12, end: 15, value: 2 }, sameValue)).toEqual([
      { start: 10, end: 12, value: 0.5 },
      { start: 12, end: 15, value: 2 },
      { start: 15, end: 20, value: 0.5 },
      { start: 30, end: 40, value: 2 },
    ]);
  });

  test("joins neighbours that touch and are alike, and erases where the replacement is null", () => {
    expect(painted(speeds, { start: 20, end: 30 }, { start: 20, end: 30, value: 2 }, sameValue)).toEqual([
      { start: 10, end: 20, value: 0.5 },
      { start: 20, end: 40, value: 2 },
    ]);
    expect(painted(speeds, { start: 15, end: 35 }, null, sameValue)).toEqual([
      { start: 10, end: 15, value: 0.5 },
      { start: 35, end: 40, value: 2 },
    ]);
  });

  test("adds and takes out plain spans", () => {
    expect(withSpan([{ start: 1, end: 2 }], { start: 2, end: 3 })).toEqual([{ start: 1, end: 3 }]);
    expect(withoutSpan([{ start: 1, end: 5 }], { start: 2, end: 3 })).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(remainingOf({ start: 0, end: 10 }, [{ start: 0, end: 2 }, { start: 8, end: 12 }])).toEqual([{ start: 2, end: 8 }]);
  });
});

describe("the timeline of the result", () => {
  const edits = { ...NO_EDITS, trim: { start: 30, end: 42 }, cuts: [{ start: 33, end: 35 }] };
  const pieces = keptPieces(edits, 45);
  const asShot = { exposure: 0, speed: 1, volume: 1 };

  test("is made of what the trim keeps, less the cuts", () => {
    expect(keptParts(edits, 45)).toEqual([
      { start: 30, end: 33 },
      { start: 35, end: 42 },
    ]);
    expect(pieces).toEqual([
      { start: 30, end: 33, ...asShot },
      { start: 35, end: 42, ...asShot },
    ]);
    expect(resultLength(pieces)).toBe(10);
    expect(keptPieces(NO_EDITS, 45)).toEqual([{ start: 0, end: 45, ...asShot }]);
  });

  test("splits a kept part where a setting's range starts or ends, and plays a piece as fast as its speed", () => {
    const slowed = {
      ...edits,
      speed: { clip: 1, ranges: [{ start: 35, end: 36, value: 0.5 }] },
      volume: { clip: 1, ranges: [{ start: 38, end: 50, value: 0 }] },
      exposure: { clip: 1, ranges: [{ start: 0, end: 31, value: 1 }] },
    };
    const split = keptPieces(slowed, 45);
    expect(split).toEqual([
      { start: 30, end: 33, ...asShot, exposure: 1 },
      { start: 35, end: 36, ...asShot, exposure: 1, speed: 0.5 },
      { start: 36, end: 38, ...asShot, exposure: 1 },
      { start: 38, end: 42, ...asShot, exposure: 1, volume: 0 },
    ]);
    expect(resultLength(split)).toBe(11);
    expect([35.5, 36, 38].map((time) => resultTime(split, time))).toEqual([4, 5, 7]);
    expect([4, 5, 7].map((time) => sourceTime(split, time))).toEqual([35.5, 36, 38]);
  });

  test("maps a moment of the source to the result and back, a cut moment to where the result goes on", () => {
    expect([29, 30, 32, 34, 36, 42, 44].map((time) => resultTime(pieces, time))).toEqual([0, 0, 2, 3, 4, 10, 10]);
    expect([0, 2, 3, 4, 10, 11].map((time) => sourceTime(pieces, time))).toEqual([30, 32, 35, 36, 42, 42]);
  });

  test("finds where playback is, skipping a cut forwards or back to the end of the piece before", () => {
    expect(keptMoment(pieces, 31)).toBe(31);
    expect(keptMoment(pieces, 33)).toBe(35);
    expect(keptMoment(pieces, 34, -1)).toBe(33);
    expect(keptMoment(pieces, 10)).toBe(30);
    expect(keptMoment(pieces, 43)).toBe(42);
  });
});
