import {
  COLS,
  ROWS,
  HIDDEN_ROWS,
  BLOCK_SIZE,
  VISIBLE_ROWS,
  PieceType,
} from "./constants.js";
import { Bag, Piece, Matrix, getKickOffsets } from "./tetromino.js";

export type Cell = PieceType | null;

export type GameState = {
  board: Cell[][];
  current: Piece | null;
  next: PieceType[];
  hold: PieceType | null;
  hold2?: PieceType | null;
  score: number;
  lines: number;
  level: number;
  paused: boolean;
  over: boolean;
  b2b: boolean;
  combo: number;
  notifications?: Array<{ msg: string; ts: number }>;
};

export default class Game {
  board: Cell[][];
  bag: Bag;
  current: Piece | null = null;
  nextQueue: PieceType[] = [];
  hold1: PieceType | null = null;
  hold2: PieceType | null = null;
  // AI / settings: how many next pieces to maintain (useful for AI planning)
  public nextQueueLength: number = 16;
  // allow toggling hold usage programmatically
  public allowHold1: boolean = true;
  public allowHold2: boolean = true;
  // hold swap tracking to allow unlimited holds per turn but prevent rapid toggling between slots
  private lastHoldSlot: number | null = null;
  private lastHoldTimestamp = 0;
  private readonly HOLD_SWAP_COOLDOWN = 220; // ms minimum between switching slots
  // prevent multiple holds on the same spawned piece
  private holdUsedThisTurn: boolean = false;
  score = 0;
  lines = 0;
  level = 0;
  over = false;
  paused = false;
  private listeners: Array<() => void> = [];
  private dropTimer = 0;
  private lastTime = 0;

  // gameplay state for advanced scoring
  private lastMoveWasRotation = false;
  private b2b = false; // back-to-back eligible state
  private combo = 0;
  private lastRotationKick: [number, number] | null = null;
  private notifications: Array<{ msg: string; ts: number }> = [];
  // runtime lock monitoring
  private lockEvents: Array<any> = [];
  private lockStats: {
    totalLocks: number;
    anomalyCount: number;
    lastLockTs: number;
    rapidLockThresholdMs: number;
  } = {
    totalLocks: 0,
    anomalyCount: 0,
    lastLockTs: 0,
    rapidLockThresholdMs: 50,
  };
  private monitorLocks: boolean = true;

  constructor() {
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.bag = new Bag();
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.bag = new Bag();
    this.nextQueue = [];
    for (let i = 0; i < this.nextQueueLength; i++)
      this.nextQueue.push(this.bag.next());
    this.hold1 = null;
    this.hold2 = null;
    this.score = 0;
    this.lines = 0;
    this.level = 0;
    this.over = false;
    this.paused = false;
    this.lastHoldSlot = null;
    this.lastHoldTimestamp = 0;
    this.lastMoveWasRotation = false;
    this.b2b = false;
    this.combo = 0;
    this.lastRotationKick = null;
    this.spawn();
    this.emit();
  }

  // allow updating how many next pieces are kept in the queue
  public setNextQueueLength(n: number) {
    const v = Math.max(1, Math.floor(Number(n) || 0));
    this.nextQueueLength = v;
    while (this.nextQueue.length < this.nextQueueLength)
      this.nextQueue.push(this.bag.next());
    while (this.nextQueue.length > this.nextQueueLength) this.nextQueue.pop();
  }

  public setAllowHold1(v: boolean) {
    this.allowHold1 = !!v;
  }
  public setAllowHold2(v: boolean) {
    this.allowHold2 = !!v;
  }

  private pushNotification(msg: string) {
    const payload = { msg, ts: Date.now() };
    this.notifications.push(payload);
    // dispatch a DOM event so UI layers can react immediately (toasts, flashes)
    try {
      window.dispatchEvent(
        new CustomEvent("game-notification", { detail: payload }),
      );
    } catch (e) {}
    if (this.notifications.length > 20) this.notifications.shift();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  // Lock monitoring APIs
  public getLockStats() {
    return { ...this.lockStats };
  }

  public getLockEvents() {
    return this.lockEvents.slice();
  }

  public clearLockEvents() {
    this.lockEvents = [];
    this.lockStats.totalLocks = 0;
    this.lockStats.anomalyCount = 0;
    this.lockStats.lastLockTs = 0;
  }

  public exportLockEventsToWindow() {
    try {
      (window as any).__gameLockEvents = this.getLockEvents();
      (window as any).__gameLockStats = this.getLockStats();
    } catch (e) {}
  }

  public setLockMonitorEnabled(v: boolean) {
    this.monitorLocks = !!v;
  }

  public setLockRapidThresholdMs(ms: number) {
    this.lockStats.rapidLockThresholdMs = Math.max(
      0,
      Math.floor(Number(ms) || 0),
    );
  }

  spawn() {
    // Peek next piece and only mutate the queue if spawn succeeds. This prevents the
    // next preview from advancing when the spawn immediately results in game over.
    const t = this.nextQueue.length ? this.nextQueue[0] : this.bag.next();
    const newQueued = this.bag.next();
    const candidate = new Piece(t);
    candidate.x = 3;
    candidate.y = -1;
    // if candidate cannot be placed, set game over but do not advance the next queue
    if (!this.isValidPos(candidate.matrix, candidate.x, candidate.y)) {
      this.current = candidate;
      this.over = true;
      this.emit();
      return;
    }
    // commit queue change: remove the consumed piece (if any) and push a new one
    if (this.nextQueue.length) this.nextQueue.shift();
    this.nextQueue.push(newQueued);
    this.current = candidate;
    // reset per-turn hold tracking for the newly spawned piece
    this.lastHoldSlot = null;
    this.lastHoldTimestamp = 0;
    this.holdUsedThisTurn = false;
    this.emit();
  }

  isValidPos(matrix: Matrix, x: number, y: number) {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        const boardX = x + c;
        const boardY = y + r;
        if (boardX < 0 || boardX >= COLS) return false;
        if (boardY >= ROWS) return false;
        if (boardY >= 0 && this.board[boardY][boardX]) return false;
      }
    }
    return true;
  }

  move(dx: number, dy = 0) {
    if (!this.current) return false;
    if (
      this.isValidPos(
        this.current.matrix,
        this.current.x + dx,
        this.current.y + dy,
      )
    ) {
      this.current.x += dx;
      this.current.y += dy;
      this.lastMoveWasRotation = false;
      this.emit();
      return true;
    }
    return false;
  }

  rotateCW() {
    this.rotate(true);
  }
  rotateCCW() {
    this.rotate(false);
  }

  private rotate(directionCW: boolean) {
    if (!this.current) return;
    const clone = this.current.clone();
    if (directionCW) clone.rotateCW();
    else clone.rotateCCW();
    const kicks = getKickOffsets(
      this.current.type,
      this.current.rotation,
      clone.rotation,
    );
    for (const k of kicks) {
      const nx = clone.x + k[0];
      const ny = clone.y + k[1];
      if (this.isValidPos(clone.matrix, nx, ny)) {
        // record kick used for T-Spin detection
        this.lastRotationKick = k as [number, number];
        this.current.matrix = clone.matrix;
        this.current.x = nx;
        this.current.y = ny;
        this.current.rotation = clone.rotation;
        this.lastMoveWasRotation = true;
        this.emit();
        return;
      }
    }
    // no rotation possible
  }

  hardDrop() {
    if (!this.current) return;
    let drop = 0;
    while (this.move(0, 1)) drop++;
    this.score += drop * 2;
    this.lock();
    this.emit();
  }

  softDrop() {
    if (!this.current) return;
    if (this.move(0, 1)) {
      this.score += 1;
      this.emit();
    } else {
      this.lock();
    }
  }

  // holdPiece: swap current with specified hold slot (1 or 2). Default slot=1 for compatibility
  holdPiece(slot = 1) {
    if (!this.current) return;
    if (this.over) return;
    if (slot !== 1 && slot !== 2) return;
    // respect allowHold toggles
    if (slot === 1 && !this.allowHold1) {
      this.pushNotification("Hold1 は無効です");
      return;
    }
    if (slot === 2 && !this.allowHold2) {
      this.pushNotification("Hold2 は無効です");
      return;
    }
    const now = Date.now();
    // prevent multiple holds for the same spawned piece
    if (this.holdUsedThisTurn) {
      this.pushNotification("ホールドはこのターンですでに使用されています");
      return;
    }
    // prevent very rapid swaps between different slots
    if (
      this.lastHoldSlot !== null &&
      this.lastHoldSlot !== slot &&
      now - this.lastHoldTimestamp < this.HOLD_SWAP_COOLDOWN
    ) {
      this.pushNotification("ホールド切替は速すぎます");
      return;
    }
    const curType = this.current.type;
    if (slot === 1) {
      const prev = this.hold1;
      if (prev) {
        // swap
        this.current = new Piece(prev);
        this.current.x = 3;
        this.current.y = -1;
        this.hold1 = curType;
        this.pushNotification(`Hold1 交換: ${prev}↔${curType}`);
        // mark last hold on this turn
        this.lastHoldSlot = 1;
        this.lastHoldTimestamp = Date.now();
        this.holdUsedThisTurn = true;
      } else {
        // store and spawn next
        this.hold1 = curType;
        this.pushNotification(`Hold1 保存: ${curType}`);
        this.spawn();
        // spawn resets per-turn tracking
      }
    } else {
      const prev = this.hold2;
      if (prev) {
        this.current = new Piece(prev);
        this.current.x = 3;
        this.current.y = -1;
        this.hold2 = curType;
        this.pushNotification(`Hold2 交換: ${prev}↔${curType}`);
        this.lastHoldSlot = 2;
        this.lastHoldTimestamp = Date.now();
        this.holdUsedThisTurn = true;
      } else {
        this.hold2 = curType;
        this.pushNotification(`Hold2 保存: ${curType}`);
        this.spawn();
      }
    }
    this.lastMoveWasRotation = false;
    this.emit();
  }

  private isTSpin(piece: Piece): "none" | "mini" | "full" {
    if (piece.type !== "T") return "none";
    if (!this.lastMoveWasRotation) return "none";
    const pivotX = piece.x + 1;
    const pivotY = piece.y + 1;
    let corners = 0;
    const checks = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [dx, dy] of checks) {
      const x = pivotX + dx;
      const y = pivotY + dy;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
        corners++;
      } else if (this.board[y][x]) {
        corners++;
      }
    }
    if (corners < 3) return "none";
    // stricter: classify mini vs full based on whether a non-zero kick was used
    if (
      this.lastRotationKick &&
      (this.lastRotationKick[0] !== 0 || this.lastRotationKick[1] !== 0)
    )
      return "full";
    return "mini";
  }

  lock() {
    if (!this.current) return;
    // prevent re-entrant/double-lock: capture current piece and clear it immediately
    const piece = this.current;
    this.current = null;

    const now = Date.now();
    let beforeFilled = 0;
    if (this.monitorLocks) {
      try {
        beforeFilled = this.board.reduce(
          (acc, row) => acc + row.filter((c) => c !== null).length,
          0,
        );
      } catch (e) {
        beforeFilled = 0;
      }
    }

    const tspinType =
      this.lastMoveWasRotation && piece.type === "T"
        ? this.isTSpin(piece)
        : "none";
    const m = piece.matrix;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const x = piece.x + c;
        const y = piece.y + r;
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
          this.board[y][x] = piece.type;
        }
      }
    }

    const cleared = this.clearLines();
    this.addScore(cleared, tspinType);

    // record lock event
    if (this.monitorLocks) {
      let afterFilled = 0;
      try {
        afterFilled = this.board.reduce(
          (acc, row) => acc + row.filter((c) => c !== null).length,
          0,
        );
      } catch (e) {
        afterFilled = 0;
      }
      try {
        this.lockStats.totalLocks = (this.lockStats.totalLocks || 0) + 1;
        const delta = this.lockStats.lastLockTs
          ? now - this.lockStats.lastLockTs
          : Number.POSITIVE_INFINITY;
        const isRapid =
          typeof delta === "number" &&
          delta < (this.lockStats.rapidLockThresholdMs || 50);
        const ev: any = {
          ts: now,
          type: isRapid ? "rapid-lock" : "lock",
          piece: piece.type,
          beforeFilled,
          afterFilled,
          delta,
        };
        this.lockEvents.push(ev);
        if (isRapid) {
          this.lockStats.anomalyCount = (this.lockStats.anomalyCount || 0) + 1;
          try {
            this.pushNotification(
              "Lock anomaly: rapid consecutive lock detected",
            );
          } catch (e) {}
          try {
            console.warn("Lock anomaly detected", ev);
          } catch (e) {}
        }
        this.lockStats.lastLockTs = now;
      } catch (e) {}
    }

    // notifications
    if (tspinType === "full") this.pushNotification("T-Spin");
    else if (tspinType === "mini") this.pushNotification("T-Spin Mini");
    if (cleared >= 4) this.pushNotification("TETRIS");
    if (this.combo > 1) this.pushNotification(`Combo x${this.combo}`);
    if (this.b2b) this.pushNotification("B2B");
    this.spawn();
    this.lastMoveWasRotation = false;
    this.lastRotationKick = null;
    this.emit();
  }

  private clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every((cell) => cell !== null)) {
        this.board.splice(r, 1);
        this.board.unshift(Array(COLS).fill(null));
        cleared++;
        r++; // recheck same index after shift
      }
    }
    if (cleared > 0) {
      this.lines += cleared;
      const newLevel = Math.floor(this.lines / 10);
      if (newLevel > this.level) this.level = newLevel;
    }
    return cleared;
  }

  private addScore(
    cleared: number,
    tspinType: "none" | "mini" | "full" = "none",
  ) {
    const levelMult = this.level + 1;
    let base = 0;
    let eligibleForB2B = false;
    const isTSpin = tspinType !== "none";
    if (isTSpin) {
      if (cleared === 1) base = 800 * levelMult;
      else if (cleared === 2) base = 1200 * levelMult;
      else if (cleared === 3) base = 1600 * levelMult;
      // full T-Spins are eligible for B2B; mini are not
      if (tspinType === "full") eligibleForB2B = true;
    } else {
      if (cleared === 1) base = 100 * levelMult;
      else if (cleared === 2) base = 300 * levelMult;
      else if (cleared === 3) base = 500 * levelMult;
      else if (cleared >= 4) {
        base = 800 * levelMult;
        eligibleForB2B = true;
      }
    }

    // back-to-back bonus
    if (cleared > 0 && eligibleForB2B && this.b2b) {
      base = Math.floor(base * 1.5);
    }

    // combo bonus
    if (cleared > 0) {
      this.combo = this.combo + 1;
    } else {
      this.combo = 0;
    }
    const comboBonus = this.combo > 1 ? (this.combo - 1) * 50 * levelMult : 0;

    this.score += base + comboBonus;

    // update b2b state
    if (cleared > 0) {
      this.b2b = eligibleForB2B;
    } else {
      // no clear resets combo handled above, and non-eligible clear clears b2b
      if (!eligibleForB2B) this.b2b = false;
    }
  }

  togglePause() {
    this.paused = !this.paused;
    this.emit();
  }

  update(ts: number) {
    if (this.over) return;
    if (this.paused) return;
    if (!this.lastTime) this.lastTime = ts;
    const delta = ts - this.lastTime;
    this.lastTime = ts;
    this.dropTimer += delta;
    const interval = Math.max(1000 - this.level * 75, 100);
    if (this.dropTimer >= interval) {
      this.dropTimer = 0;
      if (!this.move(0, 1)) {
        // cannot move down -> lock
        this.lock();
      }
    }
  }

  getState(): GameState {
    return {
      board: this.board,
      current: this.current,
      // return full queued pieces so renderer/UI can choose how many to show
      next: this.nextQueue.slice(),
      // expose hold1 as `hold` for backwards compatibility and expose hold2 as `hold2`
      hold: this.hold1,
      hold2: this.hold2,
      score: this.score,
      lines: this.lines,
      level: this.level,
      paused: this.paused,
      over: this.over,
      b2b: this.b2b,
      combo: this.combo,
      notifications: this.notifications.slice(),
    };
  }
}
