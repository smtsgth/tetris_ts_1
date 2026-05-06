import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Input from '../input';
describe('DAS/ARR behavior', () => {
    let mockGame;
    beforeEach(() => {
        vi.useFakeTimers();
        mockGame = {
            moves: 0,
            move: (dx, dy = 0) => { mockGame.moves++; return true; }
        };
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    it('initial press moves once and then repeats after DAS+ARR', () => {
        const input = new Input(mockGame);
        // simulate keydown ArrowLeft by calling handler directly (no DOM in this test env)
        const down = { key: 'ArrowLeft', repeat: false };
        input.onKeyDown(down);
        expect(mockGame.moves).toBe(1);
        // advance less than DAS -> no repeat yet
        vi.advanceTimersByTime(100);
        expect(mockGame.moves).toBe(1);
        // advance to pass DAS (170) and one ARR (30) -> should have at least one extra move
        vi.advanceTimersByTime(200);
        // after ARR, interval should fire repeatedly; allow a couple ARR ticks
        vi.advanceTimersByTime(100);
        expect(mockGame.moves).toBeGreaterThan(1);
        // simulate keyup to stop
        const up = { key: 'ArrowLeft' };
        input.onKeyUp(up);
        // advance timers and ensure no more moves happen
        const before = mockGame.moves;
        vi.advanceTimersByTime(500);
        expect(mockGame.moves).toBe(before);
    });
});
