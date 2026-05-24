import { BLOCK_SIZE, COLS, ROWS, VISIBLE_ROWS, HIDDEN_ROWS, COLORS } from './constants.js';
import Game from './game.js';
import { getRotationMatrix } from './tetromino.js';

function fitCanvas(canvas: HTMLCanvasElement | null, cols: number, rows: number) {
  if (!canvas) return null;
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = cols * BLOCK_SIZE * dpr;
  canvas.height = rows * BLOCK_SIZE * dpr;
  canvas.style.width = `${cols * BLOCK_SIZE}px`;
  canvas.style.height = `${rows * BLOCK_SIZE}px`;
  const ctx = canvas.getContext('2d');
  if (ctx)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function fitCanvasPx(canvas: HTMLCanvasElement | null, widthPx: number, heightPx: number) {
  if (!canvas) return null;
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.max(0, Math.round(widthPx * dpr));
  canvas.height = Math.max(0, Math.round(heightPx * dpr));
  canvas.style.width = `${Math.max(0, Math.round(widthPx))}px`;
  canvas.style.height = `${Math.max(0, Math.round(heightPx))}px`;
  const ctx = canvas.getContext('2d');
  if (ctx)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export default class Renderer {
  private nextCount = 6; // configurable number of previews (1-6)
  private boardCanvas: HTMLCanvasElement | null = null;
  private nextCanvas: HTMLCanvasElement | null = null;
  private holdCanvas1: HTMLCanvasElement | null = null;
  private holdCanvas2: HTMLCanvasElement | null = null;
  private holdBox1El: HTMLElement | null = null;
  private holdBox2El: HTMLElement | null = null;
  private lastNotificationTs = 0;
  private holdFlashTimer1: number | null = null;
  private holdFlashTimer2: number | null = null;
  private nextSidePadding: number = 0;
  private game: Game;
  private scoreEl: HTMLElement | null = null;
  private linesEl: HTMLElement | null = null;
  private levelEl: HTMLElement | null = null;
  private b2bEl: HTMLElement | null = null;
  private comboEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private overlayMsgEl: HTMLElement | null = null;
  private gameOverEl: HTMLElement | null = null;
  private restartBtn: HTMLElement | null = null;
  private goScoreEl: HTMLElement | null = null;
  private goLinesEl: HTMLElement | null = null;
  private pauseOverlayEl: HTMLElement | null = null;
  private pauseResumeBtn: HTMLButtonElement | null = null;
  private pauseRestartBtn: HTMLButtonElement | null = null;

  private prevScore = 0;
  private prevLines = 0;
  private lastOverState = false;
  private lineFlashExpiry = 0;
  private scorePulseExpiry = 0;
  // size (in CSS pixels) used to render each preview cell in the Next canvas
  private nextCellSize: number = BLOCK_SIZE;

  public setNextCount(n: number) {
    const v = Math.max(1, Math.min(6, Math.floor(Number(n) || 0)));
    this.nextCount = v;
    try { this.resizeNextCanvas(); } catch (e) { }
    try { this.render(); } catch (e) { }
  }
  public getNextCount() { return this.nextCount; }

  private resizeNextCanvas() {
    if (!this.boardCanvas || !this.nextCanvas) return;
    // use offsetHeight to include borders and ensure a pixel-accurate match
    const boardHeight = this.boardCanvas.offsetHeight;
    const nextWrapper = this.nextCanvas.parentElement as HTMLElement | null;
    let padTop = 0, padBottom = 0, labelHeight = 0, labelMarginBottom = 0;
    try {
      if (nextWrapper) {
        const cs = window.getComputedStyle(nextWrapper);
        padTop = parseFloat(cs.paddingTop) || 0;
        padBottom = parseFloat(cs.paddingBottom) || 0;
        const labelEl = nextWrapper.querySelector('.label') as HTMLElement | null;
        if (labelEl) {
          const lcs = window.getComputedStyle(labelEl);
          labelHeight = labelEl.offsetHeight || (parseFloat(lcs.lineHeight) || 0);
          labelMarginBottom = parseFloat(lcs.marginBottom) || 0;
        }
        nextWrapper.style.height = `${boardHeight}px`;
        nextWrapper.style.boxSizing = 'border-box';
      }
    } catch (e) { }
    const innerHeight = Math.max(0, boardHeight - padTop - padBottom - labelHeight - labelMarginBottom);
    // compute cell size: allow up to BLOCK_SIZE per cell, but shrink so nextCount pieces fit vertically
    const fitSize = innerHeight / (this.nextCount * 4);
    const cellSize = Math.max(4, Math.min(BLOCK_SIZE, fitSize));
    this.nextCellSize = cellSize > 0 ? cellSize : BLOCK_SIZE;
    // add horizontal side padding so previews have breathing room (further reduced)
    const sidePadding = Math.max(1, Math.round(this.nextCellSize * 0.22));
    this.nextSidePadding = sidePadding;
    // also resize hold canvases so holds use the same per-block CSS size as the board/next
    try {
      if (this.holdCanvas1) fitCanvasPx(this.holdCanvas1, 4 * this.nextCellSize, 4 * this.nextCellSize);
      if (this.holdCanvas2) fitCanvasPx(this.holdCanvas2, 4 * this.nextCellSize, 4 * this.nextCellSize);
    } catch (e) { }
    // First, resize the main board so its per-block size matches nextCellSize —
    // do this before sizing the NEXT wrapper so we can base NEXT height on the final board dimensions.
    try {
      if (this.boardCanvas) {
        fitCanvasPx(this.boardCanvas, COLS * this.nextCellSize, VISIBLE_ROWS * this.nextCellSize);
      }
    } catch (e) { }
    // recompute final board height and next inner height after board resize
    try {
      const finalBoardHeight = this.boardCanvas ? this.boardCanvas.offsetHeight : boardHeight;
      if (nextWrapper) {
        nextWrapper.style.height = `${finalBoardHeight}px`;
        nextWrapper.style.boxSizing = 'border-box';
      }
      const finalInnerHeight = Math.max(0, (this.boardCanvas ? this.boardCanvas.offsetHeight : boardHeight) - padTop - padBottom - labelHeight - labelMarginBottom);
      // ensure next canvas fits into the updated wrapper height
      fitCanvasPx(this.nextCanvas, 4 * this.nextCellSize + sidePadding * 2, finalInnerHeight);
    } catch (e) { }
  }

  // animation state for score
  private displayScore = 0;
  private scoreAnimStart = 0;
  private scoreAnimFrom = 0;
  private scoreAnimTo = 0;
  private scoreAnimDuration = 420;

  constructor(game: Game) {
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
      this.boardCanvas = document.getElementById('board') as HTMLCanvasElement | null;
      this.nextCanvas = document.getElementById('next-canvas') as HTMLCanvasElement | null;
      this.holdCanvas1 = document.getElementById('hold-canvas-1') as HTMLCanvasElement | null;
      this.holdCanvas2 = document.getElementById('hold-canvas-2') as HTMLCanvasElement | null;
      this.holdBox1El = document.getElementById('hold1');
      this.holdBox2El = document.getElementById('hold2');
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
      // allocate rows for next preview so its background box matches the board height.
      if (this.boardCanvas && this.nextCanvas) {
        try { this.resizeNextCanvas(); } catch (e) { }
      }
      else {
        fitCanvas(this.nextCanvas, 4, VISIBLE_ROWS);
        this.nextCellSize = BLOCK_SIZE;
      }
      // make hold previews use the same per-block size as the board (4x4 grid * BLOCK_SIZE)
      try {
        fitCanvas(this.holdCanvas1, 4, 4);
        fitCanvas(this.holdCanvas2, 4, 4);
      } catch (e) {
        // fallback: ensure canvases are at least 4x4 logical cells
        fitCanvas(this.holdCanvas1, 4, 4);
        fitCanvas(this.holdCanvas2, 4, 4);
      }

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
      // pause overlay UI
      this.pauseOverlayEl = document.getElementById('pause-overlay');
      this.pauseResumeBtn = document.getElementById('pause-resume-btn') as HTMLButtonElement | null;
      this.pauseRestartBtn = document.getElementById('pause-restart-btn') as HTMLButtonElement | null;
      if (this.pauseResumeBtn) this.pauseResumeBtn.addEventListener('click', () => { try { this.game.togglePause(); } catch (e) {} });
      if (this.pauseRestartBtn) this.pauseRestartBtn.addEventListener('click', () => {
        try { if ((window as any).input && typeof (window as any).input.reset === 'function') (window as any).input.reset(); } catch (e) { }
        try { this.game.reset(); } catch (e) { }
      });
      if (this.restartBtn) {
        this.restartBtn.addEventListener('click', () => {
          if ((window as any).input && typeof (window as any).input.reset === 'function')
            (window as any).input.reset();
          this.game.reset();
        });
      }

      // keep overlay positions and next preview sizing updated on resize
      window.addEventListener('resize', () => {
        try { this.reflow(); } catch (e) { }
      });

      // initial reflow after layout settles (run in next paint frames)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { this.reflow(); } catch (e) { }
        });
      });

      // allow quick restart via Enter / R
      window.addEventListener('keydown', (e) => {
        if ((e.key === 'r' || e.key === 'R' || e.key === 'Enter') && this.game.getState().over) {
          if ((window as any).input && typeof (window as any).input.reset === 'function')
            (window as any).input.reset();
          this.game.reset();
        }
      });
    }
    catch (e) {
      console.error('Renderer initialization failed:', e);
    }
  }

  updateOverlayPositions() {
    if (!this.boardCanvas) return;
    // use bounding rect to compute absolute page position (robust across layout modes)
    const rect = this.boardCanvas.getBoundingClientRect();
    // compute coordinates relative to the overlay's offsetParent so absolute positioning aligns inside the container
    const parentRect = (this.overlayEl && (this.overlayEl.offsetParent as Element)) ? (this.overlayEl.offsetParent as Element).getBoundingClientRect() : { left: 0, top: 0 } as DOMRect;
    const left = `${Math.round(rect.left - parentRect.left)}px`;
    const top = `${Math.round(rect.top - parentRect.top)}px`;
    const width = `${Math.round(rect.width)}px`;
    const height = `${Math.round(rect.height)}px`;
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
      // ensure dimming state for game over
      if (this.game.getState().over) {
        try { this.boardCanvas.classList.add('dimmed'); } catch (e) { }
      }
    }
    // pause overlay: position and show when paused (but not when game over)
    if (this.pauseOverlayEl) {
      this.pauseOverlayEl.style.left = left;
      this.pauseOverlayEl.style.top = top;
      this.pauseOverlayEl.style.width = width;
      this.pauseOverlayEl.style.height = height;
      try {
        const s = this.game.getState();
        if (s.paused && !s.over) {
          this.pauseOverlayEl.classList.add('show');
          this.pauseOverlayEl.setAttribute('aria-hidden', 'false');
          try { this.pauseResumeBtn?.focus(); } catch (e) { }
          try { this.boardCanvas?.classList.add('dimmed'); } catch (e) { }
        } else {
          this.pauseOverlayEl.classList.remove('show');
          this.pauseOverlayEl.setAttribute('aria-hidden', 'true');
          try { if (!this.game.getState().over) this.boardCanvas?.classList.remove('dimmed'); } catch (e) { }
        }
      } catch (e) { }
    }
  }

  /**
   * Recalculate canvas backing buffer sizes and overlay positions.
   * Called on resize / initial paint to ensure canvases match computed CSS layout.
   */
  private reflow() {
    try {
      if (this.boardCanvas) fitCanvas(this.boardCanvas, COLS, VISIBLE_ROWS);
      if (this.holdCanvas1) fitCanvas(this.holdCanvas1, 4, 4);
      if (this.holdCanvas2) fitCanvas(this.holdCanvas2, 4, 4);
      // next canvas sizing depends on board dimensions
      if (this.boardCanvas && this.nextCanvas) this.resizeNextCanvas();
      // update overlay/game-over/pause positions
      this.updateOverlayPositions();
      // force a redraw
      try { this.render(); } catch (e) { }
    }
    catch (e) { }
  }

  clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
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
    const state = this.game.getState();
    const boardCtx = this.boardCanvas ? this.boardCanvas.getContext('2d') : null;
    const nextCtx = this.nextCanvas ? this.nextCanvas.getContext('2d') : null;
    const holdCtx1 = this.holdCanvas1 ? this.holdCanvas1.getContext('2d') : null;
    const holdCtx2 = this.holdCanvas2 ? this.holdCanvas2.getContext('2d') : null;
    const w = this.boardCanvas ? this.boardCanvas.width : 0;
    const h = this.boardCanvas ? this.boardCanvas.height : 0;
    // draw board if canvas available
    if (boardCtx) {
      this.clear(boardCtx, w, h);
      for (let r = HIDDEN_ROWS; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = state.board[r][c];
          if (cell) this.drawCell(boardCtx, c, r - HIDDEN_ROWS, COLORS[cell]);
        }
      }
    }
    // draw current piece (if board canvas available)
    const cur = state.current;
    if (boardCtx && cur) {
      for (let r = 0; r < cur.matrix.length; r++) {
        for (let c = 0; c < cur.matrix[r].length; c++) {
          if (!cur.matrix[r][c]) continue;
          const x = cur.x + c;
          const y = cur.y + r - HIDDEN_ROWS;
          if (y >= 0) this.drawCell(boardCtx, x, y, COLORS[cur.type]);
        }
      }
      // ghost
      let ghostY = cur.y;
      while (this.game.isValidPos(cur.matrix, cur.x, ghostY + 1)) ghostY++;
      for (let r = 0; r < cur.matrix.length; r++) {
        for (let c = 0; c < cur.matrix[r].length; c++) {
          if (!cur.matrix[r][c]) continue;
          const x = cur.x + c;
          const y = ghostY + r - HIDDEN_ROWS;
          if (y >= 0) this.drawCell(boardCtx, x, y, 'rgba(200,200,200,0.12)');
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
            setTimeout(() => { try { this.scoreEl && this.scoreEl.classList.remove('score-pulse'); } catch (e) { } }, this.scoreAnimDuration);
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
      const next = (state.next || []).slice(0, this.nextCount);
      const cell = this.nextCellSize;
      // reduce inner gap for Next preview blocks so pieces appear tighter
      const border = Math.max(0.5, cell * 0.035);
      // pack previews: use tighter stacking (less gap between previews)
      const gapBetweenPreviewsBlocks = 1.0; // larger -> previews are closer (tighter)
      const slotBlocks = 4 - gapBetweenPreviewsBlocks;
      // compute total content height using actual previews to be drawn
      const contentHeight = cell * (next.length * slotBlocks);
      // place previews biased toward the top of the Next canvas (user requested "上の方へ")
      const innerH = this.nextCanvas.clientHeight;
      const centerSpace = Math.max(0, innerH - contentHeight);
      const topBiasFactor = 0.02; // 0 = top-aligned, 0.5 = centered, 1 = bottom-aligned; smaller -> more top
      const offsetY = Math.max(1, Math.round(centerSpace * topBiasFactor));
      const offsetX = this.nextSidePadding || 0;
      for (let i = 0; i < next.length; i++) {
        const shape = next[i];
        const mat = getRotationMatrix(shape, 0);
        // compute bounding box of piece inside its 4x4 slot
        let minC = mat[0].length, maxC = -1, minR = mat.length, maxR = -1;
        for (let r = 0; r < mat.length; r++) {
          for (let c = 0; c < mat[r].length; c++) {
            if (!mat[r][c]) continue;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
          }
        }
        const widthBlocks = maxC >= minC ? (maxC - minC + 1) : 0;
        const heightBlocks = maxR >= minR ? (maxR - minR + 1) : 0;
        const leftPad = (4 - widthBlocks) / 2; // allow fractional pad for perfect centering
        const topPad = (slotBlocks - heightBlocks) / 2;
        for (let r = 0; r < mat.length; r++) {
          for (let c = 0; c < mat[r].length; c++) {
            if (!mat[r][c]) continue;
            const color = COLORS[shape as keyof typeof COLORS];
            // position each next-piece block in its 4-row slot using scaled cell size
            const colIndex = leftPad + (c - minC);
            const rowIndex = i * slotBlocks + topPad + (r - minR);
            const x = offsetX + colIndex * cell;
            const y = offsetY + rowIndex * cell;
            nextCtx.fillStyle = color;
            nextCtx.fillRect(x + border, y + border, Math.max(0, cell - border * 2), Math.max(0, cell - border * 2));
          }
        }
      }
    }
    // hold
    if (holdCtx1 && this.holdCanvas1) {
      this.clear(holdCtx1, this.holdCanvas1.width, this.holdCanvas1.height);
      if (state.hold) {
        const mat = getRotationMatrix(state.hold, 0);
        // compute bounding box of piece inside 4x4 matrix
        let minC = mat[0].length, maxC = -1, minR = mat.length, maxR = -1;
        for (let r = 0; r < mat.length; r++) {
          for (let c = 0; c < mat[r].length; c++) {
            if (!mat[r][c]) continue;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
          }
        }
        const widthBlocks = maxC >= minC ? (maxC - minC + 1) : 0;
        const heightBlocks = maxR >= minR ? (maxR - minR + 1) : 0;
        // fractional pad allowed; ensure a small minimum pad so wide pieces (I horizontal)
        // don't touch canvas edges. minPad is in block units.
        const minPad = 0.35;
        let leftPad = (4 - widthBlocks) / 2;
        if (widthBlocks >= 4) leftPad = Math.max(leftPad, minPad);
        let topPad = (4 - heightBlocks) / 2;
        if (heightBlocks >= 4) topPad = Math.max(topPad, minPad);
        // render hold preview using the same per-block size as the main board/next
        const cell = this.nextCellSize;
        const borderCell = Math.max(0.5, cell * 0.035);
        for (let r = 0; r < mat.length; r++) {
          for (let c = 0; c < mat[r].length; c++) {
            if (!mat[r][c]) continue;
            const color = COLORS[state.hold as keyof typeof COLORS];
            const colIndex = leftPad + (c - minC);
            const rowIndex = topPad + (r - minR);
            const x = colIndex * cell;
            const y = rowIndex * cell;
            holdCtx1.fillStyle = color;
            holdCtx1.fillRect(x + borderCell, y + borderCell, Math.max(0, cell - borderCell * 2), Math.max(0, cell - borderCell * 2));
          }
        }
      }
    }
    // second hold slot (placeholder until game supports two holds)
    if (holdCtx2 && this.holdCanvas2) {
      this.clear(holdCtx2, this.holdCanvas2.width, this.holdCanvas2.height);
      // if game later exposes hold2, draw it here; for now leave empty
      if ((state as any).hold2) {
        const mat2 = getRotationMatrix((state as any).hold2, 0);
        // compute bounding box and center in 4x4
        let minC2 = mat2[0].length, maxC2 = -1, minR2 = mat2.length, maxR2 = -1;
        for (let r = 0; r < mat2.length; r++) {
          for (let c = 0; c < mat2[r].length; c++) {
            if (!mat2[r][c]) continue;
            if (c < minC2) minC2 = c;
            if (c > maxC2) maxC2 = c;
            if (r < minR2) minR2 = r;
            if (r > maxR2) maxR2 = r;
          }
        }
        const widthBlocks2 = maxC2 >= minC2 ? (maxC2 - minC2 + 1) : 0;
        const heightBlocks2 = maxR2 >= minR2 ? (maxR2 - minR2 + 1) : 0;
        const minPad2 = 0.35;
        let leftPad2 = (4 - widthBlocks2) / 2;
        if (widthBlocks2 >= 4) leftPad2 = Math.max(leftPad2, minPad2);
        let topPad2 = (4 - heightBlocks2) / 2;
        if (heightBlocks2 >= 4) topPad2 = Math.max(topPad2, minPad2);
                const cell2 = this.nextCellSize;
                const borderCell2 = Math.max(0.5, cell2 * 0.035);
        for (let r = 0; r < mat2.length; r++) {
          for (let c = 0; c < mat2[r].length; c++) {
            if (!mat2[r][c]) continue;
            const color = COLORS[(state as any).hold2 as keyof typeof COLORS];
            const colIndex2 = leftPad2 + (c - minC2);
            const rowIndex2 = topPad2 + (r - minR2);
            const x = colIndex2 * cell2;
            const y = rowIndex2 * cell2;
            holdCtx2.fillStyle = color;
            holdCtx2.fillRect(x + borderCell2, y + borderCell2, Math.max(0, cell2 - borderCell2 * 2), Math.max(0, cell2 - borderCell2 * 2));
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
        if (this.scoreEl) this.scoreEl.textContent = String(this.displayScore);
        if (t >= 1) {
          this.scoreAnimStart = 0;
          this.displayScore = this.scoreAnimTo;
        }
      }
      else {
        if (this.scoreEl) this.scoreEl.textContent = String(state.score);
        this.displayScore = state.score;
      }
    }
    catch (e) { if (this.scoreEl) this.scoreEl.textContent = String(state.score); }
    if (this.linesEl) this.linesEl.textContent = String(state.lines);
    if (this.levelEl) this.levelEl.textContent = String(state.level);
    if (this.b2bEl) this.b2bEl.textContent = state.b2b ? 'ON' : 'OFF';
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
    // overlay for T-Spin / Tetris and hold flash notifications
    if (this.overlayEl && this.overlayMsgEl) {
      const notifs = state.notifications || [];
      const lastNotif = notifs.length ? notifs[notifs.length - 1] : null;
      const last = lastNotif ? lastNotif.msg : null;
      if (last && (last.includes('T-Spin') || last.includes('TETRIS'))) {
        this.overlayMsgEl.textContent = last.toUpperCase();
        this.overlayMsgEl.classList.remove('overlay-show');
        // trigger reflow
        void this.overlayMsgEl.offsetWidth;
        this.overlayMsgEl.classList.add('overlay-show');
      }
      // flash hold boxes on hold notifications (only once per notification)
      try {
        if (lastNotif && lastNotif.ts && lastNotif.ts > this.lastNotificationTs) {
          this.lastNotificationTs = lastNotif.ts;
          if (last && last.startsWith('Hold1') && this.holdBox1El) {
            const cls = last.includes('保存') ? 'hold-flash-saved' : last.includes('交換') ? 'hold-flash-swapped' : 'hold-flash';
            try { this.holdBox1El.classList.remove('hold-flash-saved'); this.holdBox1El.classList.remove('hold-flash-swapped'); this.holdBox1El.classList.remove('hold-flash'); } catch (e) {}
            this.holdBox1El.classList.add(cls);
            if (this.holdFlashTimer1) { clearTimeout(this.holdFlashTimer1); this.holdFlashTimer1 = null; }
            this.holdFlashTimer1 = window.setTimeout(() => { try { if (this.holdBox1El) { this.holdBox1El.classList.remove('hold-flash-saved'); this.holdBox1El.classList.remove('hold-flash-swapped'); this.holdBox1El.classList.remove('hold-flash'); } } catch (e) {} ; this.holdFlashTimer1 = null; }, 40) as any;
          }
          if (last && last.startsWith('Hold2') && this.holdBox2El) {
            const cls2 = last.includes('保存') ? 'hold-flash-saved' : last.includes('交換') ? 'hold-flash-swapped' : 'hold-flash';
            try { this.holdBox2El.classList.remove('hold-flash-saved'); this.holdBox2El.classList.remove('hold-flash-swapped'); this.holdBox2El.classList.remove('hold-flash'); } catch (e) {}
            this.holdBox2El.classList.add(cls2);
            if (this.holdFlashTimer2) { clearTimeout(this.holdFlashTimer2); this.holdFlashTimer2 = null; }
            this.holdFlashTimer2 = window.setTimeout(() => { try { if (this.holdBox2El) { this.holdBox2El.classList.remove('hold-flash-saved'); this.holdBox2El.classList.remove('hold-flash-swapped'); this.holdBox2El.classList.remove('hold-flash'); } } catch (e) {} ; this.holdFlashTimer2 = null; }, 40) as any;
          }
        }
      } catch (e) { }
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
        if (this.goScoreEl) this.goScoreEl.textContent = String(state.score);
        if (this.goLinesEl) this.goLinesEl.textContent = String(state.lines);
        try { this.restartBtn?.focus(); } catch (e) { }
        try { this.boardCanvas?.classList.add('dimmed'); } catch (e) { }
      }
      else if (!overNow && this.lastOverState) {
        try { this.boardCanvas?.classList.remove('dimmed'); } catch (e) { }
        try { this.boardCanvas?.focus(); } catch (e) { }
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

  drawCell(ctx: CanvasRenderingContext2D, col: number, row: number, color: string) {
    // determine dynamic cell size from the target canvas so board cells scale with canvas size
    const canvasEl = ctx.canvas as HTMLCanvasElement;
    const cssWidth = canvasEl.clientWidth || parseFloat(canvasEl.style.width) || (COLS * BLOCK_SIZE);
    const cell = cssWidth / COLS;
    const border = Math.max(1, Math.floor(cell * 0.06));
    const x = col * cell;
    const y = row * cell;
    ctx.fillStyle = color;
    ctx.fillRect(x + border, y + border, Math.max(0, cell - border * 2), Math.max(0, cell - border * 2));
  }
}
