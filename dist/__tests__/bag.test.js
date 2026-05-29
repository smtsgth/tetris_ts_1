import { describe, it, expect } from "vitest";
import { Bag } from "../tetromino";
describe("Bag", () => {
    it("produces 7 unique pieces in a bag cycle", () => {
        const bag = new Bag();
        const seq = [];
        for (let i = 0; i < 7; i++)
            seq.push(bag.next());
        expect(new Set(seq).size).toBe(7);
    });
});
