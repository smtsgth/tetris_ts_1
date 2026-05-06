export default class Input {
    // Public accessors so UI can update tuning at runtime
    getDAS() { return this.DAS; }
    setDAS(ms) { this.DAS = Math.max(0, Math.floor(ms)); }
    getARR() { return this.ARR; }
    setARR(ms) { this.ARR = Math.max(0, Math.floor(ms)); }
    getSoftDropInterval() { return this.SOFT_DROP_INTERVAL; }
    setSoftDropInterval(ms) { this.SOFT_DROP_INTERVAL = Math.max(0, Math.floor(ms)); }
    constructor(game) {
        this.locked = false;
        // event logging for precise DAS/ARR measurement
        this.eventLog = [];
        this.keyState = {};
        this.leftDasTimer = null;
        this.leftArrTimer = null;
        this.rightDasTimer = null;
        this.rightArrTimer = null;
        this.downTimer = null;
        // tuning (tunable values)
        this.DAS = 5; // ms before auto-repeat (default preset)
        this.ARR = 25; // ms between auto-moves (default preset)
        this.SOFT_DROP_INTERVAL = 15; // ms (default preset)
        this.game = game;
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('keydown', (e) => this.onKeyDown(e));
            window.addEventListener('keyup', (e) => this.onKeyUp(e));
        }
    }
    // logging helpers
    getLogs() { return this.eventLog.slice(); }
    clearLogs() { this.eventLog = []; }
    now() { return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now(); }
    // reset input state and clear timers (used by UI restart)
    reset() {
        try {
            if (this.leftDasTimer) {
                globalThis.clearTimeout(this.leftDasTimer);
                this.leftDasTimer = null;
            }
        }
        catch (e) { }
        try {
            if (this.leftArrTimer) {
                globalThis.clearInterval(this.leftArrTimer);
                this.leftArrTimer = null;
            }
        }
        catch (e) { }
        try {
            if (this.rightDasTimer) {
                globalThis.clearTimeout(this.rightDasTimer);
                this.rightDasTimer = null;
            }
        }
        catch (e) { }
        try {
            if (this.rightArrTimer) {
                globalThis.clearInterval(this.rightArrTimer);
                this.rightArrTimer = null;
            }
        }
        catch (e) { }
        try {
            if (this.downTimer) {
                globalThis.clearInterval(this.downTimer);
                this.downTimer = null;
            }
        }
        catch (e) { }
        this.keyState = {};
        this.clearLogs();
        this.locked = false;
    }
    // disable/enable input processing (used by AI to prevent user interactions while planning)
    setLocked(v) { this.locked = !!v; }
    isLocked() { return this.locked; }
    onKeyDown(e) {
        const k = e.key;
        // If AI is enabled and configured to disable input during run, respect that globally.
        try {
            const ai = window.ai;
            if (ai && typeof ai.isEnabled === 'function' && ai.isEnabled() && typeof ai.getDisableInputDuringRun === 'function' && ai.getDisableInputDuringRun()) {
                if (k !== 'Escape' && k !== 'r' && k !== 'R' && k !== 'Enter') {
                    e.preventDefault();
                    return;
                }
            }
        }
        catch (e) { }
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
                try {
                    if (typeof this.game.togglePause === 'function')
                        this.game.togglePause();
                }
                catch (er) { }
                e.preventDefault();
                return;
            }
            // if game over: allow R/Enter to restart, otherwise ignore other inputs
            if (s && s.over) {
                if (k === 'r' || k === 'R' || k === 'Enter') {
                    try {
                        this.reset();
                    }
                    catch (er) { }
                    try {
                        this.game.reset();
                    }
                    catch (er) { }
                }
                return;
            }
            // while paused: allow R to restart (ESC handled above), ignore other gameplay inputs
            if (s && s.paused) {
                if (k === 'r' || k === 'R') {
                    try {
                        this.reset();
                    }
                    catch (er) { }
                    try {
                        this.game.reset();
                    }
                    catch (er) { }
                }
                return;
            }
        }
        catch (e) { }
        if (this.keyState[k])
            return;
        this.keyState[k] = true;
        this.eventLog.push({ type: 'keydown', key: k, time: this.now() });
        switch (k) {
            case 'ArrowLeft':
                this.game.move(-1, 0);
                // record immediate move
                try {
                    const s = this.game.getState();
                    this.eventLog.push({ type: 'move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null });
                }
                catch (e) { }
                this.leftDasTimer = globalThis.setTimeout(() => {
                    this.eventLog.push({ type: 'das-fired', key: k, time: this.now() });
                    // if game ended or paused before DAS elapsed, don't start ARR
                    try {
                        const s = this.game.getState();
                        if (s.over || s.paused)
                            return;
                    }
                    catch (e) { }
                    this.leftArrTimer = globalThis.setInterval(() => {
                        try {
                            const s = this.game.getState();
                            if (s.over || s.paused) {
                                if (this.leftArrTimer) {
                                    globalThis.clearInterval(this.leftArrTimer);
                                    this.leftArrTimer = null;
                                }
                                return;
                            }
                        }
                        catch (e) { }
                        this.game.move(-1, 0);
                        try {
                            const s2 = this.game.getState();
                            this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s2.current ? { x: s2.current.x, y: s2.current.y } : null });
                        }
                        catch (e) { }
                    }, this.ARR);
                }, this.DAS);
                break;
            case 'ArrowRight':
                this.game.move(1, 0);
                try {
                    const s = this.game.getState();
                    this.eventLog.push({ type: 'move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null });
                }
                catch (e) { }
                this.rightDasTimer = globalThis.setTimeout(() => {
                    this.eventLog.push({ type: 'das-fired', key: k, time: this.now() });
                    try {
                        const s = this.game.getState();
                        if (s.over || s.paused)
                            return;
                    }
                    catch (e) { }
                    this.rightArrTimer = globalThis.setInterval(() => {
                        try {
                            const s = this.game.getState();
                            if (s.over || s.paused) {
                                if (this.rightArrTimer) {
                                    globalThis.clearInterval(this.rightArrTimer);
                                    this.rightArrTimer = null;
                                }
                                return;
                            }
                        }
                        catch (e) { }
                        this.game.move(1, 0);
                        try {
                            const s2 = this.game.getState();
                            this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s2.current ? { x: s2.current.x, y: s2.current.y } : null });
                        }
                        catch (e) { }
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
                try {
                    const s = this.game.getState();
                    this.eventLog.push({ type: 'softdrop', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null });
                }
                catch (e) { }
                this.downTimer = globalThis.setInterval(() => {
                    try {
                        const s = this.game.getState();
                        if (s.over || s.paused) {
                            if (this.downTimer) {
                                globalThis.clearInterval(this.downTimer);
                                this.downTimer = null;
                            }
                            return;
                        }
                    }
                    catch (e) { }
                    this.game.softDrop();
                    try {
                        const s2 = this.game.getState();
                        this.eventLog.push({ type: 'softdrop', key: k, time: this.now(), pos: s2.current ? { x: s2.current.x, y: s2.current.y } : null });
                    }
                    catch (e) { }
                }, this.SOFT_DROP_INTERVAL);
                break;
            case ' ':
                e.preventDefault();
                this.game.hardDrop();
                break;
            case 'c':
            case 'C':
                try {
                    if (typeof this.game.holdPiece === 'function')
                        this.game.holdPiece(1);
                }
                catch (e) { }
                break;
            case 'v':
            case 'V':
                try {
                    if (typeof this.game.holdPiece === 'function')
                        this.game.holdPiece(2);
                }
                catch (e) { }
                break;
            case 'p':
            case 'P':
                this.game.togglePause();
                break;
        }
    }
    onKeyUp(e) {
        const k = e.key;
        this.keyState[k] = false;
        this.eventLog.push({ type: 'keyup', key: k, time: this.now() });
        switch (k) {
            case 'ArrowLeft':
                if (this.leftDasTimer) {
                    globalThis.clearTimeout(this.leftDasTimer);
                    this.leftDasTimer = null;
                }
                if (this.leftArrTimer) {
                    globalThis.clearInterval(this.leftArrTimer);
                    this.leftArrTimer = null;
                }
                this.eventLog.push({ type: 'arr-stopped', key: k, time: this.now() });
                break;
            case 'ArrowRight':
                if (this.rightDasTimer) {
                    globalThis.clearTimeout(this.rightDasTimer);
                    this.rightDasTimer = null;
                }
                if (this.rightArrTimer) {
                    globalThis.clearInterval(this.rightArrTimer);
                    this.rightArrTimer = null;
                }
                this.eventLog.push({ type: 'arr-stopped', key: k, time: this.now() });
                break;
            case 'ArrowDown':
                if (this.downTimer) {
                    globalThis.clearInterval(this.downTimer);
                    this.downTimer = null;
                }
                this.eventLog.push({ type: 'softdrop-stopped', key: k, time: this.now() });
                break;
        }
    }
}
