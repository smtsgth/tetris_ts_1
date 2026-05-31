/* eslint-disable */
/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;
(function () {
  const COLS = 10;
  // Lightweight micro-profiler (low overhead when disabled)
  if (!(globalThis as any).__mprof) {
    (globalThis as any).__mprof = {
      enabled: false,
      data: Object.create(null),
      add(name: string, delta: number) {
        if (!(this as any).enabled) return;
        const d = (this as any).data[name] || ((this as any).data[name] = { calls: 0, time: 0 });
        d.calls++;
        d.time += delta;
      },
      reset() {
        (this as any).data = Object.create(null);
      },
      report() {
        return (this as any).data;
      },
    };
  }
  const MPR = (globalThis as any).__mprof as { enabled: boolean; data: any; add: (name: string, delta: number) => void; reset: () => void; report: () => any };
  const MPR_NOW = (typeof (globalThis as any).performance !== 'undefined' && typeof (globalThis as any).performance.now === 'function') ? () => (globalThis as any).performance.now() : () => Date.now();
  const SHAPES: Record<string, number[][]> = {
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

  function rotateCW(m: number[][]): number[][] {
    const n = m.length;
    const res = Array.from({ length: n }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) res[c][n - 1 - r] = m[r][c];
    return res;
  }
  // type aliases for worker internals
  type Cell = null | string | number;
  type BoardArray = Cell[][];
  type Bitboard = Uint16Array;
  type MasksArrEntry = {
    shift: number;
    masks: Uint16Array;
    topRows: Int8Array;
    colAdds?: Uint32Array;
    colAddList?: Uint8Array;
    // runtime cache for shifted colAdds keyed by y; may contain eviction metadata
    // shape at runtime: { map: Record<string, Uint32Array>, keys: string[] }
    colAddsShiftCache?: any;
  };
  type PreRotMap = Record<string, number[][][]>;
  type RotBBoxMap = Record<string, { minC: number; maxC: number }[]>;
  interface Placement {
    x: number;
    rot: number;
    score: number;
    cleared?: number;
    board: Bitboard;
  }

  // Worker message / state types
  type WorkerInMsg = {
    reqId?: string;
    type?: string;
    lookahead?: number;
    state?: unknown;
    weights?: {
      wLines?: number;
      wAgg?: number;
      wHoles?: number;
      wBump?: number;
      holdPenalty?: number;
    };
    params?: {
      cacheMaxSize?: number;
      beamWidthBase?: number;
      perNodeLimit?: number;
      topK?: number;
      timeoutMs?: number;
      adaptive?: boolean;
      fastMode?: boolean;
    };
    fastMode?: boolean;
  };

  interface WorkerState {
    board?: BoardArray;
    current?: { type: string } | null;
    hold?: string | null;
    next?: string[];
  }

  type FirstAction =
    | { type: "place"; x: number; rot: number }
    | { type: "hold"; slot: number }
    | null;
  type NextView = { arr: string[]; pos: number };
  type Node = {
    board: BoardArray | Bitboard;
    current: string | null;
    hold: string | null;
    next: NextView;
    score: number;
    firstAction: FirstAction | null;
  };
  type DepthProfileEntry = {
    depth: number;
    expandedNodes: number;
    placementsConsidered: number;
    nextMapSize: number;
    timeMs: number;
  };
  type PlanNow =
    | { action: "harddrop" }
    | { action: "place"; x: number; rotation: number }
    | { action: "hold"; slot: number };

  // precompute rotations and bounding boxes to reduce per-iteration work
  const PRE_ROTATIONS: PreRotMap = {} as PreRotMap;
  const ROT_BBOX: RotBBoxMap = {} as RotBBoxMap;
  for (const t in SHAPES) {
    const base = SHAPES[t].map((r: number[]) => r.slice());
    const r0 = base;
    const r1 = rotateCW(r0);
    const r2 = rotateCW(r1);
    const r3 = rotateCW(r2);
    PRE_ROTATIONS[t] = [r0, r1, r2, r3];
    ROT_BBOX[t] = PRE_ROTATIONS[t].map((mat: number[][]) => {
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
  // Precompute per-rotation per-shift row masks for bitboard placement checks
  const PRE_ROT_ROW_MASKS: Record<
    string,
    { minX: number; maxX: number; masksArr: MasksArrEntry[] }[]
  > = Object.create(null) as Record<
    string,
    { minX: number; maxX: number; masksArr: MasksArrEntry[] }[]
  >;
  // limit for per-entry colAddsShiftCache (to bound memory usage)
  const COL_ADDS_SHIFT_CACHE_LIMIT = 8;
  for (const t in PRE_ROTATIONS) {
    PRE_ROT_ROW_MASKS[t] = [];
    for (let rot = 0; rot < PRE_ROTATIONS[t].length; rot++) {
      const mat = PRE_ROTATIONS[t][rot];
      const bbox = ROT_BBOX[t][rot];
      const minX = -bbox.minC;
      const maxX = COLS - 1 - bbox.maxC;
      const masksArr: MasksArrEntry[] = [];
      for (let shift = minX; shift <= maxX; shift++) {
        const masks = new Uint16Array(mat.length);
        const topRows = new Int8Array(COLS);
        for (let i = 0; i < COLS; i++) topRows[i] = -1;
        for (let r = 0; r < mat.length; r++) {
          let rowMask = 0;
          for (let c = 0; c < mat[r].length; c++) {
            if (mat[r][c]) {
              const bx = shift + c;
              if (bx >= 0 && bx < COLS) {
                rowMask |= 1 << bx;
                if (topRows[bx] === -1 || topRows[bx] > r) topRows[bx] = r;
              }
            }
          }
          masks[r] = rowMask;
        }
        // precompute per-column relative bit masks for this rotated/shifted entry
        const colAdds = new Uint32Array(COLS);
        for (let rr = 0; rr < mat.length; rr++) {
          for (let cc = 0; cc < mat[rr].length; cc++) {
            if (!mat[rr][cc]) continue;
            const bx = shift + cc;
            if (bx >= 0 && bx < COLS) colAdds[bx] |= 1 << rr;
          }
        }
        const colsListArr: number[] = [];
        for (let c = 0; c < COLS; c++) if (colAdds[c]) colsListArr.push(c);
        const colAddList = new Uint8Array(colsListArr);
        masksArr.push({ shift, masks, topRows, colAdds, colAddList });
      }
      PRE_ROT_ROW_MASKS[t][rot] = { minX, maxX, masksArr };
    }
  }
  // Fast bit helpers for 10-bit row masks: popcount and least-significant-bit index
  const POPCNT = new Uint8Array(1 << COLS);
  const LSB_IDX = new Int8Array(1 << COLS);
  for (let i = 0; i < 1 << COLS; i++) {
    let v = i;
    let cnt = 0;
    while (v) {
      cnt += v & 1;
      v >>>= 1;
    }
    POPCNT[i] = cnt;
    if (i === 0) {
      LSB_IDX[i] = -1;
    } else {
      // index of least-significant set bit
      const lsb = i & -i;
      let idx = 0;
      while (((1 << idx) & lsb) === 0) idx++;
      LSB_IDX[i] = idx;
    }
  }
  // precompute set-bit lists for masks to avoid bit-twiddling loops
  const SET_BITS: Uint8Array[] = new Array(1 << COLS);
  for (let i = 0; i < 1 << COLS; i++) {
    const bits: number[] = [];
    let v = i;
    while (v) {
      const lsb = v & -v;
      const c = LSB_IDX[lsb];
      bits.push(c);
      v &= v - 1;
    }
    SET_BITS[i] = new Uint8Array(bits);
  }
  // 32-bit helpers for column bit operations
  function popcount32(v: number) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v = (v + (v >>> 4)) & 0x0f0f0f0f;
    v = v + (v >>> 8);
    v = v + (v >>> 16);
    return v & 0x3f;
  }
  function trailingZero32(v: number) {
    if (!v) return 32;
    const lsb = v & -v;
    return 31 - Math.clz32(lsb);
  }
  function getRotationMatrix(type: string, rot: number): number[][] {
    const rr = ((rot % 4) + 4) % 4;
    return PRE_ROTATIONS[type][rr];
  }

  // Weight defaults
  let W_LINES = 1000,
    W_AGG = 6,
    W_HOLES = 130,
    W_BUMP = 5,
    HOLD_PENALTY = 20;

  // Bitboard helpers: board represented as Uint16Array of 10-bit row masks (index 0 = top)
  function boardArrayToBitboard(boardArr: BoardArray): Bitboard {
    const rows = (boardArr || []).length;
    const out = new Uint16Array(rows);
    for (let r = 0; r < rows; r++) {
      const row = boardArr![r] || [];
      let mask = 0;
      for (let c = 0; c < COLS; c++) if (row[c]) mask |= 1 << c;
      out[r] = mask;
    }
    return out;
  }
  function cloneBitboard(bb: Bitboard | number[] | undefined): Bitboard {
    if (!bb) return new Uint16Array(0);
    if (bb instanceof Uint16Array) return bb.slice();
    return new Uint16Array(bb as number[]);
  }

  // Compute per-column heights, holes and bump from a mask-array (Uint16Array)
  function computeMetricsFromMasks(
    masks: Uint16Array,
    rows: number,
    dstHeights?: Int16Array,
    dstHoles?: Int16Array,
  ) {
    const heightsOut = dstHeights || new Int16Array(COLS);
    const holesOut = dstHoles || new Int16Array(COLS);
    let agg = 0,
      holes = 0;
    for (let c = 0; c < COLS; c++) {
      let first = rows;
      for (let r = 0; r < rows; r++) {
        if ((((masks[r] || 0) >>> c) & 1) !== 0) {
          first = r;
          break;
        }
      }
      const h = first === rows ? 0 : rows - first;
      heightsOut[c] = h;
      let hc = 0;
      if (first !== rows) {
        for (let r = first + 1; r < rows; r++)
          if ((((masks[r] || 0) >>> c) & 1) === 0) hc++;
      }
      holesOut[c] = hc;
      agg += h;
      holes += hc;
    }
    let bump = 0;
    for (let c = 0; c < COLS - 1; c++)
      bump += Math.abs(heightsOut[c] - heightsOut[c + 1]);
    return { agg, holes, bump, heights: heightsOut, holesArr: holesOut };
  }

  function hashBoard(board: BoardArray | Bitboard | undefined) {
    // fast 32-bit FNV-1a-ish hash; accepts array-of-rows or bitboard
    if (!board) return "0";
    let h = 2166136261 >>> 0;
    const rows = board.length;
    for (let r = 0; r < rows; r++) {
      let mask = 0;
      const row = (board as BoardArray | Bitboard)[r];
      if (typeof row === "number") {
        mask = row >>> 0;
      } else {
        for (let c = 0; c < row.length; c++) if (row[c]) mask |= 1 << c;
      }
      h ^= mask >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
      h ^= 0x9e3779b1;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0).toString(36);
  }

  // Helpers for non-allocating 'next' views (array + offset)
  function makeNext(arr?: string[]): NextView {
    return { arr: arr || [], pos: 0 };
  }
  function nextLen(nv: NextView) {
    return nv.arr.length - nv.pos;
  }
  function nextHead(nv: NextView) {
    return nv.pos < nv.arr.length ? nv.arr[nv.pos] : null;
  }
  function nextAdvance(nv: NextView, delta = 1) {
    return { arr: nv.arr, pos: nv.pos + delta };
  }
  function joinNext(nv: NextView) {
    if (nv.pos >= nv.arr.length) return "";
    let s = nv.arr[nv.pos] || "";
    for (let i = nv.pos + 1; i < nv.arr.length; i++) {
      s += "," + nv.arr[i];
    }
    return s;
  }

  // Simple per-worker array pools to reduce short-lived allocations in hot paths
  const COLFIRST_POOL: Int16Array[] = [];
  const TOP_PLACEMENTS_POOL: Placement[][] = [];
  function allocColFirst(defaultVal: number) {
    const a = COLFIRST_POOL.pop() || new Int16Array(COLS);
    for (let i = 0; i < COLS; i++) a[i] = defaultVal;
    return a;
  }
  function freeColFirst(a: Int16Array) {
    COLFIRST_POOL.push(a);
  }
  function allocTopPlacements(k: number) {
    const a = TOP_PLACEMENTS_POOL.pop() || new Array(k);
    if (a.length < k) a.length = k;
    return a;
  }
  function freeTopPlacements(a: Placement[]) {
    TOP_PLACEMENTS_POOL.push(a);
  }

  const placementCache = new Map<string, Placement[]>(); // boardHash|type -> placements (LRU via reinsert)
  const DEFAULT_PLACEMENT_CACHE_MAX = 8000;
  let PLACEMENT_CACHE_MAX = DEFAULT_PLACEMENT_CACHE_MAX;
  let placementCacheHits = 0,
    placementCacheMisses = 0,
    placementGeneratedCount = 0;
  let placementCacheEvictions = 0,
    placementCacheFallbacks = 0,
    placementCacheMaxObserved = 0;
  let TOP_K = 1; // default to 1 for faster planning

  function getCacheKey(bHash: string, type: string) {
    return bHash + "|" + type;
  }
  function cacheMetricsSnapshot() {
    return {
      placementCacheHits: placementCacheHits,
      placementCacheMisses: placementCacheMisses,
      placementGeneratedCount: placementGeneratedCount,
      placementCacheEvictions: placementCacheEvictions,
      placementCacheFallbacks: placementCacheFallbacks,
      placementCacheSize: placementCache.size,
      placementCacheMaxObserved: placementCacheMaxObserved,
    };
  }

  async function generatePlacementsForType(
    board: BoardArray | Bitboard,
    type: string,
    reqId: string,
    topKOverride?: number,
  ) {
    // normalize board to bitboard (array of row masks)
    let boardBits: Bitboard;
    if (board && board.length && typeof board[0] !== "number")
      boardBits = boardArrayToBitboard(board as BoardArray);
    else boardBits = cloneBitboard(board as Bitboard);
    const bHash = hashBoard(boardBits);
    const topKLocalKey =
      typeof topKOverride === "number"
        ? Math.max(1, Math.floor(topKOverride))
        : TOP_K;
    const key = getCacheKey(bHash, String(type));
    if (placementCache.has(key)) {
      const v = placementCache.get(key)!;
      placementCache.delete(key);
      placementCache.set(key, v);
      placementCacheHits++;
      return v.slice(0, topKLocalKey);
    }
    if (placementCache.size > 0) {
      for (const k of placementCache.keys()) {
        // match legacy keys that may include a trailing topK suffix, or the new key
        if (k.indexOf(bHash + "|" + type) === 0) {
          const v = placementCache.get(k)!;
          placementCache.set(key, v);
          placementCacheFallbacks++;
          placementCacheHits++;
          try {
            placementCache.delete(k);
            placementCache.set(k, v);
          } catch (e) {}
          if (placementCache.size > placementCacheMaxObserved)
            placementCacheMaxObserved = placementCache.size;
          return v.slice(0, topKLocalKey);
        }
      }
    }
    // we'll maintain only the top-K candidates on the fly to avoid full sort
    const topKToUse = topKLocalKey;
    const topPlacements: Placement[] = allocTopPlacements(topKToUse);
    let topCount = 0;
    // local profiler handles (low overhead when disabled)
    const profEnabledLocal = MPR && MPR.enabled;
    const profNowLocal = MPR_NOW;
    const __gp_start = profEnabledLocal ? profNowLocal() : 0;
    let __gp_place_check = 0,
      __gp_drop_calc = 0,
      __gp_drop_adjust_up = 0,
      __gp_drop_adjust_down = 0,
      __gp_apply_build = 0,
      __gp_apply_build_coladds = 0,
      __gp_apply_build_masks = 0,
      __gp_delta_eval = 0,
      __gp_delta_eval_cols = 0,
      __gp_delta_eval_bump = 0,
      __gp_compact_eval = 0,
      __gp_heap = 0,
      __gp_restore = 0;
    // Min-heap helpers (heap root = smallest score) to keep top-K with O(log K)
    function heapSiftUp(heap: Placement[], idx: number) {
      while (idx > 0) {
        const parent = (idx - 1) >> 1;
        if (heap[parent].score <= heap[idx].score) break;
        const t = heap[parent];
        heap[parent] = heap[idx];
        heap[idx] = t;
        idx = parent;
      }
    }
    function heapSiftDown(heap: Placement[], idx: number, size: number) {
      while (true) {
        const left = idx * 2 + 1;
        const right = left + 1;
        let smallest = idx;
        if (left < size && heap[left].score < heap[smallest].score) smallest = left;
        if (right < size && heap[right].score < heap[smallest].score) smallest = right;
        if (smallest === idx) break;
        const t = heap[smallest];
        heap[smallest] = heap[idx];
        heap[idx] = t;
        idx = smallest;
      }
    }
    function heapPush(item: Placement) {
      topPlacements[topCount] = item;
      heapSiftUp(topPlacements, topCount);
      topCount++;
    }
    function heapReplaceRoot(item: Placement) {
      topPlacements[0] = item;
      heapSiftDown(topPlacements, 0, topCount);
    }
    let iterCount = 0;
    let lastYieldTime = 0;
    let placementsConsidered = 0;
    const startY = -4;
    // precompute per-column first-occupied-row to speed up harddrop (top->bottom index)
    const rowsForBoard = boardBits.length;
    const colMaskAll = (1 << COLS) - 1;
    const colFirst = allocColFirst(rowsForBoard);
    for (let r = 0; r < rowsForBoard; r++) {
      let rm = (boardBits[r] || 0) & colMaskAll;
      if (!rm) continue;
      const bits = SET_BITS[rm];
      for (let bi = 0; bi < bits.length; bi++) {
        const c = bits[bi];
        if (colFirst[c] === rowsForBoard) colFirst[c] = r;
      }
    }
    // build per-column bitsets (bit r => row r occupied). Used for fast per-column deltas.
    const colBits = new Uint32Array(COLS);
    for (let r = 0; r < rowsForBoard; r++) {
      const rm = (boardBits[r] || 0) & colMaskAll;
      if (!rm) continue;
      const bits = SET_BITS[rm];
      for (let bi = 0; bi < bits.length; bi++) {
        const c = bits[bi];
        colBits[c] |= 1 << r;
      }
    }

    // precompute per-column heights and hole counts for delta evaluation
    const heights = new Int16Array(COLS);
    const holesArr = new Int16Array(COLS);
    let aggSum = 0,
      holesSum = 0,
      bumpSum = 0;
    for (let c = 0; c < COLS; c++) {
      if (colFirst[c] === rowsForBoard) {
        heights[c] = 0;
        holesArr[c] = 0;
      } else {
        const h = rowsForBoard - colFirst[c];
        heights[c] = h;
        let hc = 0;
        for (let r = colFirst[c] + 1; r < rowsForBoard; r++)
          if (((boardBits[r] || 0) & (1 << c)) === 0) hc++;
        holesArr[c] = hc;
      }
      aggSum += heights[c];
      holesSum += holesArr[c];
    }
    for (let c = 0; c < COLS - 1; c++)
      bumpSum += Math.abs(heights[c] - heights[c + 1]);
    // temporary buffers reused per-candidate to avoid allocations
    const tmpNewHeights = new Int16Array(COLS);
    const tmpNewHoles = new Int16Array(COLS);
    const modifiedFlag = new Uint8Array(COLS);
    // per-candidate column masks (bits per row) to avoid scanning entire board per column
    const tmpColBits = new Uint32Array(COLS);

    // small caches to avoid repeated trailing-zero / popcount on identical bit patterns
    const _tzCache = new Map<number, number>();
    const _popCache = new Map<number, number>();
    const cachedTZ = (v: number) => {
      const g = _tzCache.get(v);
      if (g !== undefined) return g;
      const r = trailingZero32(v);
      _tzCache.set(v, r);
      return r;
    };
    const cachedPop = (v: number) => {
      const g = _popCache.get(v);
      if (g !== undefined) return g;
      const r = popcount32(v);
      _popCache.set(v, r);
      return r;
    };

    // lazily build final compacted board from tmpColBits when a top candidate needs it
    function buildFinalBoardFromTmpColBits(rows: number) {
      const out = new Uint16Array(rows);
      for (let c = 0; c < COLS; c++) {
        let b = tmpColBits[c] || 0;
        while (b) {
          const lsb = b & -b;
          const r = trailingZero32(lsb);
          out[r] |= 1 << c;
          b &= b - 1;
        }
      }
      return out;
    }

    // canPlaceBB and dropYBB inlined into hot loop; definitions removed to simplify code

    function placeAndClearBB(boardB: Bitboard, masks: Uint16Array, y: number) {
      const b = cloneBitboard(boardB as Bitboard);
      const n = b.length;
      // apply masks to affected rows
      for (let r = 0; r < masks.length; r++) {
        const maskRow = masks[r] || 0;
        const by = y + r;
        if (maskRow && by >= 0 && by < n) b[by] |= maskRow;
      }
      const fullMask = (1 << COLS) - 1;
      // fast path: if no affected row becomes full, return early (most placements)
      let anyCleared = false;
      for (let r = 0; r < masks.length; r++) {
        const maskRow = masks[r] || 0;
        const by = y + r;
        if (maskRow && by >= 0 && by < n && b[by] === fullMask) {
          anyCleared = true;
          break;
        }
      }
      if (!anyCleared) return { board: b, cleared: 0 };
      // fallback: compact rows by copying non-full rows from bottom to top (two-pointer)
      const out = new Uint16Array(n);
      let write = n - 1;
      for (let rr = n - 1; rr >= 0; rr--) {
        if (b[rr] !== fullMask) {
          out[write] = b[rr];
          write--;
        }
      }
      for (let i = write; i >= 0; i--) out[i] = 0;
      const cleared = write + 1;
      return { board: out, cleared };
    }

    const fullMask = (1 << COLS) - 1;
    // scratch copy reused across candidates to avoid full-board copies per candidate
    const scratch = boardBits.slice();
    const tmpSavedRows = new Uint16Array(4); // up to 4 rows per piece
    const tmpSavedIdx = new Uint8Array(4);
    let tmpSavedIdxLen = 0;
    for (let rot = 0; rot < 4; rot++) {
      const rotInfo = PRE_ROT_ROW_MASKS[type] && PRE_ROT_ROW_MASKS[type][rot];
      if (!rotInfo) continue;
      const masksArr = rotInfo.masksArr;
      for (let si = 0; si < masksArr.length; si++) {
        if (cancelled) return topPlacements;
        iterCount++;
        if ((iterCount & 127) === 0) {
          const now = Date.now();
          if (now - lastYieldTime > 15) {
            lastYieldTime = now;
            try {
              self.postMessage({
                reqId: reqId,
                type: "progress",
                progress: { piece: type, iterCount: iterCount },
              });
            } catch (e) {}
            await new Promise((r) => setTimeout(r, 0));
          } else {
            try {
              self.postMessage({
                reqId: reqId,
                type: "progress",
                progress: { piece: type, iterCount: iterCount },
              });
            } catch (e) {}
          }
        }
        const entry = masksArr[si];
        const masks = entry.masks;
        // inline canPlaceBB(boardBits, masks, startY) for startY check
        const __t_place_check0 = profEnabledLocal ? profNowLocal() : 0;
        let placeStartOk = true;
        for (let r = 0; r < masks.length; r++) {
          const maskRow = masks[r] || 0;
          const by = startY + r;
          if (maskRow === 0) continue;
          if (by >= rowsForBoard) {
            placeStartOk = false;
            break;
          }
          if (by >= 0 && (boardBits[by] & maskRow) !== 0) {
            placeStartOk = false;
            break;
          }
        }
        if (!placeStartOk) {
          if (profEnabledLocal) __gp_place_check += profNowLocal() - __t_place_check0;
          continue;
        }
        // inline dropYBB(boardBits, masks, startY) (use colFirst precomp)
        const __t_drop0 = profEnabledLocal ? profNowLocal() : 0;
        let allowed = Infinity;
        const topRows = (entry as any).topRows as Int8Array | undefined;
        if (topRows) {
          for (let c = 0; c < COLS; c++) {
            const tr = topRows[c];
            if (tr === -1) continue;
            const a = colFirst[c] - tr - 1;
            if (a < allowed) allowed = a;
          }
        } else {
          for (let r = 0; r < masks.length; r++) {
            const m = masks[r] || 0;
            if (!m) continue;
            const bits = SET_BITS[m];
            for (let bi = 0; bi < bits.length; bi++) {
              const c = bits[bi];
              const a = colFirst[c] - r - 1;
              if (a < allowed) allowed = a;
            }
          }
        }
        const __t_allowed_end = profEnabledLocal ? profNowLocal() : 0;
        let y;
        if (!isFinite(allowed)) {
          y = startY;
          if (profEnabledLocal) __gp_drop_calc += __t_allowed_end - __t_drop0;
        } else {
          const maxY = rowsForBoard - masks.length;
          y = Math.min(allowed, maxY);
          if (y < startY) y = startY;
          if (profEnabledLocal) __gp_drop_calc += __t_allowed_end - __t_drop0;
          // sanity adjustments (inline canPlace checks)
          const __t_adjust_up0 = profEnabledLocal ? profNowLocal() : 0;
          while (true) {
            const yCheck = y + 1;
            let ok = true;
            for (let r = 0; r < masks.length; r++) {
              const maskRow = masks[r] || 0;
              if (!maskRow) continue;
              const by = yCheck + r;
              if (by >= rowsForBoard) {
                ok = false;
                break;
              }
              if (by >= 0 && (boardBits[by] & maskRow) !== 0) {
                ok = false;
                break;
              }
            }
            if (ok) {
              y++;
              continue;
            }
            break;
          }
          if (profEnabledLocal) __gp_drop_adjust_up += profNowLocal() - __t_adjust_up0;
          const __t_adjust_down0 = profEnabledLocal ? profNowLocal() : 0;
          while (true) {
            const yCheck = y;
            let ok = true;
            for (let r = 0; r < masks.length; r++) {
              const maskRow = masks[r] || 0;
              if (!maskRow) continue;
              const by = yCheck + r;
              if (by >= rowsForBoard) {
                ok = false;
                break;
              }
              if (by >= 0 && (boardBits[by] & maskRow) !== 0) {
                ok = false;
                break;
              }
            }
            if (!ok) {
              y--;
              continue;
            }
            break;
          }
          if (profEnabledLocal) __gp_drop_adjust_down += profNowLocal() - __t_adjust_down0;
        }
        // apply masks to scratch, saving original rows to restore later
        const __t_app0 = profEnabledLocal ? profNowLocal() : 0;
        let anyCleared = false;
        const n = scratch.length;
        // save only rows that will be modified to minimize restore work
        tmpSavedIdxLen = 0;
        for (let r = 0; r < masks.length; r++) {
          const by = y + r;
          const maskRow = masks[r] || 0;
          const prev = by >= 0 && by < n ? scratch[by] : 0;
          tmpSavedRows[r] = prev;
          if (maskRow && by >= 0 && by < n) {
            const now = prev | maskRow;
            if (now !== prev) {
              scratch[by] = now;
              tmpSavedIdx[tmpSavedIdxLen++] = r;
            }
            if (now === fullMask) anyCleared = true;
          }
        }
        // build per-column bit additions for this piece (used by both delta and clear paths)
        tmpColBits.fill(0);
        const colAdds = (entry as any).colAdds as Uint32Array | undefined;
        const colAddList = (entry as any).colAddList as Uint8Array | undefined;
        const rowMaskLimit = rowsForBoard >= 32 ? 0xffffffff >>> 0 : ((1 << rowsForBoard) - 1) >>> 0;
        if (colAdds && colAddList && colAddList.length > 0) {
          // cache shifted per-column additions per-entry per-y to avoid recomputing shifts
          let cacheObj = (entry as any).colAddsShiftCache;
          if (!cacheObj || !cacheObj.map) {
            cacheObj = { map: Object.create(null), keys: [] };
            (entry as any).colAddsShiftCache = cacheObj;
          }
          const cacheKey = String(y);
          let cacheForY: Uint32Array | undefined = cacheObj.map[cacheKey];
          if (!cacheForY) {
            const __t_cache0 = profEnabledLocal ? profNowLocal() : 0;
            cacheForY = new Uint32Array(colAddList.length);
            if (y >= 0) {
              for (let ii = 0; ii < colAddList.length; ii++) {
                const c = colAddList[ii];
                const rel = colAdds[c] || 0;
                if (!rel) continue;
                const shifted = (rel << y) >>> 0;
                cacheForY[ii] = shifted & rowMaskLimit;
              }
            } else {
              const rsh = -y;
              for (let ii = 0; ii < colAddList.length; ii++) {
                const c = colAddList[ii];
                const rel = colAdds[c] || 0;
                if (!rel) continue;
                const shifted = (rel >>> rsh) >>> 0;
                cacheForY[ii] = shifted & rowMaskLimit;
              }
            }
            // eviction if exceeding per-entry cache limit
            if (cacheObj.keys.length >= COL_ADDS_SHIFT_CACHE_LIMIT) {
              const oldest = cacheObj.keys.shift();
              if (oldest) delete cacheObj.map[oldest];
            }
            cacheObj.map[cacheKey] = cacheForY;
            cacheObj.keys.push(cacheKey);
            if (profEnabledLocal) __gp_apply_build_coladds += profNowLocal() - __t_cache0;
          }
          for (let ii = 0; ii < colAddList.length; ii++) {
            const c = colAddList[ii];
            const mask = cacheForY[ii];
            if (mask) tmpColBits[c] |= mask;
          }
        } else {
          const __t_app_mask0 = profEnabledLocal ? profNowLocal() : 0;
          for (let rr = 0; rr < masks.length; rr++) {
            const by = y + rr;
            if (by < 0 || by >= rowsForBoard) continue;
            const rowMask = masks[rr] || 0;
            if (!rowMask) continue;
            const bits = SET_BITS[rowMask];
            for (let bi = 0; bi < bits.length; bi++) {
              const c = bits[bi];
              tmpColBits[c] |= 1 << by;
            }
          }
          if (profEnabledLocal) __gp_apply_build_masks += profNowLocal() - __t_app_mask0;
        }
        if (profEnabledLocal) __gp_apply_build += profNowLocal() - __t_app0;
        let score: number;
        let finalBoard: Bitboard | undefined;
        let cleared = 0;
        if (!anyCleared) {
          const __t_delta0 = profEnabledLocal ? profNowLocal() : 0;
          // delta evaluation: update heights/holes only for affected columns
          let colsMask = 0;
          for (let rr = 0; rr < masks.length; rr++) colsMask |= masks[rr] || 0;
          if (!colsMask) {
            score =
              0 * W_LINES -
              aggSum * W_AGG -
              holesSum * W_HOLES -
              bumpSum * W_BUMP;
          } else {
            // quick optimistic upper-bound pruning: if top-K is full and
            // even the optimistic best-case score can't beat heap root, skip
            if (topCount === topKToUse) {
              const colsQuick = SET_BITS[colsMask];
              let onesAddedTotal = 0;
              for (let qi = 0; qi < colsQuick.length; qi++) {
                const cc = colsQuick[qi];
                const v = tmpColBits[cc] || 0;
                if (v) onesAddedTotal += cachedPop(v);
              }
              const optimisticHoles = Math.max(0, holesSum - onesAddedTotal);
              const optimisticScore = 0 * W_LINES - aggSum * W_AGG - optimisticHoles * W_HOLES - 0 * W_BUMP;
              if (optimisticScore <= topPlacements[0].score) {
                if (profEnabledLocal) __gp_delta_eval += profNowLocal() - __t_delta0;
                continue;
              }
            }
              // tmpColBits already built above for this candidate; reuse it here
              let deltaAgg = 0,
                deltaHoles = 0;
              const cols = SET_BITS[colsMask];
              const __t_delta_cols0 = profEnabledLocal ? profNowLocal() : 0;
              for (let ci = 0; ci < cols.length; ci++) {
                const c = cols[ci];
                const oldBits = colBits[c] || 0;
                const addBits = tmpColBits[c] || 0;
                if (!addBits && oldBits === 0) {
                  // nothing
                  continue;
                }
                if (!addBits) {
                  // no addition, skip
                  continue;
                }
                const oldFirst = colFirst[c];
                // case: column was empty
                if (oldFirst >= rowsForBoard) {
                  const addLowest = cachedTZ(addBits);
                  const newFirstIdx = addLowest;
                  const newH = newFirstIdx >= rowsForBoard ? 0 : rowsForBoard - newFirstIdx;
                  const onesAddedBelow = newFirstIdx + 1 < 32 ? cachedPop(addBits >>> (newFirstIdx + 1)) : 0;
                  const newHole = newFirstIdx >= rowsForBoard ? 0 : rowsForBoard - newFirstIdx - 1 - onesAddedBelow;
                  tmpNewHeights[c] = newH;
                  tmpNewHoles[c] = newHole;
                  modifiedFlag[c] = 1;
                  deltaAgg += newH - heights[c];
                  deltaHoles += newHole - holesArr[c];
                  continue;
                }
                const addLowest = cachedTZ(addBits);
                if (addLowest >= oldFirst) {
                  // height unchanged; only holes may decrease (add bits fill zeros below first)
                  const onesAddedBelow = oldFirst + 1 < 32 ? cachedPop(addBits >>> (oldFirst + 1)) : 0;
                  const newHole = holesArr[c] - onesAddedBelow;
                  tmpNewHeights[c] = heights[c];
                  tmpNewHoles[c] = newHole;
                  modifiedFlag[c] = 1;
                  deltaAgg += 0;
                  deltaHoles += newHole - holesArr[c];
                  continue;
                }
                // addLowest < oldFirst -> new first comes from added bits
                const newFirstIdx = addLowest;
                const onesOldBelow = cachedPop(oldBits >>> (newFirstIdx + 1));
                const onesAddedBelow = newFirstIdx + 1 < 32 ? cachedPop(addBits >>> (newFirstIdx + 1)) : 0;
                const onesBelow = onesOldBelow + onesAddedBelow;
                const newH = newFirstIdx >= rowsForBoard ? 0 : rowsForBoard - newFirstIdx;
                const newHole = newFirstIdx >= rowsForBoard ? 0 : rowsForBoard - newFirstIdx - 1 - onesBelow;
                tmpNewHeights[c] = newH;
                tmpNewHoles[c] = newHole;
                modifiedFlag[c] = 1;
                deltaAgg += newH - heights[c];
                deltaHoles += newHole - holesArr[c];
              }
              if (profEnabledLocal) __gp_delta_eval_cols += profNowLocal() - __t_delta_cols0;
            // compute bump delta by checking neighbor boundaries touching modified columns
            const __t_delta_bump0 = profEnabledLocal ? profNowLocal() : 0;
            let deltaBump = 0;
            for (let i = 0; i < COLS - 1; i++) {
              if (!modifiedFlag[i] && !modifiedFlag[i + 1]) continue;
              const h0 = modifiedFlag[i] ? tmpNewHeights[i] : heights[i];
              const h1 = modifiedFlag[i + 1]
                ? tmpNewHeights[i + 1]
                : heights[i + 1];
              deltaBump +=
                Math.abs(h0 - h1) - Math.abs(heights[i] - heights[i + 1]);
            }
            if (profEnabledLocal) __gp_delta_eval_bump += profNowLocal() - __t_delta_bump0;
            score =
              0 * W_LINES -
              (aggSum + deltaAgg) * W_AGG -
              (holesSum + deltaHoles) * W_HOLES -
              (bumpSum + deltaBump) * W_BUMP;
            // clear modified flags and temp arrays for reused buffers (iterate colsMask)
            let m3 = colsMask;
            while (m3) {
              const lsb3 = m3 & -m3;
              const cc = trailingZero32(lsb3);
              modifiedFlag[cc] = 0;
              tmpNewHeights[cc] = 0;
              tmpNewHoles[cc] = 0;
              tmpColBits[cc] = 0;
              m3 ^= lsb3;
            }
          if (profEnabledLocal) __gp_delta_eval += profNowLocal() - __t_delta0;
          }
        } else {
          const __t_comp0 = profEnabledLocal ? profNowLocal() : 0;
          // Compaction: avoid allocating 'out' by compacting per-column bitsets directly
          // Identify cleared rows from scratch
          let clearedMask = 0;
          let clearedCount = 0;
          for (let rr = 0; rr < n; rr++) {
            if (scratch[rr] === fullMask) {
              clearedMask |= 1 << rr;
              clearedCount++;
            }
          }
          cleared = clearedCount;
          // compute new per-column bits by removing cleared rows and shifting upper bits down
          let deltaAgg = 0,
            deltaHoles = 0;
          for (let c = 0; c < COLS; c++) {
            const oldBits = colBits[c] || 0;
            const addBits = tmpColBits[c] || 0;
            const combined = oldBits | addBits;
            if (combined === 0) {
              tmpNewHeights[c] = 0;
              tmpNewHoles[c] = 0;
              deltaAgg += 0 - heights[c];
              deltaHoles += 0 - holesArr[c];
              continue;
            }
            let newBits = 0;
            let dest = n - 1;
            for (let row = n - 1; row >= 0; row--) {
              if (((clearedMask >>> row) & 1) !== 0) continue;
              if (((combined >>> row) & 1) !== 0) newBits |= 1 << dest;
              dest--;
            }
            // store newBits per-column so we can lazily construct final board only when needed
            tmpColBits[c] = newBits;
            const newFirst = trailingZero32(newBits);
            const newH = newFirst >= n ? 0 : n - newFirst;
            const onesBelow =
              newFirst + 1 < 32 ? popcount32(newBits >>> (newFirst + 1)) : 0;
            const newHole = newFirst >= n ? 0 : n - newFirst - 1 - onesBelow;
            tmpNewHeights[c] = newH;
            tmpNewHoles[c] = newHole;
            deltaAgg += newH - heights[c];
            deltaHoles += newHole - holesArr[c];
          }
          // bump delta
          let deltaBump = 0;
          for (let i = 0; i < COLS - 1; i++) {
            const h0 = tmpNewHeights[i] || heights[i];
            const h1 = tmpNewHeights[i + 1] || heights[i + 1];
            deltaBump +=
              Math.abs(h0 - h1) - Math.abs(heights[i] - heights[i + 1]);
          }
          score =
            cleared * W_LINES -
            (aggSum + deltaAgg) * W_AGG -
            (holesSum + deltaHoles) * W_HOLES -
            (bumpSum + deltaBump) * W_BUMP;
          finalBoard = undefined;
          // clear temp buffers used for compaction
          for (let c = 0; c < COLS; c++) {
            tmpColBits[c] = 0;
            tmpNewHeights[c] = 0;
            tmpNewHoles[c] = 0;
            modifiedFlag[c] = 0;
          }
          if (profEnabledLocal) __gp_compact_eval += profNowLocal() - __t_comp0;
        }
        placementsConsidered++;
        const __t_heap0 = profEnabledLocal ? profNowLocal() : 0;
        if (topCount < topKToUse) {
          if (!finalBoard)
            finalBoard = anyCleared
              ? buildFinalBoardFromTmpColBits(n)
              : cloneBitboard(scratch);
          const candidate: Placement = {
            x: entry.shift,
            rot,
            board: finalBoard,
            cleared: cleared || 0,
            score,
          } as Placement;
          heapPush(candidate);
        } else {
          // min-heap root is smallest score; replace if current candidate is better
          if (score > topPlacements[0].score) {
            if (!finalBoard)
              finalBoard = anyCleared
                ? buildFinalBoardFromTmpColBits(n)
                : cloneBitboard(scratch);
            const candidate: Placement = {
              x: entry.shift,
              rot,
              board: finalBoard,
              cleared: cleared || 0,
              score,
            } as Placement;
            heapReplaceRoot(candidate);
          }
        }
        if (profEnabledLocal) __gp_heap += profNowLocal() - __t_heap0;
        // restore only modified rows
        const __t_rest0 = profEnabledLocal ? profNowLocal() : 0;
        for (let ri = 0; ri < tmpSavedIdxLen; ri++) {
          const r = tmpSavedIdx[ri];
          const by = y + r;
          if (by >= 0 && by < scratch.length) scratch[by] = tmpSavedRows[r];
        }
        tmpSavedIdxLen = 0;
        if (profEnabledLocal) __gp_restore += profNowLocal() - __t_rest0;
      }
    }
    // finalize top-K list and cache it
    const topKToUseFinal = topKToUse;
    // sort only the populated prefix
    const topSlice = topPlacements.slice(0, topCount);
    topSlice.sort((a, b) => b.score - a.score);
    const top = topSlice.slice(0, topKToUseFinal);
    // aggregate profiler data for this invocation
    if (profEnabledLocal) {
      try {
        const __t_end = profNowLocal();
        MPR.add("gpf.total", __t_end - __gp_start);
        if (__gp_place_check) MPR.add("gpf.place_check", __gp_place_check);
        if (__gp_drop_calc) MPR.add("gpf.drop_calc", __gp_drop_calc);
        if (__gp_drop_adjust_up) MPR.add("gpf.drop_adjust_up", __gp_drop_adjust_up);
        if (__gp_drop_adjust_down) MPR.add("gpf.drop_adjust_down", __gp_drop_adjust_down);
        if (__gp_apply_build) MPR.add("gpf.apply_build", __gp_apply_build);
        if (__gp_apply_build_coladds) MPR.add("gpf.apply_build_coladds", __gp_apply_build_coladds);
        if (__gp_apply_build_masks) MPR.add("gpf.apply_build_masks", __gp_apply_build_masks);
        if (__gp_delta_eval) MPR.add("gpf.delta_eval", __gp_delta_eval);
        if (__gp_delta_eval_cols) MPR.add("gpf.delta_eval_cols", __gp_delta_eval_cols);
        if (__gp_delta_eval_bump) MPR.add("gpf.delta_eval_bump", __gp_delta_eval_bump);
        if (__gp_compact_eval) MPR.add("gpf.compact_eval", __gp_compact_eval);
        if (__gp_heap) MPR.add("gpf.heap", __gp_heap);
        if (__gp_restore) MPR.add("gpf.restore", __gp_restore);
      } catch (e) {}
    }
    // cache only the top-K candidates to limit memory
    placementCache.set(key, top);
    placementCacheMisses++;
    placementGeneratedCount += placementsConsidered;
    if (placementCache.size > placementCacheMaxObserved)
      placementCacheMaxObserved = placementCache.size;
    if (placementCache.size > PLACEMENT_CACHE_MAX) {
      const it = placementCache.keys();
      const oldest = it.next().value;
      if (typeof oldest !== "undefined") {
        try {
          placementCache.delete(oldest);
          placementCacheEvictions++;
        } catch (e) {}
      }
    }
    // free pooled temporaries
    try {
      freeTopPlacements(topPlacements);
    } catch (e) {}
    try {
      freeColFirst(colFirst);
    } catch (e) {}
    return top;
  }

  let cancelled = false;
  self.onmessage = function (e: MessageEvent<WorkerInMsg>) {
    const msg = e.data || ({} as WorkerInMsg);
    // Profiler control messages (mprof)
    if (msg && (msg as any).type === "mprof") {
      const action = (msg as any).action || "report";
      try {
        if (action === "enable") {
          MPR.enabled = true;
          try {
            self.postMessage({ type: "mprof_ack", status: "enabled" });
          } catch (e) {}
        } else if (action === "disable") {
          MPR.enabled = false;
          try {
            self.postMessage({ type: "mprof_report", data: MPR.report() });
          } catch (e) {}
        } else if (action === "reset") {
          MPR.reset();
          try {
            self.postMessage({ type: "mprof_ack", status: "reset" });
          } catch (e) {}
        } else {
          try {
            self.postMessage({ type: "mprof_report", data: MPR.report() });
          } catch (e) {}
        }
      } catch (e) {}
      return;
    }
    // Microbench mode: run internal hot functions repeatedly and report timings.
    if (msg && msg.type === "microbench") {
      (async () => {
        try {
          const trials = Number((msg as any).trials || 50);
          const piece = (msg as any).piece || "T";
          const topK = typeof (msg as any).topK === "number" ? (msg as any).topK : TOP_K;
          const boardArg = (msg as any).board || [];
          const clearCache = Boolean((msg as any).clearCache);
          if (clearCache) {
            try {
              placementCache.clear();
            } catch (e) {}
          }
          const times: number[] = [];
          const nowFn = (typeof (globalThis as any).performance !== 'undefined' && typeof (globalThis as any).performance.now === 'function') ? () => (globalThis as any).performance.now() : () => Date.now();
          const startAll = nowFn();
          for (let i = 0; i < trials; i++) {
            const t0 = nowFn();
            try {
              await generatePlacementsForType(boardArg as any, piece as string, String((msg as any).reqId || "mb" + i), topK as number);
            } catch (e) {
              // swallow individual errors
            }
            const t1 = nowFn();
            times.push(t1 - t0);
          }
          const endAll = nowFn();
          const sum = times.reduce((a, b) => a + b, 0);
          const out = {
            type: "microbench_result",
            reqId: msg.reqId,
            piece,
            trials,
            times,
            totalMs: endAll - startAll,
            avgMs: times.length ? sum / times.length : 0,
          } as any;
          try {
            self.postMessage(out);
          } catch (e) {}
        } catch (err) {
          try {
            self.postMessage({ type: "microbench_error", reqId: msg.reqId, error: String(err) });
          } catch (e) {}
        }
      })();
      return;
    }
    // support cancel messages
    if (msg && msg.type === "cancel") {
      cancelled = true;
      return;
    }
    cancelled = false;
    const reqId = msg.reqId;
    // send an immediate lightweight heartbeat so the caller can extend timeouts
    try {
      self.postMessage({
        reqId: reqId,
        type: "progress",
        progress: { started: true },
      });
    } catch (e) {}
    const lookahead = typeof msg.lookahead === "number" ? msg.lookahead : 1;
    const s = (msg.state || {}) as WorkerState;
    // accept tunable weights from caller
    try {
      if (msg.weights) {
        const w = msg.weights;
        W_LINES = Number(typeof w.wLines === "number" ? w.wLines : W_LINES);
        W_AGG = Number(typeof w.wAgg === "number" ? w.wAgg : W_AGG);
        W_HOLES = Number(typeof w.wHoles === "number" ? w.wHoles : W_HOLES);
        W_BUMP = Number(typeof w.wBump === "number" ? w.wBump : W_BUMP);
        HOLD_PENALTY = Number(
          typeof w.holdPenalty === "number" ? w.holdPenalty : HOLD_PENALTY,
        );
      }
    } catch (e) {}
    const params = msg.params || ({} as NonNullable<WorkerInMsg["params"]>);
    // allow callers to tune cache max size per-request
    if (
      typeof params.cacheMaxSize !== "undefined" &&
      !isNaN(Number(params.cacheMaxSize))
    ) {
      PLACEMENT_CACHE_MAX = Math.max(
        32,
        Math.floor(Number(params.cacheMaxSize)),
      );
    }
    const beamWidthBaseMsg = Number(params.beamWidthBase) || 1;
    let perNodeLimitMsg = Number(params.perNodeLimit) || 1;
    let topKMsg = typeof params.topK === "number" ? Number(params.topK) : 2;
    // adapt work amount based on provided timeoutMs or fastMode hint
    if (typeof params.timeoutMs === "number") {
      if (params.timeoutMs <= 700) {
        perNodeLimitMsg = Math.min(perNodeLimitMsg, 2);
        topKMsg = Math.min(topKMsg, 2);
      } else if (params.timeoutMs <= 1500) {
        perNodeLimitMsg = Math.min(perNodeLimitMsg, 4);
        topKMsg = Math.min(topKMsg, 3);
      }
    }
    if (params.fastMode) {
      perNodeLimitMsg = Math.min(perNodeLimitMsg, 2);
      topKMsg = Math.min(topKMsg, 2);
    }
    (async function () {
      try {
        const sigObj = {
          next: (s.next || []).slice(0, lookahead),
          hold: s.hold,
          current: s.current,
        };
        const sig = JSON.stringify(sigObj);
        const beamWidthBase = beamWidthBaseMsg;
        const perNodeLimit = perNodeLimitMsg;
        TOP_K = topKMsg;
        const root: Node = {
          board: (s.board || []).map((r: Cell[]) => r.slice()),
          current: s.current ? s.current.type : null,
          hold: s.hold || null,
          next: makeNext(s.next || []),
          score: 0,
          firstAction: null,
        };
        let beam: Node[] = [root];
        const depthProfile: DepthProfileEntry[] = [];
        const startTotal = Date.now();
        for (let depth = 0; depth < lookahead; depth++) {
          if (cancelled) {
            try {
              self.postMessage({
                reqId: reqId,
                cancelled: true,
                profile: Object.assign(
                  { depthProfile: depthProfile.slice() },
                  cacheMetricsSnapshot(),
                  { totalTimeMs: Date.now() - startTotal },
                ),
              });
            } catch (e) {}
            return;
          }
          const nextMap = new Map<string, Node>(); // key -> node (keep best score per key)
          const depthStart = Date.now();
          let expandedNodes = 0,
            placementsConsidered = 0;
          for (const node of beam) {
            if (cancelled) {
              try {
                self.postMessage({
                  reqId: reqId,
                  cancelled: true,
                  profile: Object.assign(
                    { depthProfile: depthProfile.slice() },
                    cacheMetricsSnapshot(),
                    { totalTimeMs: Date.now() - startTotal },
                  ),
                });
              } catch (e) {}
              return;
            }
            if (!node.current) continue;
            expandedNodes++;
            // dynamic per-node/topK adjustments based on depth and remaining budget
            const elapsedSoFarLocal = Date.now() - startTotal;
            const remainingBudgetLocal =
              (typeof params.timeoutMs === "number" ? params.timeoutMs : 1000) -
              elapsedSoFarLocal;
            let perNodeLimitLocal = perNodeLimitMsg;
            let topKLocal = topKMsg;
            if (params.adaptive) {
              const depthFactorLocal = 1 - depth / Math.max(1, lookahead);
              perNodeLimitLocal = Math.max(
                1,
                Math.min(
                  perNodeLimitMsg,
                  Math.ceil(perNodeLimitMsg * (0.25 + 0.75 * depthFactorLocal)),
                ),
              );
              topKLocal = Math.max(
                1,
                Math.min(
                  topKMsg,
                  Math.ceil(topKMsg * (0.25 + 0.75 * depthFactorLocal)),
                ),
              );
              if (remainingBudgetLocal < 500) {
                perNodeLimitLocal = Math.min(perNodeLimitLocal, 1);
                topKLocal = Math.min(topKLocal, 1);
              }
            }
            const curType = node.current;
            if (typeof curType !== "string") continue;
            const placementsAll = await generatePlacementsForType(
              node.board,
              curType as string,
              String(reqId),
              topKLocal,
            );
            const nPlac = Math.min(perNodeLimitLocal, placementsAll.length);
            placementsConsidered += nPlac;
            for (let pi = 0; pi < nPlac; pi++) {
              const p = placementsAll[pi];
              if (cancelled) {
                try {
                  self.postMessage({
                    reqId: reqId,
                    cancelled: true,
                    profile: Object.assign(
                      { depthProfile: depthProfile.slice() },
                      cacheMetricsSnapshot(),
                      { totalTimeMs: Date.now() - startTotal },
                    ),
                  });
                } catch (e) {}
                return;
              }
              const curHead = nextHead(node.next);
              const newNext = nextAdvance(node.next, 1);
              const newCur = curHead as string | null;
              const newKey =
                hashBoard(p.board) +
                "|" +
                (newCur || "null") +
                "|" +
                (node.hold || "null") +
                "|" +
                joinNext(newNext);
              const newScore = node.score + p.score;
              const existing = nextMap.get(newKey) as Node | undefined;
              const nd: Node = {
                board: p.board,
                current: newCur,
                hold: node.hold,
                next: newNext,
                score: newScore,
                firstAction: node.firstAction || {
                  type: "place",
                  x: p.x,
                  rot: p.rot,
                },
              };
              if (!existing || existing.score < nd.score)
                nextMap.set(newKey, nd);
            }
            // try hold
            if (node.hold !== null || nextLen(node.next) > 0) {
              const swappedHold = node.hold === null ? node.current : node.hold;
              const newNextAfterHold =
                node.hold === null
                  ? nextAdvance(node.next, 1)
                  : nextAdvance(node.next, 0);
              const newCurType =
                node.hold === null ? nextHead(node.next) : node.hold;
              if (newCurType) {
                const curType2 = newCurType;
                const placements2All = await generatePlacementsForType(
                  node.board,
                  curType2 as string,
                  String(reqId),
                  topKLocal,
                );
                const nPlac2 = Math.min(
                  perNodeLimitLocal,
                  placements2All.length,
                );
                placementsConsidered += nPlac2;
                for (let pi2 = 0; pi2 < nPlac2; pi2++) {
                  const p = placements2All[pi2];
                  if (cancelled) {
                    try {
                      self.postMessage({
                        reqId: reqId,
                        cancelled: true,
                        profile: Object.assign(
                          { depthProfile: depthProfile.slice() },
                          cacheMetricsSnapshot(),
                          { totalTimeMs: Date.now() - startTotal },
                        ),
                      });
                    } catch (e) {}
                    return;
                  }
                  const headAfter = nextHead(newNextAfterHold);
                  const newKey =
                    hashBoard(p.board) +
                    "|" +
                    (headAfter ? headAfter : "null") +
                    "|" +
                    (swappedHold || "null") +
                    "|" +
                    joinNext(newNextAfterHold);
                  const newScore = node.score + p.score - HOLD_PENALTY; // small penalty for hold
                  const nd2Next = nextAdvance(newNextAfterHold, 1);
                  const nd2: Node = {
                    board: p.board,
                    current: nextHead(newNextAfterHold),
                    hold: swappedHold,
                    next: nd2Next,
                    score: newScore,
                    firstAction: node.firstAction || { type: "hold", slot: 1 },
                  };
                  const existing = nextMap.get(newKey) as Node | undefined;
                  if (!existing || existing.score < nd2.score)
                    nextMap.set(newKey, nd2);
                }
              }
            }
          }
          // build new beam from nextMap values, sorted by score
          const nextArr: Node[] = Array.from(nextMap.values());
          if (nextArr.length === 0) break;
          nextArr.sort((a, b) => b.score - a.score);
          const beamWidth = Math.max(
            1,
            Math.floor(beamWidthBase / (1 + Math.floor(depth / 2))),
          );
          beam = nextArr.slice(0, beamWidth);
          const depthEnd = Date.now();
          depthProfile.push({
            depth,
            expandedNodes,
            placementsConsidered,
            nextMapSize: nextMap.size,
            timeMs: depthEnd - depthStart,
          });
          // send a lightweight progress heartbeat so the caller can extend timeouts
          try {
            self.postMessage({
              reqId: reqId,
              type: "progress",
              progress: {
                depth: depth,
                expandedNodes: expandedNodes,
                placementsConsidered: placementsConsidered,
                nextMapSize: nextMap.size,
                timeMs: depthEnd - depthStart,
              },
            });
          } catch (e) {}
          // also publish an intermediate best-so-far plan so the main thread can use early results
          try {
            const bestNow = (beam && beam.length ? beam[0] : null) || root;
            let _planNow: PlanNow = { action: "harddrop" };
            if (
              bestNow &&
              bestNow.firstAction &&
              bestNow.firstAction.type === "place"
            )
              _planNow = {
                action: "place",
                x: bestNow.firstAction.x,
                rotation: bestNow.firstAction.rot,
              };
            else if (
              bestNow &&
              bestNow.firstAction &&
              bestNow.firstAction.type === "hold"
            )
              _planNow = { action: "hold", slot: 1 };
            try {
              self.postMessage({
                reqId: reqId,
                plan: _planNow,
                score: bestNow ? bestNow.score : 0,
                sig: sig,
                profile: Object.assign(
                  { depthProfile: depthProfile.slice() },
                  cacheMetricsSnapshot(),
                  { totalTimeMs: Date.now() - startTotal },
                ),
                intermediate: true,
              });
            } catch (e) {}
          } catch (e) {}
          // yield to event loop so cancel messages are processed
          await new Promise((r) => setTimeout(r, 0));
        }
        beam.sort((a, b) => b.score - a.score);
        const best = beam[0] || root;
        let plan: PlanNow = { action: "harddrop" };
        if (best.firstAction && best.firstAction.type === "place")
          plan = {
            action: "place",
            x: best.firstAction.x,
            rotation: best.firstAction.rot,
          };
        else if (best.firstAction && best.firstAction.type === "hold")
          plan = { action: "hold", slot: 1 };
        const bestScore = best.score || 0;
        try {
          self.postMessage({
            reqId: reqId,
            plan: plan,
            score: bestScore,
            sig: sig,
            profile: Object.assign(
              { depthProfile: depthProfile.slice() },
              cacheMetricsSnapshot(),
              { totalTimeMs: Date.now() - startTotal },
            ),
          });
        } catch (e) {
          try {
            self.postMessage({ reqId: reqId, error: String(e) });
          } catch (e) {}
        }
      } catch (err) {
        try {
          self.postMessage({ reqId: reqId, error: String(err) });
        } catch (e) {}
      }
    })();
  };
})();

export {};
