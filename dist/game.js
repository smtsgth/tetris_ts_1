import { COLS, ROWS } from './constants.js';
import { Bag, Piece, getKickOffsets } from './tetromino.js';
export default class Game {
    constructor() {
        this.current = null;
        this.nextQueue = [];
        this.hold = null;
        this.canHold = true;
        this.score = 0;
        this.lines = 0;
        this.level = 0;
        this.over = false;
        this.paused = false;
        this.listeners = [];
        this.dropTimer = 0;
        this.lastTime = 0;
        // gameplay state for advanced scoring
        this.lastMoveWasRotation = false;
        this.b2b = false; // back-to-back eligible state
        this.combo = 0;
        this.lastRotationKick = null;
        this.notifications = [];
        this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        this.bag = new Bag();
        this.reset();
    }
    reset() {
        this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        this.bag = new Bag();
        this.nextQueue = [];
        for (let i = 0; i < 6; i++)
            this.nextQueue.push(this.bag.next());
        this.hold = null;
        this.canHold = true;
        this.score = 0;
        this.lines = 0;
        this.level = 0;
        this.over = false;
        this.paused = false;
        this.lastMoveWasRotation = false;
        this.b2b = false;
        this.combo = 0;
        this.lastRotationKick = null;
        this.spawn();
        this.emit();
    }
    pushNotification(msg) {
        this.notifications.push({ msg, ts: Date.now() });
        if (this.notifications.length > 20)
            this.notifications.shift();
    }
    onChange(fn) { this.listeners.push(fn); }
    emit() { this.listeners.forEach(f => f()); }
    spawn() {
        const t = this.nextQueue.shift() || this.bag.next();
        this.nextQueue.push(this.bag.next());
        this.current = new Piece(t);
        this.current.x = 3;
        this.current.y = -1;
        this.canHold = true;
        if (!this.isValidPos(this.current.matrix, this.current.x, this.current.y)) {
            this.over = true;
        }
        this.emit();
    }
    isValidPos(matrix, x, y) {
        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (!matrix[r][c])
                    continue;
                const boardX = x + c;
                const boardY = y + r;
                if (boardX < 0 || boardX >= COLS)
                    return false;
                if (boardY >= ROWS)
                    return false;
                if (boardY >= 0 && this.board[boardY][boardX])
                    return false;
            }
        }
        return true;
    }
    move(dx, dy = 0) {
        if (!this.current)
            return false;
        if (this.isValidPos(this.current.matrix, this.current.x + dx, this.current.y + dy)) {
            this.current.x += dx;
            this.current.y += dy;
            this.lastMoveWasRotation = false;
            this.emit();
            return true;
        }
        return false;
    }
    rotateCW() { this.rotate(true); }
    rotateCCW() { this.rotate(false); }
    rotate(directionCW) {
        if (!this.current)
            return;
        const clone = this.current.clone();
        if (directionCW)
            clone.rotateCW();
        else
            clone.rotateCCW();
        const kicks = getKickOffsets(this.current.type, this.current.rotation, clone.rotation);
        for (const k of kicks) {
            const nx = clone.x + k[0];
            const ny = clone.y + k[1];
            if (this.isValidPos(clone.matrix, nx, ny)) {
                // record kick used for T-Spin detection
                this.lastRotationKick = k;
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
        if (!this.current)
            return;
        let drop = 0;
        while (this.move(0, 1))
            drop++;
        this.score += drop * 2;
        this.lock();
        this.emit();
    }
    softDrop() {
        if (!this.current)
            return;
        if (this.move(0, 1)) {
            this.score += 1;
            this.emit();
        }
        else {
            this.lock();
        }
    }
    holdPiece() {
        if (!this.current || !this.canHold)
            return;
        const curType = this.current.type;
        if (this.hold) {
            this.current = new Piece(this.hold);
            this.current.x = 3;
            this.current.y = -1;
            this.hold = curType;
        }
        else {
            this.hold = curType;
            this.spawn();
        }
        this.canHold = false;
        this.lastMoveWasRotation = false;
        this.emit();
    }
    isTSpin(piece) {
        if (piece.type !== 'T')
            return 'none';
        if (!this.lastMoveWasRotation)
            return 'none';
        const pivotX = piece.x + 1;
        const pivotY = piece.y + 1;
        let corners = 0;
        const checks = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (const [dx, dy] of checks) {
            const x = pivotX + dx;
            const y = pivotY + dy;
            if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
                corners++;
            }
            else if (this.board[y][x]) {
                corners++;
            }
        }
        if (corners < 3)
            return 'none';
        // stricter: classify mini vs full based on whether a non-zero kick was used
        if (this.lastRotationKick && (this.lastRotationKick[0] !== 0 || this.lastRotationKick[1] !== 0))
            return 'full';
        return 'mini';
    }
    lock() {
        if (!this.current)
            return;
        const tspinType = this.lastMoveWasRotation && this.current.type === 'T' ? this.isTSpin(this.current) : 'none';
        const m = this.current.matrix;
        for (let r = 0; r < m.length; r++) {
            for (let c = 0; c < m[r].length; c++) {
                if (!m[r][c])
                    continue;
                const x = this.current.x + c;
                const y = this.current.y + r;
                if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
                    this.board[y][x] = this.current.type;
                }
            }
        }
        const cleared = this.clearLines();
        this.addScore(cleared, tspinType);
        // notifications
        if (tspinType === 'full')
            this.pushNotification('T-Spin');
        else if (tspinType === 'mini')
            this.pushNotification('T-Spin Mini');
        if (cleared >= 4)
            this.pushNotification('TETRIS');
        if (this.combo > 1)
            this.pushNotification(`Combo x${this.combo}`);
        if (this.b2b)
            this.pushNotification('B2B');
        this.spawn();
        this.lastMoveWasRotation = false;
        this.lastRotationKick = null;
        this.emit();
    }
    clearLines() {
        let cleared = 0;
        for (let r = ROWS - 1; r >= 0; r--) {
            if (this.board[r].every(cell => cell !== null)) {
                this.board.splice(r, 1);
                this.board.unshift(Array(COLS).fill(null));
                cleared++;
                r++; // recheck same index after shift
            }
        }
        if (cleared > 0) {
            this.lines += cleared;
            const newLevel = Math.floor(this.lines / 10);
            if (newLevel > this.level)
                this.level = newLevel;
        }
        return cleared;
    }
    addScore(cleared, tspinType = 'none') {
        const levelMult = (this.level + 1);
        let base = 0;
        let eligibleForB2B = false;
        const isTSpin = tspinType !== 'none';
        if (isTSpin) {
            if (cleared === 1)
                base = 800 * levelMult;
            else if (cleared === 2)
                base = 1200 * levelMult;
            else if (cleared === 3)
                base = 1600 * levelMult;
            // full T-Spins are eligible for B2B; mini are not
            if (tspinType === 'full')
                eligibleForB2B = true;
        }
        else {
            if (cleared === 1)
                base = 100 * levelMult;
            else if (cleared === 2)
                base = 300 * levelMult;
            else if (cleared === 3)
                base = 500 * levelMult;
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
        }
        else {
            this.combo = 0;
        }
        const comboBonus = this.combo > 1 ? (this.combo - 1) * 50 * levelMult : 0;
        this.score += base + comboBonus;
        // update b2b state
        if (cleared > 0) {
            this.b2b = eligibleForB2B;
        }
        else {
            // no clear resets combo handled above, and non-eligible clear clears b2b
            if (!eligibleForB2B)
                this.b2b = false;
        }
    }
    togglePause() { this.paused = !this.paused; this.emit(); }
    update(ts) {
        if (this.over)
            return;
        if (this.paused)
            return;
        if (!this.lastTime)
            this.lastTime = ts;
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
    getState() {
        return {
            board: this.board,
            current: this.current,
            next: this.nextQueue.slice(0, 5),
            hold: this.hold,
            score: this.score,
            lines: this.lines,
            level: this.level,
            paused: this.paused,
            over: this.over,
            b2b: this.b2b,
            combo: this.combo,
            notifications: this.notifications.slice()
        };
    }
}
