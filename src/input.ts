import Game from './game.js';

export default class Input {
  private game: Game;
  private locked: boolean = false;
  // event logging for precise DAS/ARR measurement
  public eventLog: Array<any> = [];
  private keyState: Record<string, boolean> = {};
  private leftDasTimer: number | null = null;
  private leftArrTimer: number | null = null;
  private rightDasTimer: number | null = null;
  private rightArrTimer: number | null = null;
  private downTimer: number | null = null;

  // tuning (tunable values)
  // Defaults tuned to typical DAS/ARR expectations used by tests/UI
  private DAS = 170; // ms before auto-repeat (default preset)
  private ARR = 30;  // ms between auto-moves (default preset)
  private SOFT_DROP_INTERVAL = 15; // ms (default preset)

  // Public accessors so UI can update tuning at runtime
  public getDAS() { return this.DAS; }
  public setDAS(ms: number) { this.DAS = Math.max(0, Math.floor(ms)); }
  public getARR() { return this.ARR; }
  public setARR(ms: number) { this.ARR = Math.max(0, Math.floor(ms)); }
  public getSoftDropInterval() { return this.SOFT_DROP_INTERVAL; }
  public setSoftDropInterval(ms: number) { this.SOFT_DROP_INTERVAL = Math.max(0, Math.floor(ms)); }

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

  // reset input state and clear timers (used by UI restart)
  public reset() {
    try { if (this.leftDasTimer) { (globalThis as any).clearTimeout(this.leftDasTimer); this.leftDasTimer = null; } } catch (e) { }
    try { if (this.leftArrTimer) { (globalThis as any).clearInterval(this.leftArrTimer); this.leftArrTimer = null; } } catch (e) { }
    try { if (this.rightDasTimer) { (globalThis as any).clearTimeout(this.rightDasTimer); this.rightDasTimer = null; } } catch (e) { }
    try { if (this.rightArrTimer) { (globalThis as any).clearInterval(this.rightArrTimer); this.rightArrTimer = null; } } catch (e) { }
    try { if (this.downTimer) { (globalThis as any).clearInterval(this.downTimer); this.downTimer = null; } } catch (e) { }
    this.keyState = {};
    this.clearLogs();
    this.locked = false;
  }

  // disable/enable input processing (used by AI to prevent user interactions while planning)
  public setLocked(v: boolean) { this.locked = !!v; }
  public isLocked() { return this.locked; }

  private onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    // If AI is enabled and configured to disable input during run, respect that globally.
    try {
      const ai = (window as any).ai;
      if (ai && typeof ai.isEnabled === 'function' && ai.isEnabled() && typeof ai.getDisableInputDuringRun === 'function' && ai.getDisableInputDuringRun()) {
        if (k !== 'Escape' && k !== 'r' && k !== 'R' && k !== 'Enter') {
          e.preventDefault();
          return;
        }
      }
    } catch (e) { }
    // if input is locked, ignore gameplay keys except for ESC/pause/restart controls
    if (this.locked && k !== 'Escape' && k !== 'r' && k !== 'R' && k !== 'Enter') {
      e.preventDefault();
      return;
    }
    // allow pause/resume/restart keys regardless of paused/over state
    try {
      const s = this.game && typeof this.game.getState === 'function' ? this.game.getState() : null;
      // ESC toggles pause/resume
      if (k === 'Escape') {
        try { if (typeof this.game.togglePause === 'function') this.game.togglePause(); } catch (er) { }
        e.preventDefault();
        return;
      }
      // if game over: allow R/Enter to restart, otherwise ignore other inputs
      if (s && s.over) {
        if (k === 'r' || k === 'R' || k === 'Enter') {
          try { this.reset(); } catch (er) { }
          try { this.game.reset(); } catch (er) { }
        }
        return;
      }
      // while paused: allow R to restart (ESC handled above), ignore other gameplay inputs
      if (s && s.paused) {
        if (k === 'r' || k === 'R') {
          try { this.reset(); } catch (er) { }
          try { this.game.reset(); } catch (er) { }
        }
        return;
      }

    } catch (e) { }

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
          // if game ended or paused before DAS elapsed, don't start ARR
          try { const s = this.game.getState(); if (s.over || s.paused) return; } catch (e) { }
          this.leftArrTimer = (globalThis as any).setInterval(() => {
            try {
              const s = this.game.getState();
              if (s.over || s.paused) {
                if (this.leftArrTimer) { (globalThis as any).clearInterval(this.leftArrTimer); this.leftArrTimer = null; }
                return;
              }
            } catch (e) { }
            this.game.move(-1,0);
            try { const s2 = this.game.getState(); this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s2.current ? { x: s2.current.x, y: s2.current.y } : null }); } catch (e) {}
          }, this.ARR);
        }, this.DAS);
        break;
      case 'ArrowRight':
        this.game.move(1,0);
        try { const s = this.game.getState(); this.eventLog.push({ type: 'move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null }); } catch (e) {}
        this.rightDasTimer = (globalThis as any).setTimeout(() => {
          this.eventLog.push({ type: 'das-fired', key: k, time: this.now() });
          try { const s = this.game.getState(); if (s.over || s.paused) return; } catch (e) { }
          this.rightArrTimer = (globalThis as any).setInterval(() => {
            try {
              const s = this.game.getState();
              if (s.over || s.paused) {
                if (this.rightArrTimer) { (globalThis as any).clearInterval(this.rightArrTimer); this.rightArrTimer = null; }
                return;
              }
            } catch (e) { }
            this.game.move(1,0);
            try { const s2 = this.game.getState(); this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s2.current ? { x: s2.current.x, y: s2.current.y } : null }); } catch (e) {}
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
          try {
            const s = this.game.getState();
            if (s.over || s.paused) {
              if (this.downTimer) { (globalThis as any).clearInterval(this.downTimer); this.downTimer = null; }
              return;
            }
          } catch (e) { }
          this.game.softDrop();
          try { const s2 = this.game.getState(); this.eventLog.push({ type: 'softdrop', key: k, time: this.now(), pos: s2.current ? { x: s2.current.x, y: s2.current.y } : null }); } catch (e) {}
        }, this.SOFT_DROP_INTERVAL);
        break;
      case ' ':
        e.preventDefault();
        this.game.hardDrop();
        break;
      case 'c':
      case 'C':
        try { if (typeof this.game.holdPiece === 'function') this.game.holdPiece(1); } catch (e) {}
        break;
      case 'v':
      case 'V':
        try { if (typeof this.game.holdPiece === 'function') this.game.holdPiece(2); } catch (e) {}
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
