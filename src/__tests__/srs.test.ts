import { describe, it, expect } from "vitest";
import { getKickOffsets } from "../tetromino";
import Game from "../game";
import { Piece } from "../tetromino";

describe("SRS kick tables and rotation behavior", () => {
  it("I-piece has 5 kick offsets for 0->1", () => {
    const kicks = getKickOffsets("I", 0, 1);
    expect(kicks.length).toBe(5);
    expect(kicks[0]).toEqual([0, 0]);
    expect(kicks[1]).toEqual([-2, 0]);
  });

  it("JLSTZ pieces have 5 kick offsets for 0->1", () => {
    const kicks = getKickOffsets("T", 0, 1);
    expect(kicks.length).toBe(5);
    expect(kicks[0]).toEqual([0, 0]);
    expect(kicks[1]).toEqual([-1, 0]);
  });

  it("game rotation performs I-piece right-side kick when starting x=-1", () => {
    const g = new Game();
    // place an I piece starting at x=-1; rotation should succeed and move to x=0 using kick [1,0]
    (g as any).current = new Piece("I");
    (g as any).current.x = -1;
    (g as any).current.y = 0;
    (g as any).current.rotation = 0;
    g.rotateCW();
    const cur = (g as any).current;
    expect(cur.rotation).toBe(1);
    // rotated placement should be valid for occupied cells
    expect(g.isValidPos(cur.matrix, cur.x, cur.y)).toBe(true);
  });
});
