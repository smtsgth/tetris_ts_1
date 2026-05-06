import { describe, it, expect } from 'vitest';
import { getRotationMatrix } from '../tetromino';

describe('tetromino rotations', () => {
  it('I rotates 90 degrees', () => {
    const r = getRotationMatrix('I', 1);
    const expected = [
      [0,0,1,0],
      [0,0,1,0],
      [0,0,1,0],
      [0,0,1,0]
    ];
    expect(r).toEqual(expected);
  });

  it('O is invariant under rotation', () => {
    expect(getRotationMatrix('O', 0)).toEqual(getRotationMatrix('O', 2));
  });
});
