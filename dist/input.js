export default class Input {
    constructor(game) {
        // event logging for precise DAS/ARR measurement
        this.eventLog = [];
        this.keyState = {};
        this.leftDasTimer = null;
        this.leftArrTimer = null;
        this.rightDasTimer = null;
        this.rightArrTimer = null;
        this.downTimer = null;
        // tuning (tunable values)
        this.DAS = 170; // ms before auto-repeat (tuned)
        this.ARR = 30; // ms between auto-moves (tuned)
        this.SOFT_DROP_INTERVAL = 50; // ms (tuned)
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
    onKeyDown(e) {
        const k = e.key;
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
                    this.leftArrTimer = globalThis.setInterval(() => {
                        this.game.move(-1, 0);
                        try {
                            const s = this.game.getState();
                            this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null });
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
                    this.rightArrTimer = globalThis.setInterval(() => {
                        this.game.move(1, 0);
                        try {
                            const s = this.game.getState();
                            this.eventLog.push({ type: 'arr-move', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null });
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
                    this.game.softDrop();
                    try {
                        const s = this.game.getState();
                        this.eventLog.push({ type: 'softdrop', key: k, time: this.now(), pos: s.current ? { x: s.current.x, y: s.current.y } : null });
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
                this.game.holdPiece();
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
