import { describe, expect, it } from "vitest";
import { packBalance } from "./packs";

describe("loose stock equivalent", () => {
  it("shows a partially sold sack and floating point whole-pack boundaries correctly", () => {
    expect(packBalance(25 - 2 - 3, 25)).toEqual({ whole: 0, loose: 20 });
    expect(packBalance(69.5, 25)).toEqual({ whole: 2, loose: 19.5 });
    expect(packBalance(24.999999999, 25)).toEqual({ whole: 1, loose: 0 });
    expect(packBalance(0, 50)).toEqual({ whole: 0, loose: 0 });
    expect(packBalance(18.5, 20)).toEqual({ whole: 0, loose: 18.5 });
    expect(packBalance(.3, .1)).toEqual({ whole: 3, loose: 0 });
    expect(packBalance(1.2, .1)).toEqual({ whole: 12, loose: 0 });
    expect(packBalance(-1, 25)).toEqual({ whole: 0, loose: -1 });
  });
});
