import Game from './game.js';

export default class Input {
  private game: Game;
  // event logging for precise DAS/ARR measurement
  public eventLog: Array<any> = [];
  private keyState: Record<string, boolean> = {};
  private leftDasTimer: number | null = null;
  private leftArrTimer: number | null = null;
  private rightDasTimer: number | null = null;
  private rightArrTimer: number | null = null;
  private downTimer: number | null = null;

  // tuning (tunable values)
  private DAS = 170; // ms before auto-repeat (tuned)
  private ARR = 30;  // ms between auto-moves (tuned)
  private SOFT_DROP_INTERVAL = 50; // ms (tuned)

  constructor(game: Game) {
    this.game = game;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', (e) => this.onKeyDown(e));
      window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }
  }

  // logging helpers
  public getLogs() { return this.eventLog.slice(); }
  public clearLogs() { this.eventLog = []; }
  private now() { return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now(); }

  private onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (this.keyState[k]) return;
    this.keyState[k] = true;
    this.eventLog.push({ type: 'keydown', key: k, time: this.now() });
    switch (k) {
      case 'ArrowLeft':
        this.game.move(-1,0);
        // record immediate move
        try { const s = this.game.getState(); this.eventLog.push({ type: 'move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null }); } catch (e) {}
        this.leftDasTimer = (globalThis as any).setTimeout(() => {
          this.eventLog.push({ type: 'das-fired', key: k, time: this.now() });
          this.leftArrTimer = (globalThis as any).setInterval(() => {
            this.game.move(-1,0);
            try { const s = this.game.getState(); this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null }); } catch (e) {}
          }, this.ARR);
        }, this.DAS);
        break;
      case 'ArrowRight':
        this.game.move(1,0);
        try { const s = this.game.getState(); this.eventLog.push({ type: 'move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null }); } catch (e) {}
        this.rightDasTimer = (globalThis as any).setTimeout(() => {
          this.eventLog.push({ type: 'das-fired', key: k, time: this.now() });
          this.rightArrTimer = (globalThis as any).setInterval(() => {
            this.game.move(1,0);
            try { const s = this.game.getState(); this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null }); } catch (e) {}
          }, this.ARR);
        }, this.DAS);
        break;
      case 'ArrowUp':
      case 'x':
      case 'X':
        this.game.rotateCW();
        break;
      case 'z':
      case 'Z':
        this.game.rotateCCW();
        break;
      case 'ArrowDown':
        this.game.softDrop();
        try { const s = this.game.getState(); this.eventLog.push({ type: 'softdrop', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null }); } catch (e) {}
        this.downTimer = (globalThis as any).setInterval(() => {
          this.game.softDrop();
          try { const s = this.game.getState(); this.eventLog.push({ type: 'softdrop', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null }); } catch (e) {}
        }, this.SOFT_DROP_INTERVAL);
        break;
      case ' ':
        e.preventDefault();
        this.game.hardDrop();
        break;
      case 'c':
      case 'C':
        this.game.holdPiece();
        break;
      case 'p':
      case 'P':
        this.game.togglePause();
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    const k = e.key;
    this.keyState[k] = false;
    this.eventLog.push({ type: 'keyup', key: k, time: this.now() });
    switch (k) {
      case 'ArrowLeft':
        if (this.leftDasTimer) { (globalThis as any).clearTimeout(this.leftDasTimer); this.leftDasTimer = null; }
        if (this.leftArrTimer) { (globalThis as any).clearInterval(this.leftArrTimer); this.leftArrTimer = null; }
        this.eventLog.push({ type: 'arr-stopped', key: k, time: this.now() });
        break;
      case 'ArrowRight':
        if (this.rightDasTimer) { (globalThis as any).clearTimeout(this.rightDasTimer); this.rightDasTimer = null; }
        if (this.rightArrTimer) { (globalThis as any).clearInterval(this.rightArrTimer); this.rightArrTimer = null; }
        this.eventLog.push({ type: 'arr-stopped', key: k, time: this.now() });
        break;
      case 'ArrowDown':
        if (this.downTimer) { (globalThis as any).clearInterval(this.downTimer); this.downTimer = null; }
        this.eventLog.push({ type: 'softdrop-stopped', key: k, time: this.now() });
        break;
    }
  }
}
