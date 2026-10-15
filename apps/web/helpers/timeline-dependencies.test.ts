import { describe, expect, it } from "vitest";
import { getTimelineConnectionPath } from "./planning";

describe("timeline dependency routes", () => {
  it("routes a predecessor into the successor's start", () => {
    expect(getTimelineConnectionPath({ x: 100, y: 20 }, { x: 200, y: 60 })).toBe("M 100 20 H 150 V 60 H 200");
  });
  it("uses a separate corridor for conflicting overlapping dates", () => {
    expect(getTimelineConnectionPath({ x: 200, y: 20 }, { x: 100, y: 60 })).toBe("M 200 20 H 214 V 40 H 86 V 60 H 100");
  });
  it("does not draw self connections or invalid geometry", () => {
    expect(getTimelineConnectionPath({ x: 10, y: 20 }, { x: 10, y: 20 })).toBeUndefined();
    expect(getTimelineConnectionPath({ x: Number.NaN, y: 20 }, { x: 20, y: 60 })).toBeUndefined();
  });
  it("avoids intermediate bars and uses the gap before the target row", () => {
    expect(getTimelineConnectionPath({ x: 100, y: 22 }, { x: 80, y: 110 }, { laneX: 250, rowHeight: 44 })).toBe(
      "M 100 22 H 250 V 88 H 66 V 110 H 80"
    );
  });
});
