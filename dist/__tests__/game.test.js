import { describe, it, expect } from 'vitest';
import Game from '../game';
import { ROWS, COLS } from '../constants';
describe('game core', () => {
    it('spawn creates current piece', () => {
        const g = new Game();
        expect(g.getState().current).not.toBeNull();
    });
    it('clearLines removes full rows', () => {
        const g = new Game();
        // clear board and fill bottom row
        g.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        g.board[ROWS - 1] = Array(COLS).fill('I');
        const cleared = g.clearLines();
        expect(cleared).toBe(1);
        expect(g.getState().lines).toBe(1);
    });
    it('addScore with Tetris adds correct points', () => {
        const g = new Game();
        g.level = 0;
        g.b2b = false;
        g.combo = 0;
        g.addScore(4, 'none');
        expect(g.getState().score).toBe(800);
    });
});
