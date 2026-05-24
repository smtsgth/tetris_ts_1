(function () {
    const COLS = 10;
    const SHAPES = { I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], J: [[1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], L: [[0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], O: [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], S: [[0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], T: [[0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], Z: [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };
    function rotateCW(m) { const n = m.length; const res = Array.from({ length: n }, () => Array(n).fill(0)); for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
            res[c][n - 1 - r] = m[r][c]; return res; }
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
    // Precompute per-rotation per-shift row masks for bitboard placement checks
    const PRE_ROT_ROW_MASKS = {};
    for (const t in PRE_ROTATIONS) {
        PRE_ROT_ROW_MASKS[t] = [];
        for (let rot = 0; rot < PRE_ROTATIONS[t].length; rot++) {
            const mat = PRE_ROTATIONS[t][rot];
            const bbox = ROT_BBOX[t][rot];
            const minX = -bbox.minC;
            const maxX = COLS - 1 - bbox.maxC;
            const masksArr = [];
            for (let shift = minX; shift <= maxX; shift++) {
                const masks = new Array(mat.length).fill(0);
                for (let r = 0; r < mat.length; r++) {
                    let rowMask = 0;
                    for (let c = 0; c < mat[r].length; c++) {
                        if (mat[r][c]) {
                            const bx = shift + c;
                            if (bx >= 0 && bx < COLS)
                                rowMask |= (1 << bx);
                        }
                    }
                    masks[r] = rowMask;
                }
                masksArr.push({ shift, masks });
            }
            PRE_ROT_ROW_MASKS[t][rot] = { minX, maxX, masksArr };
        }
    }
    // Fast bit helpers for 10-bit row masks: popcount and least-significant-bit index
    const POPCNT = new Uint8Array(1 << COLS);
    const LSB_IDX = new Int8Array(1 << COLS);
    for (let i = 0; i < (1 << COLS); i++) {
        let v = i;
        let cnt = 0;
        while (v) {
            cnt += (v & 1);
            v >>>= 1;
        }
        POPCNT[i] = cnt;
        if (i === 0) {
            LSB_IDX[i] = -1;
        }
        else {
            // index of least-significant set bit
            const lsb = i & -i;
            let idx = 0;
            while (((1 << idx) & lsb) === 0)
                idx++;
            LSB_IDX[i] = idx;
        }
    }
    function getRotationMatrix(type, rot) { const rr = ((rot % 4) + 4) % 4; return PRE_ROTATIONS[type][rr]; }
    function cloneBoard(b) { return b.map((r) => r.slice()); }
    function canPlace(board, mat, x, y) { const rows = board.length; for (let r = 0; r < mat.length; r++) {
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
    } return true; }
    function dropY(board, mat, x, startY) { let y = startY; while (canPlace(board, mat, x, y + 1))
        y++; return y; }
    function placeAndClear(board, mat, x, y, type) { const b = cloneBoard(board); for (let r = 0; r < mat.length; r++)
        for (let c = 0; c < mat[r].length; c++)
            if (mat[r][c]) {
                const bx = x + c, by = y + r;
                if (by >= 0 && by < b.length && bx >= 0 && bx < COLS)
                    b[by][bx] = type;
            } let cleared = 0; for (let rr = b.length - 1; rr >= 0; rr--) {
        if (b[rr].every((cell) => cell)) {
            b.splice(rr, 1);
            b.unshift(Array(COLS).fill(null));
            cleared++;
            rr++;
        }
    } return { board: b, cleared }; }
    let W_LINES = 1000, W_AGG = 6, W_HOLES = 130, W_BUMP = 5, HOLD_PENALTY = 20;
    // Bitboard helpers: board represented as array of 10-bit row masks (index 0 = top)
    function boardArrayToBitboard(boardArr) { return (boardArr || []).map((row) => { let mask = 0; for (let c = 0; c < row.length; c++)
        if (row[c])
            mask |= (1 << c); return mask; }); }
    function cloneBitboard(bb) { return (bb || []).slice(); }
    // Compute per-column heights and total holes in a single pass (rows scanned top->bottom)
    function computeHeightsAndHoles(boardBits) {
        const rows = boardBits.length;
        const firstOcc = new Array(COLS).fill(rows);
        let seenMask = 0;
        let holes = 0;
        const colMaskAll = (1 << COLS) - 1;
        for (let r = 0; r < rows; r++) {
            const rowmask = (boardBits[r] || 0) & colMaskAll;
            // set first-occurrence for newly seen bits
            let m = rowmask & (~seenMask) & colMaskAll;
            while (m) {
                const lsb = m & -m;
                const c = LSB_IDX[lsb];
                if (firstOcc[c] === rows)
                    firstOcc[c] = r;
                m &= m - 1;
            }
            // holes in this row are columns already seen but zero here
            const holesMask = (~rowmask) & seenMask & colMaskAll;
            if (holesMask)
                holes += POPCNT[holesMask];
            seenMask |= rowmask;
        }
        const heights = new Array(COLS);
        for (let c = 0; c < COLS; c++) {
            const fo = firstOcc[c];
            heights[c] = (fo === rows) ? 0 : (rows - fo);
        }
        return { heights, holes };
    }
    function evaluateBitboard(boardBits, linesCleared) {
        const { heights, holes } = computeHeightsAndHoles(boardBits);
        let agg = 0;
        for (let i = 0; i < heights.length; i++)
            agg += heights[i];
        let bump = 0;
        for (let i = 0; i < heights.length - 1; i++) {
            const d = heights[i] - heights[i + 1];
            bump += (d >= 0 ? d : -d);
        }
        return linesCleared * W_LINES - agg * W_AGG - holes * W_HOLES - bump * W_BUMP;
    }
    function hashBoard(board) {
        let h = 2166136261 >>> 0;
        const rows = board ? board.length : 0;
        for (let r = 0; r < rows; r++) {
            let mask = 0;
            const row = board[r];
            if (typeof row === 'number') {
                mask = row >>> 0;
            }
            else {
                for (let c = 0; c < row.length; c++)
                    if (row[c])
                        mask |= (1 << c);
            }
            h ^= (mask >>> 0);
            h = Math.imul(h, 16777619) >>> 0;
            h ^= 0x9e3779b1;
            h = Math.imul(h, 16777619) >>> 0;
        }
        return (h >>> 0).toString(36);
    }
    const placementCache = new Map(); // boardHash|type -> placements (LRU via reinsert)
    const DEFAULT_PLACEMENT_CACHE_MAX = 512;
    let PLACEMENT_CACHE_MAX = DEFAULT_PLACEMENT_CACHE_MAX;
    let placementCacheHits = 0, placementCacheMisses = 0, placementGeneratedCount = 0;
    let placementCacheEvictions = 0, placementCacheFallbacks = 0, placementCacheMaxObserved = 0;
    let TOP_K = 1; // default to 1 for faster planning
    function getCacheKey(bHash, type) { return bHash + '|' + type; }
    function cacheMetricsSnapshot() { return { placementCacheHits: placementCacheHits, placementCacheMisses: placementCacheMisses, placementGeneratedCount: placementGeneratedCount, placementCacheEvictions: placementCacheEvictions, placementCacheFallbacks: placementCacheFallbacks, placementCacheSize: placementCache.size, placementCacheMaxObserved: placementCacheMaxObserved }; }
    // --- Transposition cache (per-worker local + main-thread shared) ---
    const TRANSPO_MAX_DEPTH = 3;
    const TRANSPO_MAX_ENTRIES = 2000;
    const transpositionCache = new Map();
    const SHARED_TRANSPO_TIMEOUT_MS = 40;
    function _lookupSharedTransposition(key){
        return new Promise(resolve => {
            const transpoReqId = 't-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            function _h(ev){
                try{
                    const m = ev.data || {};
                    if(m && m.type === 'transpo-result' && m.transpoReqId === transpoReqId){
                        try{ self.removeEventListener('message', _h); }catch(e){}
                        resolve(m.value || null);
                    }
                }catch(e){}
            }
            try{ self.addEventListener('message', _h); }catch(e){}
            try{ self.postMessage({ reqId: reqId, type: 'transpo-get', transpoReqId: transpoReqId, key: key }); }catch(e){ try{ self.removeEventListener('message', _h); }catch(_){} resolve(null); }
            setTimeout(()=>{ try{ self.removeEventListener('message', _h); }catch(e){} resolve(null); }, SHARED_TRANSPO_TIMEOUT_MS);
        });
    }
    async function transpositionEvaluate(board, currentType, holdVal, nextArr, remDepth){
        if(!currentType || remDepth <= 0) return { score: 0, nextBoard: board, nextCurrent: currentType, nextHold: holdVal, nextNext: (nextArr||[]).slice(), firstAction: null };
        const key = hashBoard(board) + '|' + currentType + '|' + (holdVal||'null') + '|' + (nextArr||[]).join(',') + '|' + remDepth;
        if(transpositionCache.has(key)) return transpositionCache.get(key);
        // try shared cache first
        try{
            const shared = await _lookupSharedTransposition(key);
            if(shared){ try{ transpositionCache.set(key, shared); }catch(e){} return shared; }
        }catch(e){}
        let bestScore = -Infinity;
        let bestResult = { score: 0, nextBoard: board, nextCurrent: null, nextHold: holdVal, nextNext: [], firstAction: null };
        try{
            const placementsAll = await generatePlacementsForType(board, currentType, reqId, 1);
            for(const p of (placementsAll || []).slice(0,1)){
                const newNext = (nextArr||[]).slice();
                const newCur = newNext.length ? newNext.shift() : null;
                let cont = { score: 0 };
                if(remDepth - 1 > 0 && newCur) cont = await transpositionEvaluate(p.board, newCur, holdVal, newNext, remDepth - 1);
                const total = p.score + (cont && typeof cont.score === 'number' ? cont.score : 0);
                if(total > bestScore){ bestScore = total; bestResult = { score: total, nextBoard: p.board, nextCurrent: newCur, nextHold: holdVal, nextNext: newNext, firstAction: { type:'place', x: p.x, rot: p.rot } }; }
            }
            if(holdVal !== null || (nextArr && nextArr.length>0)){
                const swappedHold = holdVal === null ? currentType : holdVal;
                const newCurType = holdVal === null ? (nextArr && nextArr.length ? nextArr[0] : null) : holdVal;
                const newNextAfterHold = holdVal === null ? (nextArr||[]).slice(1) : (nextArr||[]).slice();
                if(newCurType){
                    const placements2All = await generatePlacementsForType(board, newCurType, reqId, 1);
                    for(const p of (placements2All || []).slice(0,1)){
                        const newNextForHold = newNextAfterHold.slice();
                        const newCurAfterHold = newNextForHold.length ? newNextForHold.shift() : null;
                        let cont2 = { score: 0 };
                        if(remDepth - 1 > 0 && newCurAfterHold) cont2 = await transpositionEvaluate(p.board, newCurAfterHold, swappedHold, newNextForHold, remDepth - 1);
                        const total2 = p.score - HOLD_PENALTY + (cont2 && typeof cont2.score === 'number' ? cont2.score : 0);
                        if(total2 > bestScore){ bestScore = total2; bestResult = { score: total2, nextBoard: p.board, nextCurrent: newCurAfterHold, nextHold: swappedHold, nextNext: newNextForHold, firstAction: { type:'hold', slot:1, x: p.x, rot: p.rot } }; }
                    }
                }
            }
        } catch(e){}
        const out = bestResult;
        try { transpositionCache.set(key, out); } catch (e) {}
        try{ self.postMessage({ reqId: reqId, type: 'transpo-set', key: key, value: out }); }catch(e){}
        if(transpositionCache.size > TRANSPO_MAX_ENTRIES){ const it = transpositionCache.keys(); transpositionCache.delete(it.next().value); }
        return out;
    }
    // signal that worker JS has finished initial parsing/initialization
    try {
        self.postMessage({ type: 'worker-ready' });
    }
    catch (e) { }
    async function generatePlacementsForType(board, type, reqId, topKOverride) {
        // normalize board to bitboard (array of row masks)
        let boardBits = board;
        if (board && board.length && typeof board[0] !== 'number')
            boardBits = boardArrayToBitboard(board);
        const bHash = hashBoard(boardBits);
        const topKLocalKey = (typeof topKOverride === 'number') ? Math.max(1, Math.floor(topKOverride)) : TOP_K;
        const key = getCacheKey(bHash, type);
        if (placementCache.has(key)) {
            const v = placementCache.get(key);
            placementCache.delete(key);
            placementCache.set(key, v);
            placementCacheHits++;
            return v.slice(0, topKLocalKey);
        }
        if (placementCache.size > 0) {
            for (const k of placementCache.keys()) {
                // match legacy keys that may include a trailing topK suffix, or the new key
                if (k.indexOf(bHash + '|' + type) === 0) {
                    const v = placementCache.get(k);
                    placementCache.set(key, v);
                    placementCacheFallbacks++;
                    placementCacheHits++;
                    try {
                        placementCache.delete(k);
                        placementCache.set(k, v);
                    }
                    catch (e) { }
                    if (placementCache.size > placementCacheMaxObserved)
                        placementCacheMaxObserved = placementCache.size;
                    return v.slice(0, topKLocalKey);
                }
            }
        }
        const placements = [];
        let iterCount = 0;
        const startY = -4;
        // precompute per-column first-occupied-row to speed up harddrop (top->bottom index)
        const rowsForBoard = boardBits.length;
        const colMaskAll = (1 << COLS) - 1;
        const colFirst = new Array(COLS).fill(rowsForBoard);
        for (let r = 0; r < rowsForBoard; r++) {
            let rm = (boardBits[r] || 0) & colMaskAll;
            while (rm) {
                const lsb = rm & -rm;
                const c = LSB_IDX[lsb];
                if (colFirst[c] === rowsForBoard)
                    colFirst[c] = r;
                rm &= rm - 1;
            }
        }
        function canPlaceBB(boardB, masks, y) {
            const rows = boardB.length;
            for (let r = 0; r < masks.length; r++) {
                const maskRow = masks[r] || 0;
                const by = y + r;
                if (maskRow === 0)
                    continue;
                if (by >= rows)
                    return false;
                if (by >= 0 && (boardB[by] & maskRow) !== 0)
                    return false;
            }
            return true;
        }
        function dropYBB(boardB, masks, startY) {
            // compute maximal y by per-column constraints using colFirst[]
            let allowed = Infinity;
            const rows = boardB.length;
            for (let r = 0; r < masks.length; r++) {
                let m = masks[r] || 0;
                while (m) {
                    const lsb = m & -m;
                    const c = LSB_IDX[lsb];
                    const a = colFirst[c] - r - 1;
                    if (a < allowed)
                        allowed = a;
                    m &= m - 1;
                }
            }
            if (!isFinite(allowed))
                return startY;
            const maxY = rows - masks.length;
            let y = Math.min(allowed, maxY);
            if (y < startY)
                y = startY;
            // sanity adjustments (small number of iterations expected)
            while (canPlaceBB(boardB, masks, y + 1))
                y++;
            while (!canPlaceBB(boardB, masks, y))
                y--;
            return y;
        }
        function placeAndClearBB(boardB, masks, y) {
            const b = cloneBitboard(boardB);
            const n = b.length;
            // apply masks to affected rows
            for (let r = 0; r < masks.length; r++) {
                const maskRow = masks[r] || 0;
                const by = y + r;
                if (maskRow && by >= 0 && by < n)
                    b[by] |= maskRow;
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
            if (!anyCleared)
                return { board: b, cleared: 0 };
            // fallback: compact rows by copying non-full rows from bottom to top (two-pointer)
            const out = new Array(n);
            let write = n - 1;
            for (let rr = n - 1; rr >= 0; rr--) {
                if (b[rr] !== fullMask) {
                    out[write] = b[rr];
                    write--;
                }
            }
            for (let i = write; i >= 0; i--)
                out[i] = 0;
            const cleared = write + 1;
            return { board: out, cleared };
        }
        const topKToUse = (typeof topKOverride === 'number') ? Math.max(1, Math.floor(topKOverride)) : TOP_K;
        const topPlacements = [];
        let placementsGenerated = 0;
        for (let rot = 0; rot < 4; rot++) {
            const rotInfo = PRE_ROT_ROW_MASKS[type] && PRE_ROT_ROW_MASKS[type][rot];
            if (!rotInfo)
                continue;
            const masksArr = rotInfo.masksArr;
            for (let si = 0; si < masksArr.length; si++) {
                if (cancelled)
                    return topPlacements;
                iterCount++;
                if ((iterCount & 127) === 0) {
                    try {
                        self.postMessage({ reqId: reqId, type: 'progress', progress: { piece: type, iterCount: iterCount } });
                    }
                    catch (e) { }
                    await new Promise(r => setTimeout(r, 0));
                }
                const entry = masksArr[si];
                const masks = entry.masks;
                if (!canPlaceBB(boardBits, masks, startY))
                    continue;
                const y = dropYBB(boardBits, masks, startY);
                const res = placeAndClearBB(boardBits, masks, y);
                const score = evaluateBitboard(res.board, res.cleared);
                placementsGenerated++;
                const candidate = { x: entry.shift, rot, board: res.board, cleared: res.cleared, score };
                if (topPlacements.length < topKToUse) {
                    topPlacements.push(candidate);
                }
                else {
                    // replace the minimum-scoring entry if candidate is better
                    let minIdx = 0;
                    for (let i = 1; i < topPlacements.length; i++) if (topPlacements[i].score < topPlacements[minIdx].score) minIdx = i;
                    if (candidate.score > topPlacements[minIdx].score) topPlacements[minIdx] = candidate;
                }
            }
        }
        // sort top placements descending
        topPlacements.sort((a, b) => b.score - a.score);
        const top = topPlacements.slice(0, topKToUse);
        // cache only the top placements (save memory & CPU)
        placementCache.set(key, topPlacements);
        placementCacheMisses++;
        placementGeneratedCount += placementsGenerated;
        if (placementCache.size > placementCacheMaxObserved)
            placementCacheMaxObserved = placementCache.size;
        if (placementCache.size > PLACEMENT_CACHE_MAX) {
            const it = placementCache.keys();
            const oldest = it.next().value;
            try {
                placementCache.delete(oldest);
                placementCacheEvictions++;
            }
            catch (e) { }
        }
        return top;
    }
    let cancelled = false;
    self.onmessage = function (e) {
        const msg = e.data || {};
        // respond to handshake/init probes quickly so main thread can measure init time
        if (msg && (msg.type === 'handshake' || msg.type === 'init-handshake')) {
            try { self.postMessage({ type: 'worker-ready', handshakeId: msg.handshakeId }); } catch (e) { }
            return;
        }
        // support cancel messages
        if (msg && msg.type === 'cancel') {
            cancelled = true;
            return;
        }
        cancelled = false;
        const reqId = msg.reqId;
        // send an immediate lightweight heartbeat so the caller can extend timeouts
        try {
            self.postMessage({ reqId: reqId, type: 'progress', progress: { started: true } });
        }
        catch (e) { }
        const lookahead = (typeof msg.lookahead === 'number') ? msg.lookahead : 1;
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
        // allow callers to tune cache max size per-request
        if (typeof params.cacheMaxSize !== 'undefined' && !isNaN(Number(params.cacheMaxSize))) {
            PLACEMENT_CACHE_MAX = Math.max(32, Math.floor(Number(params.cacheMaxSize)));
        }
        const beamWidthBaseMsg = Number(params.beamWidthBase) || 1;
        let perNodeLimitMsg = Number(params.perNodeLimit) || 1;
        let topKMsg = typeof params.topK === 'number' ? Number(params.topK) : 2;
        // adapt work amount based on provided timeoutMs or fastMode hint
        if (typeof params.timeoutMs === 'number') {
            if (params.timeoutMs <= 700) {
                perNodeLimitMsg = Math.min(perNodeLimitMsg, 2);
                topKMsg = Math.min(topKMsg, 2);
            }
            else if (params.timeoutMs <= 1500) {
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
                const sigObj = { next: (s.next || []).slice(0, lookahead), hold: s.hold, current: s.current };
                const sig = JSON.stringify(sigObj);
                const beamWidthBase = beamWidthBaseMsg;
                const perNodeLimit = perNodeLimitMsg;
                TOP_K = topKMsg;
                const root = { board: (s.board || []).map((r) => r.slice()), current: s.current ? s.current.type : null, hold: s.hold || null, next: (s.next || []).slice(), score: 0, firstAction: null };
                // Fast-path: if caller requested the minimal search (single node, single top), do a greedy placement and return immediately
                try {
                    if (perNodeLimit <= 1 && TOP_K <= 1 && beamWidthBase <= 1 && lookahead <= 1) {
                        const placementsNow = await generatePlacementsForType(root.board, root.current, reqId, 1);
                        const best = (placementsNow && placementsNow.length) ? placementsNow[0] : null;
                        const planNow = best ? { action: 'place', x: best.x, rotation: best.rot } : { action: 'harddrop' };
                        try { self.postMessage({ reqId: reqId, plan: planNow, score: best ? best.score : 0, sig: JSON.stringify({ next: (s.next || []).slice(0, lookahead), hold: s.hold, current: s.current }), profile: Object.assign({ depthProfile: [] }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - Date.now() }) }); } catch (e) { }
                        return;
                    }
                }
                catch (e) { }
                let beam = [root];
                const depthProfile = [];
                const startTotal = Date.now();
                for (let depth = 0; depth < lookahead; depth++) {
                    // if we're nearing the allowed timeout, break out to produce final plan
                    const elapsedSoFar = Date.now() - startTotal;
                    const allowedMs = (typeof params.timeoutMs === 'number') ? params.timeoutMs : 1000;
                    if (elapsedSoFar >= Math.max(0, allowedMs - 25)) {
                        break;
                    }
                    if (cancelled) {
                        try {
                            self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) });
                        }
                        catch (e) { }
                        ;
                        return;
                    }
                    const nextMap = new Map(); // key -> node (keep best score per key)
                    const depthStart = Date.now();
                    let expandedNodes = 0, placementsConsidered = 0;
                    for (const node of beam) {
                        if (cancelled) {
                            try {
                                self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) });
                            }
                            catch (e) { }
                            ;
                            return;
                        }
                        if (!node.current)
                            continue;
                        expandedNodes++;
                        // dynamic per-node/topK adjustments based on depth and remaining budget
                        const elapsedSoFarLocal = Date.now() - startTotal;
                        const remainingBudgetLocal = (typeof params.timeoutMs === 'number' ? params.timeoutMs : 1000) - elapsedSoFarLocal;
                        let perNodeLimitLocal = perNodeLimitMsg;
                        let topKLocal = topKMsg;
                        if (params.adaptive) {
                            const depthFactorLocal = 1 - (depth / Math.max(1, lookahead));
                            perNodeLimitLocal = Math.max(1, Math.min(perNodeLimitMsg, Math.ceil(perNodeLimitMsg * (0.25 + 0.75 * depthFactorLocal))));
                            topKLocal = Math.max(1, Math.min(topKMsg, Math.ceil(topKMsg * (0.25 + 0.75 * depthFactorLocal))));
                            if (remainingBudgetLocal < 500) {
                                perNodeLimitLocal = Math.min(perNodeLimitLocal, 1);
                                topKLocal = Math.min(topKLocal, 1);
                            }
                        }
                        // attempt to reuse transposition results for small remaining depths
                        try{
                            const remainingDepth = Math.max(0, lookahead - depth);
                            const useTranspo = (typeof params.useTransposition !== 'undefined' ? params.useTransposition : true) && (remainingDepth <= TRANSPO_MAX_DEPTH);
                            if(useTranspo){
                                try{
                                    const t = await transpositionEvaluate(node.board, node.current, node.hold, node.next, remainingDepth);
                                    if(t && typeof t.score === 'number' && t.firstAction){
                                        const nd = { board: t.nextBoard, current: t.nextCurrent, hold: t.nextHold, next: t.nextNext, score: node.score + t.score, firstAction: node.firstAction || t.firstAction };
                                        const newKey = hashBoard(nd.board) + '|' + (nd.current || 'null') + '|' + (nd.hold || 'null') + '|' + nd.next.join(',');
                                        const existing = nextMap.get(newKey);
                                        if(!existing || existing.score < nd.score) nextMap.set(newKey, nd);
                                        placementsConsidered += 1;
                                        continue;
                                    }
                                }catch(e){}
                            }
                        }catch(e){}
                        const placementsAll = await generatePlacementsForType(node.board, node.current, reqId, topKLocal);
                        const placements = placementsAll.slice(0, perNodeLimitLocal);
                        placementsConsidered += placements.length;
                        for (const p of placements) {
                            if (cancelled) {
                                try {
                                    self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) });
                                }
                                catch (e) { }
                                ;
                                return;
                            }
                            const newNext = node.next.slice();
                            const newCur = newNext.length ? newNext.shift() : null;
                            const newKey = hashBoard(p.board) + '|' + (newCur || 'null') + '|' + (node.hold || 'null') + '|' + newNext.join(',');
                            const newScore = node.score + p.score;
                            const existing = nextMap.get(newKey);
                            const nd = { board: p.board, current: newCur, hold: node.hold, next: newNext, score: newScore, firstAction: node.firstAction || { type: 'place', x: p.x, rot: p.rot } };
                            if (!existing || existing.score < nd.score)
                                nextMap.set(newKey, nd);
                        }
                        // try hold
                        if (node.hold !== null || (node.next && node.next.length > 0)) {
                            const swappedHold = node.hold === null ? node.current : node.hold;
                            const newCurType = node.hold === null ? (node.next && node.next.length ? node.next[0] : null) : node.hold;
                            const newNextAfterHold = node.hold === null ? node.next.slice(1) : node.next.slice();
                            if (newCurType) {
                                const placements2All = await generatePlacementsForType(node.board, newCurType, reqId, topKLocal);
                                const placements2 = placements2All.slice(0, perNodeLimitLocal);
                                placementsConsidered += placements2.length;
                                for (const p of placements2) {
                                    if (cancelled) {
                                        try {
                                            self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) });
                                        }
                                        catch (e) { }
                                        ;
                                        return;
                                    }
                                    const newKey = hashBoard(p.board) + '|' + (newNextAfterHold.length ? newNextAfterHold[0] : 'null') + '|' + (swappedHold || 'null') + '|' + newNextAfterHold.join(',');
                                    const newScore = node.score + p.score - HOLD_PENALTY; // small penalty for hold
                                    const nd2 = { board: p.board, current: newNextAfterHold.length ? newNextAfterHold.shift() : null, hold: swappedHold, next: newNextAfterHold, score: newScore, firstAction: node.firstAction || { type: 'hold', slot: 1 } };
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
                    const beamWidth = Math.max(1, Math.floor(beamWidthBase / (1 + Math.floor(depth / 2))));
                    beam = nextArr.slice(0, beamWidth);
                    const depthEnd = Date.now();
                    depthProfile.push({ depth, expandedNodes, placementsConsidered, nextMapSize: nextMap.size, timeMs: depthEnd - depthStart });
                    // send a lightweight progress heartbeat so the caller can extend timeouts
                    try {
                        self.postMessage({ reqId: reqId, type: 'progress', progress: { depth: depth, expandedNodes: expandedNodes, placementsConsidered: placementsConsidered, nextMapSize: nextMap.size, timeMs: depthEnd - depthStart } });
                    }
                    catch (e) { }
                    // also publish an intermediate best-so-far plan so the main thread can use early results
                    try {
                        const bestNow = (beam && beam.length ? beam[0] : null) || root;
                        let _planNow = { action: 'harddrop' };
                        if (bestNow && bestNow.firstAction && bestNow.firstAction.type === 'place')
                            _planNow = { action: 'place', x: bestNow.firstAction.x, rotation: bestNow.firstAction.rot };
                        else if (bestNow && bestNow.firstAction && bestNow.firstAction.type === 'hold')
                            _planNow = { action: 'hold', slot: 1 };
                        try {
                            self.postMessage({ reqId: reqId, plan: _planNow, score: bestNow ? bestNow.score : 0, sig: sig, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }), intermediate: true });
                        }
                        catch (e) { }
                    }
                    catch (e) { }
                    // yield to event loop so cancel messages are processed
                    await new Promise(r => setTimeout(r, 0));
                }
                beam.sort((a, b) => b.score - a.score);
                const best = beam[0] || root;
                let plan = { action: 'harddrop' };
                if (best.firstAction && best.firstAction.type === 'place')
                    plan = { action: 'place', x: best.firstAction.x, rotation: best.firstAction.rot };
                else if (best.firstAction && best.firstAction.type === 'hold')
                    plan = { action: 'hold', slot: 1 };
                const bestScore = best.score || 0;
                try {
                    self.postMessage({ reqId: reqId, plan: plan, score: bestScore, sig: sig, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) });
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
    })();
