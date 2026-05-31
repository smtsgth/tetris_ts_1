(function () {
  const COLS = 10;
  const SHAPES = {
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
  function rotateCW(m) {
    const n = m.length;
    const res = Array.from({ length: n }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) res[c][n - 1 - r] = m[r][c];
    return res;
  }
  const PRE_ROTATIONS = {};
  const ROT_BBOX = {};
  for (const t in SHAPES) {
    const base = SHAPES[t].map((r) => r.slice());
    const r0 = base;
    const r1 = rotateCW(r0);
    const r2 = rotateCW(r1);
    const r3 = rotateCW(r2);
    PRE_ROTATIONS[t] = [r0, r1, r2, r3];
    ROT_BBOX[t] = PRE_ROTATIONS[t].map((mat) => {
      let minC = mat[0].length,
        maxC = -1;
      for (let rr = 0; rr < mat.length; rr++)
        for (let cc = 0; cc < mat[rr].length; cc++)
          if (mat[rr][cc]) {
            if (cc < minC) minC = cc;
            if (cc > maxC) maxC = cc;
          }
      return { minC, maxC };
    });
  }
  // reusable small mask array to reduce short-lived allocations
  const TMP_MASKS = [0, 0, 0, 0];
  function getRotationMatrix(type, rot) {
    const rr = ((rot % 4) + 4) % 4;
    return PRE_ROTATIONS[type][rr];
  }
  function canPlace(board, mat, x, y) {
    const rows = (board || []).length;
    const isBitRows = rows > 0 && typeof board[0] === "number";
    for (let r = 0; r < mat.length; r++) {
      for (let c = 0; c < mat[r].length; c++) {
        if (!mat[r][c]) continue;
        const bx = x + c,
          by = y + r;
        if (bx < 0 || bx >= COLS) return false;
        if (by >= rows) return false;
        if (by >= 0) {
          if (isBitRows) {
            const mask = 1 << bx;
            if (((board[by] >>> 0) & mask) !== 0) return false;
          } else {
            if (board[by] && board[by][bx]) return false;
          }
        }
      }
    }
    return true;
  }
  function dropY(board, mat, x, startY) {
    let y = startY;
    while (canPlace(board, mat, x, y + 1)) y++;
    return y;
  }
  function placeAndClear(board, mat, x, y, type) {
    const rows = (board || []).length;
    const isBitRows = rows > 0 && typeof board[0] === "number";
    if (isBitRows) {
      const fullMask = (1 << COLS) - 1;
      const b = board.slice();
      for (let r = 0; r < mat.length; r++)
        for (let c = 0; c < mat[r].length; c++)
          if (mat[r][c]) {
            const bx = x + c,
              by = y + r;
            if (by >= 0 && by < b.length && bx >= 0 && bx < COLS) {
              const mask = 1 << bx;
              b[by] = (b[by] >>> 0) | mask;
            }
          }
      let cleared = 0;
      for (let rr = b.length - 1; rr >= 0; rr--) {
        if (b[rr] >>> 0 === fullMask) {
          b.splice(rr, 1);
          b.unshift(0);
          cleared++;
          rr++;
        }
      }
      return { board: b, cleared };
    } else {
      const b = (board || []).map((r) => r.slice());
      for (let r = 0; r < mat.length; r++)
        for (let c = 0; c < mat[r].length; c++)
          if (mat[r][c]) {
            const bx = x + c,
              by = y + r;
            if (by >= 0 && by < b.length && bx >= 0 && bx < COLS)
              b[by][bx] = type;
          }
      let cleared = 0;
      for (let rr = b.length - 1; rr >= 0; rr--) {
        if (b[rr].every((cell) => cell)) {
          b.splice(rr, 1);
          b.unshift(Array(COLS).fill(null));
          cleared++;
          rr++;
        }
      }
      return { board: b, cleared };
    }
  }
  // evaluate cache and bit-row aware helpers
  const evaluateCache = new Map();
  function hashBoard(board) {
    let h = 2166136261 >>> 0;
    for (let r = 0; r < board.length; r++) {
      const row = board[r];
      let bits = 0;
      if (typeof row === "number") {
        bits = row >>> 0;
      } else {
        for (let c = 0; c < row.length; c++) {
          bits = (bits << 1) | (row[c] ? 1 : 0);
        }
      }
      h ^= bits >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= (board.length & 0xffff) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    return (h >>> 0).toString(36);
  }
  function aggregateHeight(board) {
    const cols = COLS,
      rows = (board || []).length,
      heights = Array(cols).fill(0);
    const isBitRows = rows > 0 && typeof board[0] === "number";
    for (let c = 0; c < cols; c++) {
      if (isBitRows) {
        const mask = 1 << c;
        for (let r = 0; r < rows; r++) {
          if (((board[r] >>> 0) & mask) !== 0) {
            heights[c] = rows - r;
            break;
          }
        }
      } else {
        for (let r = 0; r < rows; r++) {
          if (board[r] && board[r][c]) {
            heights[c] = rows - r;
            break;
          }
        }
      }
    }
    return heights;
  }
  function countHoles(board) {
    const rows = (board || []).length;
    let holes = 0;
    const isBitRows = rows > 0 && typeof board[0] === "number";
    for (let c = 0; c < COLS; c++) {
      let seen = false;
      if (isBitRows) {
        const mask = 1 << c;
        for (let r = 0; r < rows; r++) {
          if (((board[r] >>> 0) & mask) !== 0) seen = true;
          else if (seen) holes++;
        }
      } else {
        for (let r = 0; r < rows; r++) {
          if (board[r] && board[r][c]) seen = true;
          else if (seen) holes++;
        }
      }
    }
    return holes;
  }
  function bumpiness(heights) {
    let s = 0;
    for (let i = 0; i < heights.length - 1; i++)
      s += Math.abs(heights[i] - heights[i + 1]);
    return s;
  }
  function evaluate(board, linesCleared, preHash) {
    try {
      const bHash = preHash || hashBoard(board);
      const key = bHash + "|" + (linesCleared || 0);
      if (evaluateCache.has(key)) return evaluateCache.get(key);
      const heights = aggregateHeight(board);
      const agg = heights.reduce((a, b) => a + b, 0);
      const holes = countHoles(board);
      const bump = bumpiness(heights);
      const out = (linesCleared || 0) * 1000 - agg * 6 - holes * 130 - bump * 5;
      try {
        evaluateCache.set(key, out);
      } catch (e) {}
      return out;
    } catch (e) {
      return 0;
    }
  }

  let cancelled = false;
  try {
    self.postMessage({ type: "worker-ready" });
  } catch (e) {}

  self.onmessage = function (e) {
    const msg = e && e.data ? e.data : {};
    if (msg && msg.type === "cancel") {
      cancelled = true;
      return;
    }
    if (msg && (msg.type === "handshake" || msg.type === "init-handshake")) {
      try {
        self.postMessage({
          type: "worker-ready",
          handshakeId: msg.handshakeId,
        });
      } catch (e) {}
      return;
    }
    const reqId = msg.reqId;
    try {
      self.postMessage({
        reqId: reqId,
        type: "progress",
        progress: { started: true },
      });
    } catch (e) {}
    const s = msg.state || {};
    const cur = s.current ? s.current.type : null;
    if (!cur) {
      try {
        self.postMessage({
          reqId: reqId,
          plan: { action: "harddrop" },
          score: 0,
          sig: JSON.stringify({
            next: (s.next || []).slice(0, msg.lookahead || 1),
            hold: s.hold,
            current: cur,
          }),
        });
      } catch (e) {}
      return;
    }
    (async function () {
      try {
        // normalize board to numeric bit-rows if needed
        let boardBits = s.board || [];
        if (boardBits && boardBits.length && typeof boardBits[0] !== "number") {
          const out = new Array(boardBits.length);
          for (let r = 0; r < boardBits.length; r++) {
            const row = boardBits[r] || [];
            let mask = 0;
            for (let c = 0; c < COLS; c++) if (row[c]) mask |= 1 << c;
            out[r] = mask >>> 0;
          }
          boardBits = out;
        }
        const rowsForBoard = boardBits.length;
        const fullMask = (1 << COLS) - 1;
        // precompute per-column first-occupied-row, heights and holes
        const colFirst = new Array(COLS).fill(rowsForBoard);
        for (let c = 0; c < COLS; c++) {
          for (let r = 0; r < rowsForBoard; r++) {
            if (((boardBits[r] >>> 0) & (1 << c)) !== 0) {
              colFirst[c] = r;
              break;
            }
          }
        }
        const heights = new Array(COLS);
        const holeCount = new Array(COLS).fill(0);
        for (let c = 0; c < COLS; c++) {
          heights[c] =
            colFirst[c] === rowsForBoard ? 0 : rowsForBoard - colFirst[c];
          if (colFirst[c] !== rowsForBoard) {
            for (let r = colFirst[c] + 1; r < rowsForBoard; r++)
              if ((((boardBits[r] || 0) >>> 0) & (1 << c)) === 0)
                holeCount[c]++;
          }
        }
        let agg = heights.reduce((a, b) => a + b, 0);
        let bumpSum = 0;
        for (let i = 0; i < COLS - 1; i++)
          bumpSum += Math.abs(heights[i] - heights[i + 1]);
        const totalHoles = holeCount.reduce((a, b) => a + b, 0);

        let best = null;
        for (let rot = 0; rot < 4; rot++) {
          const mat = getRotationMatrix(cur, rot);
          let minC = mat[0].length,
            maxC = -1;
          for (let r = 0; r < mat.length; r++)
            for (let c = 0; c < mat[r].length; c++)
              if (mat[r][c]) {
                if (c < minC) minC = c;
                if (c > maxC) maxC = c;
              }
          const minX = -minC;
          const maxX = COLS - 1 - maxC;
          for (let x = minX; x <= maxX; x++) {
            if (cancelled) return;
            if (!canPlace(boardBits, mat, x, -4)) continue;
            const y = dropY(boardBits, mat, x, -4);

            // build per-row masks for this placement
            const masks = TMP_MASKS;
            masks.length = mat.length;
            for (let _mi = 0; _mi < mat.length; _mi++) masks[_mi] = 0;
            for (let r = 0; r < mat.length; r++) {
              let rowMask = 0;
              for (let c = 0; c < mat[r].length; c++) {
                if (mat[r][c]) {
                  const bx = x + c;
                  if (bx >= 0 && bx < COLS) rowMask |= 1 << bx;
                }
              }
              masks[r] = rowMask >>> 0;
            }

            // quick test: will any affected row become full? if so, fallback to full placeAndClear
            let anyCleared = false;
            for (let r2 = 0; r2 < masks.length; r2++) {
              const by = y + r2;
              const maskRow = masks[r2] || 0;
              if (
                maskRow &&
                by >= 0 &&
                by < rowsForBoard &&
                (((boardBits[by] || 0) >>> 0) | maskRow) >>> 0 === fullMask
              ) {
                anyCleared = true;
                break;
              }
            }

            if (anyCleared) {
              const res = placeAndClear(boardBits, mat, x, y, cur);
              const boardHash = hashBoard(res.board);
              const score = evaluate(res.board, res.cleared, boardHash);
              if (!best || score > best.score)
                best = { x, rot, score, cleared: res.cleared };
              continue;
            }

            // incremental update: no clears
            const newBoard = boardBits.slice();
            for (let r2 = 0; r2 < masks.length; r2++) {
              const by = y + r2;
              if (by >= 0 && by < rowsForBoard)
                newBoard[by] =
                  (((newBoard[by] || 0) >>> 0) | (masks[r2] || 0)) >>> 0;
            }

            // affected columns
            const affectedColsSet = new Set();
            for (let r2 = 0; r2 < masks.length; r2++) {
              const by = y + r2;
              if (by < 0 || by >= rowsForBoard) continue;
              let m = masks[r2] || 0;
              while (m) {
                const lsb = m & -m;
                let c = 0;
                let t = lsb;
                while (((1 << c) & lsb) === 0) c++;
                affectedColsSet.add(c);
                m &= m - 1;
              }
            }
            const affectedCols = Array.from(affectedColsSet);

            const newColFirst = colFirst.slice();
            const newHeights = heights.slice();
            let newAgg = agg;
            for (const c of affectedCols) {
              let minBy = newColFirst[c];
              for (let r2 = 0; r2 < masks.length; r2++) {
                const by = y + r2;
                if (by < 0 || by >= rowsForBoard) continue;
                if (((masks[r2] || 0) & (1 << c)) !== 0) {
                  if (by < minBy) minBy = by;
                }
              }
              if (minBy < newColFirst[c]) {
                const oldH = newHeights[c];
                newColFirst[c] = minBy;
                const newH =
                  newColFirst[c] === rowsForBoard
                    ? 0
                    : rowsForBoard - newColFirst[c];
                newHeights[c] = newH;
                newAgg += newH - oldH;
              }
            }

            let newTotalHoles = totalHoles;
            for (const c of affectedCols) {
              const oldHole = holeCount[c] || 0;
              let newHole = 0;
              const startR =
                newColFirst[c] === rowsForBoard
                  ? rowsForBoard
                  : newColFirst[c] + 1;
              for (let r = startR; r < rowsForBoard; r++) {
                const maskRow =
                  r >= y && r < y + masks.length ? masks[r - y] || 0 : 0;
                if (((((boardBits[r] || 0) >>> 0) | maskRow) & (1 << c)) === 0)
                  newHole++;
              }
              newTotalHoles += newHole - oldHole;
            }

            let newBump = bumpSum;
            const pairs = new Set();
            for (const c of affectedCols) {
              if (c > 0) pairs.add(c - 1 + "," + c);
              if (c < COLS - 1) pairs.add(c + "," + (c + 1));
            }
            for (const p of pairs) {
              const [a, b] = p.split(",").map(Number);
              const oldDiff = Math.abs(heights[a] - heights[b]);
              const newDiff = Math.abs(newHeights[a] - newHeights[b]);
              newBump += newDiff - oldDiff;
            }

            const score =
              0 * 1000 - newAgg * 6 - newTotalHoles * 130 - newBump * 5;
            if (!best || score > best.score)
              best = { x, rot, score, cleared: 0, board: newBoard };
          }
        }
        const plan = best
          ? { action: "place", x: best.x, rotation: best.rot }
          : { action: "harddrop" };
        try {
          self.postMessage({
            reqId: reqId,
            plan: plan,
            score: best ? best.score : 0,
            sig: JSON.stringify({
              next: (s.next || []).slice(0, msg.lookahead || 1),
              hold: s.hold,
              current: cur,
            }),
          });
        } catch (e) {}
      } catch (e) {
        try {
          self.postMessage({ reqId: reqId, error: String(e) });
        } catch (e) {}
      }
    })();
  };
})();
