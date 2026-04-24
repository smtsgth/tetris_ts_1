import { BLOCK_SIZE, COLS, ROWS, VISIBLE_ROWS, HIDDEN_ROWS, COLORS } from './constants.js';
import { getRotationMatrix } from './tetromino.js';
function fitCanvas(canvas, cols, rows) {
    if (!canvas)
        return null;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cols * BLOCK_SIZE * dpr;
    canvas.height = rows * BLOCK_SIZE * dpr;
    canvas.style.width = `${cols * BLOCK_SIZE}px`;
    canvas.style.height = `${rows * BLOCK_SIZE}px`;
    const ctx = canvas.getContext('2d');
    if (ctx)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}
export default class Renderer {
    constructor(game) {
        this.boardCanvas = null;
        this.nextCanvas = null;
        this.holdCanvas = null;
        this.scoreEl = null;
        this.linesEl = null;
        this.levelEl = null;
        this.b2bEl = null;
        this.comboEl = null;
        this.logEl = null;
        this.overlayEl = null;
        this.overlayMsgEl = null;
        this.gameOverEl = null;
        this.restartBtn = null;
        this.goScoreEl = null;
        this.goLinesEl = null;
        this.prevScore = 0;
        this.prevLines = 0;
        this.lastOverState = false;
        this.lineFlashExpiry = 0;
        this.scorePulseExpiry = 0;
        // animation state for score
        this.displayScore = 0;
        this.scoreAnimStart = 0;
        this.scoreAnimFrom = 0;
        this.scoreAnimTo = 0;
        this.scoreAnimDuration = 420;
        this.game = game;
        // initialize when DOM is ready to avoid null canvas errors
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._initDOM());
        }
        else {
            this._initDOM();
        }
        this.game.onChange(() => this.render());
        this.render();
    }
    _initDOM() {
        try {
            this.boardCanvas = document.getElementById('board');
            this.nextCanvas = document.getElementById('next-canvas');
            this.holdCanvas = document.getElementById('hold-canvas');
            this.scoreEl = document.getElementById('score');
            this.linesEl = document.getElementById('lines');
            this.levelEl = document.getElementById('level');
            this.b2bEl = document.getElementById('b2b');
            this.comboEl = document.getElementById('combo');
            this.logEl = document.getElementById('log');
            this.overlayEl = document.getElementById('overlay');
            this.overlayMsgEl = document.getElementById('overlay-msg');
            // Render only the visible rows (hide the internal hidden rows)
            fitCanvas(this.boardCanvas, COLS, VISIBLE_ROWS);
            // allocate more rows for next preview (show multiple next pieces stacked)
            fitCanvas(this.nextCanvas, 4, 20);
            fitCanvas(this.holdCanvas, 4, 4);
            // size the overlay area to match the board canvas so overlays align
            if (this.overlayEl && this.boardCanvas) {
                const bw = this.boardCanvas.style.width || `${COLS * BLOCK_SIZE}px`;
                const bh = this.boardCanvas.style.height || `${VISIBLE_ROWS * BLOCK_SIZE}px`;
                this.overlayEl.style.width = bw;
                this.overlayEl.style.height = bh;
            }
            // game-over UI
            this.gameOverEl = document.getElementById('game-over');
            this.restartBtn = document.getElementById('restart-btn');
            this.goScoreEl = document.getElementById('go-score');
            this.goLinesEl = document.getElementById('go-lines');
            if (this.restartBtn) {
                this.restartBtn.addEventListener('click', () => {
                    if (window.input && typeof window.input.reset === 'function')
                        window.input.reset();
                    this.game.reset();
                });
            }
            // keep overlay positions updated on resize
            window.addEventListener('resize', () => {
                try {
                    this.updateOverlayPositions();
                }
                catch (e) { }
            });
            // allow quick restart via Enter / R
            window.addEventListener('keydown', (e) => {
                if ((e.key === 'r' || e.key === 'R' || e.key === 'Enter') && this.game.getState().over) {
                    if (window.input && typeof window.input.reset === 'function')
                        window.input.reset();
                    this.game.reset();
                }
            });
        }
        catch (e) {
            console.error('Renderer initialization failed:', e);
        }
    }
    updateOverlayPositions() {
        if (!this.boardCanvas)
            return;
        const left = this.boardCanvas.offsetLeft + 'px';
        const top = this.boardCanvas.offsetTop + 'px';
        const width = this.boardCanvas.clientWidth + 'px';
        const height = this.boardCanvas.clientHeight + 'px';
        if (this.overlayEl) {
            this.overlayEl.style.left = left;
            this.overlayEl.style.top = top;
            this.overlayEl.style.width = width;
            this.overlayEl.style.height = height;
        }
        if (this.gameOverEl) {
            this.gameOverEl.style.left = left;
            this.gameOverEl.style.top = top;
            this.gameOverEl.style.width = width;
            this.gameOverEl.style.height = height;
            // center the inner box
            this.gameOverEl.style.display = this.game.getState().over ? 'flex' : 'none';
        }
    }
    clear(ctx, w, h) {
        // Reset transform to identity to clear entire backing buffer correctly,
        // then restore transform so subsequent drawing uses the scaled context.
        try {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.restore();
        }
        catch (e) {
            // fallback
            ctx.clearRect(0, 0, w, h);
        }
    }
    render() {
        var _a, _b, _c, _d;
        const state = this.game.getState();
        const boardCtx = this.boardCanvas ? this.boardCanvas.getContext('2d') : null;
        const nextCtx = this.nextCanvas ? this.nextCanvas.getContext('2d') : null;
        const holdCtx = this.holdCanvas ? this.holdCanvas.getContext('2d') : null;
        const w = this.boardCanvas ? this.boardCanvas.width : 0;
        const h = this.boardCanvas ? this.boardCanvas.height : 0;
        // draw board if canvas available
        if (boardCtx) {
            this.clear(boardCtx, w, h);
            for (let r = HIDDEN_ROWS; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const cell = state.board[r][c];
                    if (cell)
                        this.drawCell(boardCtx, c, r - HIDDEN_ROWS, COLORS[cell]);
                }
            }
        }
        // draw current piece (if board canvas available)
        const cur = state.current;
        if (boardCtx && cur) {
            for (let r = 0; r < cur.matrix.length; r++) {
                for (let c = 0; c < cur.matrix[r].length; c++) {
                    if (!cur.matrix[r][c])
                        continue;
                    const x = cur.x + c;
                    const y = cur.y + r - HIDDEN_ROWS;
                    if (y >= 0)
                        this.drawCell(boardCtx, x, y, COLORS[cur.type]);
                }
            }
            // ghost
            let ghostY = cur.y;
            while (this.game.isValidPos(cur.matrix, cur.x, ghostY + 1))
                ghostY++;
            for (let r = 0; r < cur.matrix.length; r++) {
                for (let c = 0; c < cur.matrix[r].length; c++) {
                    if (!cur.matrix[r][c])
                        continue;
                    const x = cur.x + c;
                    const y = ghostY + r - HIDDEN_ROWS;
                    if (y >= 0)
                        this.drawCell(boardCtx, x, y, 'rgba(200,200,200,0.12)');
                }
            }
            // trigger visual effects when state changed
            try {
                const now = Date.now();
                if (state.lines > this.prevLines) {
                    // small warm flash when lines increase (shorter duration)
                    this.lineFlashExpiry = now + 180;
                }
                if (state.score > this.prevScore) {
                    // start numeric animation from current displayed value to new score
                    const nowAnim = Date.now();
                    this.scoreAnimFrom = typeof this.displayScore === 'number' ? this.displayScore : this.prevScore;
                    this.scoreAnimTo = state.score;
                    this.scoreAnimStart = nowAnim;
                    this.scoreAnimDuration = 420;
                    if (this.scoreEl) {
                        this.scoreEl.classList.add('score-pulse');
                        setTimeout(() => { try {
                            this.scoreEl && this.scoreEl.classList.remove('score-pulse');
                        }
                        catch (e) { } }, this.scoreAnimDuration);
                    }
                }
            }
            catch (e) { }
        }
        // apply line flash overlay if active
        try {
            const now2 = Date.now();
            if (this.lineFlashExpiry && now2 < this.lineFlashExpiry && boardCtx && this.boardCanvas) {
                const rem = this.lineFlashExpiry - now2;
                const duration = 180;
                const alpha = Math.max(0, Math.min(0.6, (rem / duration) * 0.6));
                // warm, soft flash (pale yellow) instead of harsh white
                boardCtx.fillStyle = `rgba(255,245,200,${alpha})`;
                boardCtx.fillRect(0, 0, this.boardCanvas.clientWidth, this.boardCanvas.clientHeight);
            }
        }
        catch (e) { }
        // next (draw stacked 4x4 matrices)
        if (nextCtx && this.nextCanvas) {
            this.clear(nextCtx, this.nextCanvas.width, this.nextCanvas.height);
            const next = state.next || [];
            for (let i = 0; i < next.length; i++) {
                const shape = next[i];
                const mat = getRotationMatrix(shape, 0);
                for (let r = 0; r < mat.length; r++) {
                    for (let c = 0; c < mat[r].length; c++) {
                        if (!mat[r][c])
                            continue;
                        const color = COLORS[shape];
                        // position each next-piece block in its 4-row slot
                        const col = c;
                        const row = i * 4 + r;
                        const x = col * BLOCK_SIZE;
                        const y = row * BLOCK_SIZE;
                        nextCtx.fillStyle = color;
                        nextCtx.fillRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
                    }
                }
            }
        }
        // hold
        if (holdCtx && this.holdCanvas) {
            this.clear(holdCtx, this.holdCanvas.width, this.holdCanvas.height);
            if (state.hold) {
                const mat = getRotationMatrix(state.hold, 0);
                for (let r = 0; r < mat.length; r++) {
                    for (let c = 0; c < mat[r].length; c++) {
                        if (!mat[r][c])
                            continue;
                        const color = COLORS[state.hold];
                        const x = c * BLOCK_SIZE;
                        const y = r * BLOCK_SIZE;
                        holdCtx.fillStyle = color;
                        holdCtx.fillRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
                    }
                }
            }
        }
        // NOTE: GAME OVER overlay is handled by the DOM `#game-over` element
        // to avoid duplicating canvas text and leaving artifacts.
        // animate display score if animation in progress, else show actual
        try {
            const nowAnim2 = Date.now();
            if (this.scoreAnimStart && this.scoreAnimStart > 0) {
                const t = Math.min(1, (nowAnim2 - this.scoreAnimStart) / this.scoreAnimDuration);
                const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
                this.displayScore = Math.floor(this.scoreAnimFrom + (this.scoreAnimTo - this.scoreAnimFrom) * eased);
                if (this.scoreEl)
                    this.scoreEl.textContent = String(this.displayScore);
                if (t >= 1) {
                    this.scoreAnimStart = 0;
                    this.displayScore = this.scoreAnimTo;
                }
            }
            else {
                if (this.scoreEl)
                    this.scoreEl.textContent = String(state.score);
                this.displayScore = state.score;
            }
        }
        catch (e) {
            if (this.scoreEl)
                this.scoreEl.textContent = String(state.score);
        }
        if (this.linesEl)
            this.linesEl.textContent = String(state.lines);
        if (this.levelEl)
            this.levelEl.textContent = String(state.level);
        if (this.b2bEl)
            this.b2bEl.textContent = state.b2b ? 'ON' : 'OFF';
        if (this.comboEl) {
            this.comboEl.textContent = String(state.combo);
            this.comboEl.className = 'combo ' + (state.combo >= 4 ? 'level-4' : state.combo >= 3 ? 'level-3' : state.combo >= 2 ? 'level-2' : 'level-1');
        }
        // render notifications log
        if (this.logEl) {
            this.logEl.innerHTML = '';
            const notifs = state.notifications || [];
            for (const n of notifs.slice().reverse()) {
                const li = document.createElement('li');
                li.textContent = n.msg;
                this.logEl.appendChild(li);
            }
        }
        // overlay for T-Spin / Tetris
        if (this.overlayEl && this.overlayMsgEl) {
            const notifs = state.notifications || [];
            const last = notifs.length ? notifs[notifs.length - 1].msg : null;
            if (last && (last.includes('T-Spin') || last.includes('TETRIS'))) {
                this.overlayMsgEl.textContent = last.toUpperCase();
                this.overlayMsgEl.classList.remove('overlay-show');
                // trigger reflow
                void this.overlayMsgEl.offsetWidth;
                this.overlayMsgEl.classList.add('overlay-show');
            }
        }
        // update overlay sizing and game-over visibility
        // update positions each frame (handles responsive layouts)
        try {
            this.updateOverlayPositions();
        }
        catch (e) { }
        // handle dimming and focus transitions on game over
        try {
            const overNow = !!state.over;
            if (overNow && !this.lastOverState) {
                if (this.goScoreEl)
                    this.goScoreEl.textContent = String(state.score);
                if (this.goLinesEl)
                    this.goLinesEl.textContent = String(state.lines);
                try {
                    (_a = this.restartBtn) === null || _a === void 0 ? void 0 : _a.focus();
                }
                catch (e) { }
                try {
                    (_b = this.boardCanvas) === null || _b === void 0 ? void 0 : _b.classList.add('dimmed');
                }
                catch (e) { }
            }
            else if (!overNow && this.lastOverState) {
                try {
                    (_c = this.boardCanvas) === null || _c === void 0 ? void 0 : _c.classList.remove('dimmed');
                }
                catch (e) { }
                try {
                    (_d = this.boardCanvas) === null || _d === void 0 ? void 0 : _d.focus();
                }
                catch (e) { }
            }
            this.lastOverState = overNow;
        }
        catch (e) { }
        if (this.gameOverEl) {
            if (state.over) {
                this.gameOverEl.classList.add('show');
                this.gameOverEl.setAttribute('aria-hidden', 'false');
            }
            else {
                this.gameOverEl.classList.remove('show');
                this.gameOverEl.setAttribute('aria-hidden', 'true');
            }
        }
        // update accessibility live region if present
        try {
            const a11y = document.getElementById('a11y-notify');
            if (a11y) {
                const last = state.notifications && state.notifications.length ? state.notifications[state.notifications.length - 1].msg : null;
                if (last) {
                    a11y.textContent = last;
                }
                else if (state.over) {
                    a11y.textContent = 'Game over';
                }
            }
        }
        catch (e) { }
        // update previous metrics for next frame
        try {
            this.prevScore = state.score;
            this.prevLines = state.lines;
        }
        catch (e) { }
    }
    drawCell(ctx, col, row, color) {
        const x = col * BLOCK_SIZE;
        const y = row * BLOCK_SIZE;
        ctx.fillStyle = color;
        ctx.fillRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
    }
}
