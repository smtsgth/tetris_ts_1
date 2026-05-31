import { PieceType, BAG_PIECES } from "./constants.js";

export type Matrix = number[][];

const clone = (m: Matrix) => m.map((r) => r.slice());
const rotateCW = (m: Matrix): Matrix => {
  const n = m.length;
  const res: Matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      res[c][n - 1 - r] = m[r][c];
    }
  }
  return res;
};

const SHAPES: Record<PieceType, Matrix> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [1, 0, 0, 0],
    [1, 1, 1, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  L: [
    [0, 0, 1, 0],
    [1, 1, 1, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  S: [
    [0, 1, 1, 0],
    [1, 1, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  T: [
    [0, 1, 0, 0],
    [1, 1, 1, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  Z: [
    [1, 1, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
};

export function getRotationMatrix(type: PieceType, rotation = 0): Matrix {
  if (type === "O") return clone(SHAPES[type]);
  let m = clone(SHAPES[type]);
  const r = ((rotation % 4) + 4) % 4;
  for (let i = 0; i < r; i++) m = rotateCW(m);
  return m;
}

export function getKickOffsets(
  type: PieceType,
  from: number,
  to: number,
): Array<[number, number]> {
  const f = ((from % 4) + 4) % 4;
  const t = ((to % 4) + 4) % 4;
  if (type === "O") return [[0, 0]];

  const JLSTZ: Record<string, Array<[number, number]>> = {
    "0->1": [
      [0, 0],
      [-1, 0],
      [-1, 1],
      [0, -2],
      [-1, -2],
    ],
    "1->0": [
      [0, 0],
      [1, 0],
      [1, -1],
      [0, 2],
      [1, 2],
    ],
    "1->2": [
      [0, 0],
      [1, 0],
      [1, -1],
      [0, 2],
      [1, 2],
    ],
    "2->1": [
      [0, 0],
      [-1, 0],
      [-1, 1],
      [0, -2],
      [-1, -2],
    ],
    "2->3": [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, -2],
      [1, -2],
    ],
    "3->2": [
      [0, 0],
      [-1, 0],
      [-1, -1],
      [0, 2],
      [-1, 2],
    ],
    "3->0": [
      [0, 0],
      [-1, 0],
      [-1, -1],
      [0, 2],
      [-1, 2],
    ],
    "0->3": [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, -2],
      [1, -2],
    ],
  };

  const I: Record<string, Array<[number, number]>> = {
    "0->1": [
      [0, 0],
      [-2, 0],
      [1, 0],
      [-2, -1],
      [1, 2],
    ],
    "1->0": [
      [0, 0],
      [2, 0],
      [-1, 0],
      [2, 1],
      [-1, -2],
    ],
    "1->2": [
      [0, 0],
      [-1, 0],
      [2, 0],
      [-1, 2],
      [2, -1],
    ],
    "2->1": [
      [0, 0],
      [1, 0],
      [-2, 0],
      [1, -2],
      [-2, 1],
    ],
    "2->3": [
      [0, 0],
      [2, 0],
      [-1, 0],
      [2, 1],
      [-1, -2],
    ],
    "3->2": [
      [0, 0],
      [-2, 0],
      [1, 0],
      [-2, -1],
      [1, 2],
    ],
    "3->0": [
      [0, 0],
      [1, 0],
      [-2, 0],
      [1, -2],
      [-2, 1],
    ],
    "0->3": [
      [0, 0],
      [-1, 0],
      [2, 0],
      [-1, 2],
      [2, -1],
    ],
  };

  const key = `${f}->${t}`;
  if (type === "I") return I[key] || [[0, 0]];
  return JLSTZ[key] || [[0, 0]];
}

export class Bag {
  private pool: PieceType[] = [];
  private refill() {
    this.pool = [...BAG_PIECES];
    for (let i = this.pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
    }
  }
  next(): PieceType {
    if (this.pool.length === 0) this.refill();
    return this.pool.pop()!;
  }
}

export class Piece {
  type: PieceType;
  matrix: Matrix;
  x: number;
  y: number;
  rotation: number;
  constructor(type: PieceType) {
    this.type = type;
    this.matrix = clone(SHAPES[type]);
    this.x = 3; // spawn roughly centered (for 4x4 matrix)
    this.y = -1; // start near top (allows hidden rows)
    this.rotation = 0;
  }
  clone(): Piece {
    const p = new Piece(this.type);
    p.matrix = clone(this.matrix);
    p.x = this.x;
    p.y = this.y;
    p.rotation = this.rotation;
    return p;
  }
  rotateCW() {
    this.matrix = rotateCW(this.matrix);
    this.rotation = (this.rotation + 1) % 4;
  }
  rotateCCW() {
    // three CW rotations
    this.rotateCW();
    this.rotateCW();
    this.rotateCW();
  }
}
