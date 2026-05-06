import { describe, it, expect } from 'vitest';
import Game from '../game';
import { Piece } from '../tetromino';
import { ROWS, COLS } from '../constants';

describe('T-Spin detection', () => {
  it('detects full T-Spin when rotation used a kick and 3 corners occupied', () => {
    const g = new Game();
    // clear board
    (g as any).board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const p = new Piece('T');
    p.x = 4; p.y = 0; // pivot will be (5,1)
    // occupy three corners around pivot (4,0),(6,0),(4,2)
    (g as any).board[0][4] = 'I';
    (g as any).board[0][6] = 'I';
    (g as any).board[2][4] = 'I';
    (g as any).lastMoveWasRotation = true;
    (g as any).lastRotationKick = [1,0];
    const res = (g as any).isTSpin(p);
    expect(res).toBe('full');
  });

  it('detects mini T-Spin when no kick used with 3 corners', () => {
    const g = new Game();
    (g as any).board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const p = new Piece('T');
    p.x = 4; p.y = 0; // pivot (5,1)
    (g as any).board[0][4] = 'I';
    (g as any).board[0][6] = 'I';
    (g as any).board[2][4] = 'I';
    (g as any).lastMoveWasRotation = true;
    (g as any).lastRotationKick = [0,0];
    const res = (g as any).isTSpin(p);
    expect(res).toBe('mini');
  });
});
