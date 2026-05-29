/* eslint-disable */
export function aiProbeWorkerMain() {
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
            for (let c = 0; c < n; c++)
                res[c][n - 1 - r] = m[r][c];
        return res;
    }
    // precompute rotations and bounding boxes to reduce per-iteration work
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
            let minC = mat[0].length, maxC = -1;
            for (let rr = 0; rr < mat.length; rr++)
                for (let cc = 0; cc < mat[rr].length; cc++)
                    if (mat[rr][cc]) {
                        if (cc < minC)
                            minC = cc;
                        if (cc > maxC)
                            maxC = cc;
                    }
            return { minC, maxC };
        });
    }
    // bitmask helpers for row-based representation (TypedArray)
    const FULL_MASK = (1 << COLS) - 1;
    const POPCNT = new Uint8Array(1 << COLS);
    for (let i = 0; i < POPCNT.length; i++) {
        let v = i, c = 0;
        while (v) {
            c += v & 1;
            v >>>= 1;
        }
        POPCNT[i] = c;
    }
    // precompute piece masks per rotation: array of integers per row
    const PIECE_MASKS = {};
    for (const t in PRE_ROTATIONS) {
        PIECE_MASKS[t] = PRE_ROTATIONS[t].map((mat) => {
            const arr = new Array(mat.length);
            for (let r = 0; r < mat.length; r++) {
                let m = 0;
                for (let c = 0; c < mat[r].length; c++)
                    if (mat[r][c])
                        m |= 1 << c;
                arr[r] = m;
            }
            return arr;
        });
    }
    function boardToMasks(board) {
        const rows = (board || []).length;
        const res = new Uint16Array(rows);
        for (let r = 0; r < rows; r++) {
            let row = board[r] || [];
            let m = 0;
            for (let c = 0; c < COLS; c++)
                if (row[c])
                    m |= 1 << c;
            res[r] = m;
        }
        return res;
    }
    function canPlaceMask(masks, pieceMasks, x, y) {
        const rows = masks.length;
        for (let r = 0; r < pieceMasks.length; r++) {
            const pm = pieceMasks[r];
            if (!pm)
                continue;
            const by = y + r;
            if (by >= rows)
                return false;
            let shifted = x >= 0 ? pm << x : pm >>> -x;
            if ((shifted & ~FULL_MASK) !== 0)
                return false;
            if (by >= 0) {
                if ((masks[by] & shifted) !== 0)
                    return false;
            }
        }
        return true;
    }
    function dropYMask(masks, pieceMasks, x, startY) {
        let y = startY;
        while (canPlaceMask(masks, pieceMasks, x, y + 1))
            y++;
        return y;
    }
    function compactMasks(masks) {
        const rows = masks.length;
        const out = [];
        for (let r = 0; r < rows; r++) {
            if (masks[r] !== FULL_MASK)
                out.push(masks[r]);
        }
        const cleared = rows - out.length;
        while (out.length < rows)
            out.unshift(0);
        return { masks: out, cleared };
    }
    function evaluateMasks(masks, linesCleared) {
        const rows = masks.length;
        const heights = Array(COLS).fill(0);
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < rows; r++) {
                if (((masks[r] >>> c) & 1) !== 0) {
                    heights[c] = rows - r;
                    break;
                }
            }
        }
        const agg = heights.reduce((a, b) => a + b, 0);
        let holes = 0;
        for (let c = 0; c < COLS; c++) {
            let seen = false;
            for (let r = 0; r < rows; r++) {
                if (((masks[r] >>> c) & 1) !== 0)
                    seen = true;
                else if (seen)
                    holes++;
            }
        }
        const bump = bumpiness(heights);
        return (linesCleared * W_LINES - agg * W_AGG - holes * W_HOLES - bump * W_BUMP);
    }
    // reusable small mask array to reduce short-lived allocations
    const TMP_MASKS = [0, 0, 0, 0];
    function getRotationMatrix(type, rot) {
        const rr = ((rot % 4) + 4) % 4;
        return PRE_ROTATIONS[type][rr];
    }
    function cloneBoard(b) {
        return b.map((r) => r.slice());
    }
    function canPlace(board, mat, x, y) {
        const rows = board.length;
        for (let r = 0; r < mat.length; r++) {
            for (let c = 0; c < mat[r].length; c++) {
                if (!mat[r][c])
                    continue;
                const bx = x + c, by = y + r;
                if (bx < 0 || bx >= COLS)
                    return false;
                if (by >= rows)
                    return false;
                if (by >= 0 && board[by][bx])
                    return false;
            }
        }
        return true;
    }
    function dropY(board, mat, x, startY) {
        let y = startY;
        while (canPlace(board, mat, x, y + 1))
            y++;
        return y;
    }
    function placeAndClear(board, mat, x, y, type) {
        const b = cloneBoard(board);
        for (let r = 0; r < mat.length; r++)
            for (let c = 0; c < mat[r].length; c++)
                if (mat[r][c]) {
                    const bx = x + c, by = y + r;
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
    let W_LINES = 1000, W_AGG = 6, W_HOLES = 130, W_BUMP = 5, HOLD_PENALTY = 20;
    function aggregateHeight(board) {
        const cols = COLS, rows = board.length, heights = Array(cols).fill(0);
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                if (board[r][c]) {
                    heights[c] = rows - r;
                    break;
                }
            }
        }
        return heights;
    }
    function countHoles(board) {
        const rows = board.length;
        let holes = 0;
        for (let c = 0; c < COLS; c++) {
            let seen = false;
            for (let r = 0; r < rows; r++) {
                if (board[r][c])
                    seen = true;
                else if (seen)
                    holes++;
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
    function evaluate(board, linesCleared) {
        const heights = aggregateHeight(board);
        const agg = heights.reduce((a, b) => a + b, 0);
        const holes = countHoles(board);
        const bump = bumpiness(heights);
        return (linesCleared * W_LINES - agg * W_AGG - holes * W_HOLES - bump * W_BUMP);
    }
    // fast top-K selector optimized for small k (avoids full sort)
    function selectTopKByScore(items, k) {
        if (!Array.isArray(items) || k <= 0)
            return [];
        if (items.length <= k) {
            items.sort((a, b) => b.score - a.score);
            return items;
        }
        const top = [];
        let minIdx = -1, minVal = Infinity;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (top.length < k) {
                top.push(it);
                if (it.score < minVal) {
                    minVal = it.score;
                    minIdx = top.length - 1;
                }
            }
            else if (it.score > minVal) {
                top[minIdx] = it;
                // recompute min
                minVal = top[0].score;
                minIdx = 0;
                for (let j = 1; j < top.length; j++) {
                    if (top[j].score < minVal) {
                        minVal = top[j].score;
                        minIdx = j;
                    }
                }
            }
        }
        top.sort((a, b) => b.score - a.score);
        return finalized;
    }
    function hashBoard(board) {
        // fast 32-bit FNV-1a-ish hash
        let h = 2166136261 >>> 0;
        for (let r = 0; r < board.length; r++) {
            const row = board[r];
            for (let c = 0; c < row.length; c++) {
                const v = row[c] ? row[c].charCodeAt(0) : 46; // '.'
                h ^= v;
                h = Math.imul(h, 16777619) >>> 0;
            }
            h ^= 0x9e3779b1;
            h = Math.imul(h, 16777619) >>> 0;
        }
        return (h >>> 0).toString(36);
    }
    // Lightweight NextView helpers to avoid array slicing in hot loops
    function makeNext(arr) {
        return { arr: arr || [], pos: 0 };
    }
    function nextLen(nv) {
        return nv.arr.length - nv.pos;
    }
    function nextHead(nv) {
        return nv.pos < nv.arr.length ? nv.arr[nv.pos] : null;
    }
    function nextAdvance(nv, delta) {
        return { arr: nv.arr, pos: nv.pos + (delta || 1) };
    }
    function joinNext(nv) {
        if (nv.pos >= nv.arr.length)
            return "";
        let s = nv.arr[nv.pos] || "";
        for (let i = nv.pos + 1; i < nv.arr.length; i++) {
            s += "," + nv.arr[i];
        }
        return s;
    }
    // Simple pool for top placements to reduce GC churn
    const TOP_PLACEMENTS_POOL = [];
    function allocTopPlacements(k) {
        const a = TOP_PLACEMENTS_POOL.pop() || new Array(k);
        if (a.length < k)
            a.length = k;
        return a;
    }
    function freeTopPlacements(a) {
        TOP_PLACEMENTS_POOL.push(a);
    }
    const placementCache = new Map(); // boardHash|type -> placements (LRU via reinsert)
    let placementCacheHits = 0, placementCacheMisses = 0, placementGeneratedCount = 0;
    let TOP_K = 1; // default to 1 for faster planning; tunable per-request via params
    async function generatePlacementsForType(board, type, reqId, topKOverride) {
        const bHash = hashBoard(board);
        const topKLocalKey = typeof topKOverride === "number"
            ? Math.max(1, Math.floor(topKOverride))
            : TOP_K;
        const key = bHash + "|" + type + "|" + String(topKLocalKey);
        if (placementCache.has(key)) {
            // LRU: reinsert to mark as recently used
            const v = placementCache.get(key);
            placementCache.delete(key);
            placementCache.set(key, v);
            placementCacheHits++;
            return v;
        }
        let iterCount = 0;
        const topKToUse = topKLocalKey;
        const topPlacements = allocTopPlacements(topKToUse);
        let topCount = 0;
        // masks representation of the board for fast bitwise operations
        const rows = (board || []).length;
        const baseMasks = boardToMasks(board || []);
        const scratchMasks = new Uint16Array(baseMasks); // working copy
        const scratchRowCounts = new Uint8Array(rows);
        for (let rr = 0; rr < rows; rr++)
            scratchRowCounts[rr] = POPCNT[scratchMasks[rr]];
        const affectedRowFlags = new Uint8Array(rows);
        const tmpSavedMasks = []; // pairs: by, prevMask
        const changedRows = []; // list of unique changed rows for current candidate
        for (let rot = 0; rot < 4; rot++) {
            const mat = PRE_ROTATIONS[type][rot];
            const bbox = ROT_BBOX[type][rot];
            const minX = -bbox.minC;
            const maxX = COLS - 1 - bbox.maxC;
            const pieceMasks = PIECE_MASKS[type][rot];
            for (let x = minX; x <= maxX; x++) {
                if (cancelled) {
                    const finalized = topPlacements
                        .slice(0, topCount)
                        .sort((a, b) => b.score - a.score);
                    try {
                        freeTopPlacements(topPlacements);
                    }
                    catch (e) { }
                    placementCache.set(key, finalized);
                    placementCacheMisses++;
                    placementGeneratedCount += finalized.length;
                    return finalized;
                }
                iterCount++;
                // periodically report progress and yield so cancel messages are processed
                if ((iterCount & 127) === 0) {
                    try {
                        self.postMessage({
                            reqId: reqId,
                            type: "progress",
                            progress: { piece: type, iterCount: iterCount },
                        });
                    }
                    catch (e) { }
                    await new Promise((r) => setTimeout(r, 0));
                }
                const startY = -4;
                if (!canPlaceMask(baseMasks, pieceMasks, x, startY))
                    continue;
                const y = dropYMask(baseMasks, pieceMasks, x, startY);
                // apply placement to scratchMasks
                tmpSavedMasks.length = 0;
                changedRows.length = 0;
                for (let r = 0; r < pieceMasks.length; r++) {
                    const pm = pieceMasks[r];
                    if (!pm)
                        continue;
                    const by = y + r;
                    if (by >= 0 && by < rows) {
                        const prev = scratchMasks[by];
                        tmpSavedMasks.push(by, prev);
                        const shifted = x >= 0 ? pm << x : pm >>> -x;
                        scratchMasks[by] = prev | shifted;
                        scratchRowCounts[by] = POPCNT[scratchMasks[by]];
                        if (!affectedRowFlags[by]) {
                            affectedRowFlags[by] = 1;
                            changedRows.push(by);
                        }
                    }
                }
                // detect cleared rows via per-row counts
                let anyCleared = false;
                for (let k = 0; k < changedRows.length; k++) {
                    const rr = changedRows[k];
                    if (scratchRowCounts[rr] === COLS) {
                        anyCleared = true;
                        break;
                    }
                }
                let score;
                let cleared = 0;
                // evaluate using mask-based evaluator; compact when lines cleared
                if (!anyCleared) {
                    score = evaluateMasks(scratchMasks, 0);
                }
                else {
                    const comp = compactMasks(scratchMasks);
                    cleared = comp.cleared;
                    score = evaluateMasks(comp.masks, cleared);
                }
                // candidate selection: only allocate final board for selected candidates (keep allocations minimal)
                if (topCount < topKToUse) {
                    const res = placeAndClear(cloneBoard(board), mat, x, y, type);
                    topPlacements[topCount++] = {
                        x,
                        rot,
                        board: res.board,
                        cleared: res.cleared,
                        score,
                    };
                }
                else {
                    let minIdx = 0;
                    let minVal = topPlacements[0].score;
                    for (let i = 1; i < topCount; i++) {
                        if (topPlacements[i].score < minVal) {
                            minVal = topPlacements[i].score;
                            minIdx = i;
                        }
                    }
                    if (score > minVal) {
                        const res = placeAndClear(cloneBoard(board), mat, x, y, type);
                        topPlacements[minIdx] = {
                            x,
                            rot,
                            board: res.board,
                            cleared: res.cleared,
                            score,
                        };
                    }
                }
                // restore scratchMasks and counts
                for (let si = 0; si < tmpSavedMasks.length; si += 2) {
                    const by = tmpSavedMasks[si], prev = tmpSavedMasks[si + 1];
                    scratchMasks[by] = prev;
                    scratchRowCounts[by] = POPCNT[prev];
                    affectedRowFlags[by] = 0;
                }
                tmpSavedMasks.length = 0;
            }
        }
        const finalized = topPlacements
            .slice(0, topCount)
            .sort((a, b) => b.score - a.score);
        try {
            freeTopPlacements(topPlacements);
        }
        catch (e) { }
        placementCache.set(key, finalized);
        placementCacheMisses++;
        placementGeneratedCount += finalized.length;
        // limit cache size to avoid unbounded growth (evict oldest if large)
        if (placementCache.size > 150) {
            const it = placementCache.keys();
            placementCache.delete(it.next().value);
        }
        return top;
    }
    let cancelled = false;
    self.onmessage = function (e) {
        const msg = e.data || {};
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
        }
        catch (e) { }
        const lookahead = typeof msg.lookahead === "number" ? msg.lookahead : 1;
        const s = msg.state || {};
        // accept tunable weights from caller
        try {
            const w = msg.weights || {};
            W_LINES = Number(w.wLines || W_LINES);
            W_AGG = Number(w.wAgg || W_AGG);
            W_HOLES = Number(w.wHoles || W_HOLES);
            W_BUMP = Number(w.wBump || W_BUMP);
            HOLD_PENALTY = Number(w.holdPenalty || HOLD_PENALTY);
        }
        catch (e) { }
        const params = msg.params || {};
        const beamWidthBaseMsg = Number(params.beamWidthBase) || 1;
        // default to minimal branching by default to prioritize speed
        let perNodeLimitMsg = Number(params.perNodeLimit) || 1;
        let topKMsg = typeof params.topK === "number" ? Number(params.topK) : 1;
        // adapt work amount based on provided timeoutMs or fastMode hint (more aggressive)
        if (typeof params.timeoutMs === "number") {
            if (params.timeoutMs <= 700) {
                perNodeLimitMsg = Math.min(perNodeLimitMsg, 1);
                topKMsg = Math.min(topKMsg, 1);
            }
            else if (params.timeoutMs <= 1500) {
                perNodeLimitMsg = Math.min(perNodeLimitMsg, 2);
                topKMsg = Math.min(topKMsg, 2);
            }
        }
        if (params.fastMode) {
            perNodeLimitMsg = Math.min(perNodeLimitMsg, 1);
            topKMsg = Math.min(topKMsg, 1);
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
                const root = {
                    board: (s.board || []).map((r) => r.slice()),
                    current: s.current ? s.current.type : null,
                    hold: s.hold || null,
                    next: makeNext(s.next || []),
                    score: 0,
                    firstAction: null,
                };
                let beam = [root];
                const depthProfile = [];
                const startTotal = Date.now();
                for (let depth = 0; depth < lookahead; depth++) {
                    if (cancelled) {
                        try {
                            self.postMessage({
                                reqId: reqId,
                                cancelled: true,
                                profile: {
                                    depthProfile: depthProfile.slice(),
                                    placementCacheHits,
                                    placementCacheMisses,
                                    placementGeneratedCount,
                                    totalTimeMs: Date.now() - startTotal,
                                },
                            });
                        }
                        catch (e) { }
                        return;
                    }
                    const nextMap = new Map(); // key -> node (keep best score per key)
                    const depthStart = Date.now();
                    let expandedNodes = 0, placementsConsidered = 0;
                    for (const node of beam) {
                        if (cancelled) {
                            try {
                                self.postMessage({
                                    reqId: reqId,
                                    cancelled: true,
                                    profile: {
                                        depthProfile: depthProfile.slice(),
                                        placementCacheHits,
                                        placementCacheMisses,
                                        placementGeneratedCount,
                                        totalTimeMs: Date.now() - startTotal,
                                    },
                                });
                            }
                            catch (e) { }
                            return;
                        }
                        if (!node.current)
                            continue;
                        expandedNodes++;
                        // dynamic per-node/topK adjustments based on depth and remaining budget
                        const elapsedSoFarLocal = Date.now() - startTotal;
                        const remainingBudgetLocal = (typeof params.timeoutMs === "number" ? params.timeoutMs : 1000) -
                            elapsedSoFarLocal;
                        let perNodeLimitLocal = perNodeLimitMsg;
                        let topKLocal = topKMsg;
                        if (params.adaptive) {
                            const depthFactorLocal = 1 - depth / Math.max(1, lookahead);
                            perNodeLimitLocal = Math.max(1, Math.min(perNodeLimitMsg, Math.ceil(perNodeLimitMsg * (0.25 + 0.75 * depthFactorLocal))));
                            topKLocal = Math.max(1, Math.min(topKMsg, Math.ceil(topKMsg * (0.25 + 0.75 * depthFactorLocal))));
                            if (remainingBudgetLocal < 500) {
                                perNodeLimitLocal = Math.min(perNodeLimitLocal, 1);
                                topKLocal = Math.min(topKLocal, 1);
                            }
                        }
                        const placementsAll = await generatePlacementsForType(node.board, node.current, reqId, topKLocal);
                        const nPlac = Math.min(perNodeLimitLocal, placementsAll.length);
                        placementsConsidered += nPlac;
                        for (let pi = 0; pi < nPlac; pi++) {
                            const p = placementsAll[pi];
                            if (cancelled) {
                                try {
                                    self.postMessage({
                                        reqId: reqId,
                                        cancelled: true,
                                        profile: {
                                            depthProfile: depthProfile.slice(),
                                            placementCacheHits,
                                            placementCacheMisses,
                                            placementGeneratedCount,
                                            totalTimeMs: Date.now() - startTotal,
                                        },
                                    });
                                }
                                catch (e) { }
                                return;
                            }
                            const curHead = nextHead(node.next);
                            const newNext = nextAdvance(node.next, 1);
                            const newCur = curHead;
                            const newKey = hashBoard(p.board) +
                                "|" +
                                (newCur || "null") +
                                "|" +
                                (node.hold || "null") +
                                "|" +
                                joinNext(newNext);
                            const newScore = node.score + p.score;
                            const existing = nextMap.get(newKey);
                            const nd = {
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
                            const newNextAfterHold = node.hold === null
                                ? nextAdvance(node.next, 1)
                                : nextAdvance(node.next, 0);
                            const newCurType = node.hold === null ? nextHead(node.next) : node.hold;
                            if (newCurType) {
                                const placements2All = await generatePlacementsForType(node.board, newCurType, reqId, topKLocal);
                                const nPlac2 = Math.min(perNodeLimitLocal, placements2All.length);
                                placementsConsidered += nPlac2;
                                for (let pi2 = 0; pi2 < nPlac2; pi2++) {
                                    const p = placements2All[pi2];
                                    if (cancelled) {
                                        try {
                                            self.postMessage({
                                                reqId: reqId,
                                                cancelled: true,
                                                profile: {
                                                    depthProfile: depthProfile.slice(),
                                                    placementCacheHits,
                                                    placementCacheMisses,
                                                    placementGeneratedCount,
                                                    totalTimeMs: Date.now() - startTotal,
                                                },
                                            });
                                        }
                                        catch (e) { }
                                        return;
                                    }
                                    const headAfter = nextHead(newNextAfterHold);
                                    const newKey = hashBoard(p.board) +
                                        "|" +
                                        (headAfter ? headAfter : "null") +
                                        "|" +
                                        (swappedHold || "null") +
                                        "|" +
                                        joinNext(newNextAfterHold);
                                    const newScore = node.score + p.score - HOLD_PENALTY; // small penalty for hold
                                    const nd2Next = nextAdvance(newNextAfterHold, 1);
                                    const nd2 = {
                                        board: p.board,
                                        current: nextHead(newNextAfterHold),
                                        hold: swappedHold,
                                        next: nd2Next,
                                        score: newScore,
                                        firstAction: node.firstAction || { type: "hold", slot: 1 },
                                    };
                                    const existing = nextMap.get(newKey);
                                    if (!existing || existing.score < nd2.score)
                                        nextMap.set(newKey, nd2);
                                }
                            }
                        }
                    }
                    // build new beam from nextMap values, sorted by score
                    const nextArr = Array.from(nextMap.values());
                    if (nextArr.length === 0)
                        break;
                    nextArr.sort((a, b) => b.score - a.score);
                    const beamWidth = Math.max(4, Math.floor(beamWidthBase / (1 + Math.floor(depth / 2))));
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
                    }
                    catch (e) { }
                    // also publish an intermediate best-so-far plan so the main thread can use early results
                    try {
                        const bestNow = (beam && beam.length ? beam[0] : null) || root;
                        let _planNow = { action: "harddrop" };
                        if (bestNow &&
                            bestNow.firstAction &&
                            bestNow.firstAction.type === "place")
                            _planNow = {
                                action: "place",
                                x: bestNow.firstAction.x,
                                rotation: bestNow.firstAction.rot,
                            };
                        else if (bestNow &&
                            bestNow.firstAction &&
                            bestNow.firstAction.type === "hold")
                            _planNow = { action: "hold", slot: 1 };
                        try {
                            self.postMessage({
                                reqId: reqId,
                                plan: _planNow,
                                score: bestNow ? bestNow.score : 0,
                                sig: sig,
                                profile: {
                                    depthProfile: depthProfile.slice(),
                                    placementCacheHits,
                                    placementCacheMisses,
                                    placementGeneratedCount,
                                    totalTimeMs: Date.now() - startTotal,
                                },
                                intermediate: true,
                            });
                        }
                        catch (e) { }
                    }
                    catch (e) { }
                    // yield to event loop so cancel messages are processed
                    await new Promise((r) => setTimeout(r, 0));
                }
                beam.sort((a, b) => b.score - a.score);
                const best = beam[0] || root;
                let plan = { action: "harddrop" };
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
                        profile: {
                            depthProfile: depthProfile.slice(),
                            placementCacheHits,
                            placementCacheMisses,
                            placementGeneratedCount,
                            totalTimeMs: Date.now() - startTotal,
                        },
                    });
                }
                catch (e) {
                    try {
                        self.postMessage({ reqId: reqId, error: String(e) });
                    }
                    catch (e) { }
                }
            }
            catch (err) {
                try {
                    self.postMessage({ reqId: reqId, error: String(err) });
                }
                catch (e) { }
            }
        })();
    };
}
