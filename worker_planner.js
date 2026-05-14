(function(){
                // worker-boot removed to avoid injecting runtime reqId into the worker source
        const COLS = 10;
        const SHAPES = { I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], J:[[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]], L:[[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]], O:[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]], S:[[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]], T:[[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]], Z:[[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]] };

        function rotateCW(m){ const n=m.length; const res=Array.from({length:n},()=>Array(n).fill(0)); for(let r=0;r<n;r++) for(let c=0;c<n;c++) res[c][n-1-r]=m[r][c]; return res; }
        // precompute rotations and bounding boxes to reduce per-iteration work
        const PRE_ROTATIONS = {};
        const ROT_BBOX = {};
        for(const t in SHAPES){
          const base = SHAPES[t].map(r=>r.slice());
          const r0 = base;
          const r1 = rotateCW(r0);
          const r2 = rotateCW(r1);
          const r3 = rotateCW(r2);
          PRE_ROTATIONS[t] = [r0, r1, r2, r3];
          ROT_BBOX[t] = PRE_ROTATIONS[t].map(mat => {
            let minC = mat[0].length, maxC = -1;
            for(let rr=0; rr<mat.length; rr++) for(let cc=0; cc<mat[rr].length; cc++) if(mat[rr][cc]){ if(cc<minC) minC=cc; if(cc>maxC) maxC=cc; }
            return { minC, maxC };
          });
        }
        function getRotationMatrix(type, rot){ const rr = ((rot%4)+4)%4; return PRE_ROTATIONS[type][rr]; }
        function cloneBoard(b){ return b.map(r=>r.slice()); }

        function canPlace(board, mat, x, y){ const rows=board.length; for(let r=0;r<mat.length;r++){ for(let c=0;c<mat[r].length;c++){ if(!mat[r][c]) continue; const bx=x+c, by=y+r; if(bx<0||bx>=COLS) return false; if(by>=rows) return false; if(by>=0 && board[by][bx]) return false; } } return true; }
        function dropY(board, mat, x, startY){ let y=startY; while(canPlace(board, mat, x, y+1)) y++; return y; }
        function placeAndClear(board, mat, x, y, type){ const b=cloneBoard(board); for(let r=0;r<mat.length;r++) for(let c=0;c<mat[r].length;c++) if(mat[r][c]){ const bx=x+c, by=y+r; if(by>=0&&by<b.length&&bx>=0&&bx<COLS) b[by][bx]=type; } let cleared=0; for(let rr=b.length-1; rr>=0; rr--){ if(b[rr].every(cell=>cell)){ b.splice(rr,1); b.unshift(Array(COLS).fill(null)); cleared++; rr++; } } return { board: b, cleared }; }

        let W_LINES = 1000, W_AGG = 6, W_HOLES = 130, W_BUMP = 5, HOLD_PENALTY = 320;
        function aggregateHeight(board){ const cols=COLS, rows=board.length, heights=Array(cols).fill(0); for(let c=0;c<cols;c++){ for(let r=0;r<rows;r++){ if(board[r][c]){ heights[c]=rows-r; break; } } } return heights; }
        function countHoles(board){ const rows=board.length; let holes=0; for(let c=0;c<COLS;c++){ let seen=false; for(let r=0;r<rows;r++){ if(board[r][c]) seen=true; else if(seen) holes++; } } return holes; }
        function bumpiness(heights){ let s=0; for(let i=0;i<heights.length-1;i++) s+=Math.abs(heights[i]-heights[i+1]); return s; }
        function evaluate(board, linesCleared){ const heights=aggregateHeight(board); const agg=heights.reduce((a,b)=>a+b,0); const holes=countHoles(board); const bump=bumpiness(heights); return linesCleared*W_LINES - agg*W_AGG - holes*W_HOLES - bump*W_BUMP; }
(function () {
    const COLS = 10;
    const SHAPES = { I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], J: [[1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], L: [[0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], O: [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], S: [[0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], T: [[0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]], Z: [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };

    function rotateCW(m) { const n = m.length; const res = Array.from({ length: n }, () => Array(n).fill(0)); for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) res[c][n - 1 - r] = m[r][c]; return res; }
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
            for (let rr = 0; rr < mat.length; rr++) for (let cc = 0; cc < mat[rr].length; cc++) if (mat[rr][cc]) { if (cc < minC) minC = cc; if (cc > maxC) maxC = cc; }
            return { minC, maxC };
        });
    }
    function getRotationMatrix(type, rot) { const rr = ((rot % 4) + 4) % 4; return PRE_ROTATIONS[type][rr]; }
    function cloneBoard(b) { return b.map((r) => r.slice()); }

    function canPlace(board, mat, x, y) { const rows = board.length; for (let r = 0; r < mat.length; r++) { for (let c = 0; c < mat[r].length; c++) { if (!mat[r][c]) continue; const bx = x + c, by = y + r; if (bx < 0 || bx >= COLS) return false; if (by >= rows) return false; if (by >= 0 && board[by][bx]) return false; } } return true; }
    function dropY(board, mat, x, startY) { let y = startY; while (canPlace(board, mat, x, y + 1)) y++; return y; }
    function placeAndClear(board, mat, x, y, type) { const b = cloneBoard(board); for (let r = 0; r < mat.length; r++) for (let c = 0; c < mat[r].length; c++) if (mat[r][c]) { const bx = x + c, by = y + r; if (by >= 0 && by < b.length && bx >= 0 && bx < COLS) b[by][bx] = type; } let cleared = 0; for (let rr = b.length - 1; rr >= 0; rr--) { if (b[rr].every((cell) => cell)) { b.splice(rr, 1); b.unshift(Array(COLS).fill(null)); cleared++; rr++; } } return { board: b, cleared }; }

    let W_LINES = 1000, W_AGG = 6, W_HOLES = 130, W_BUMP = 5, HOLD_PENALTY = 20;
    function aggregateHeight(board) { const cols = COLS, rows = board.length, heights = Array(cols).fill(0); for (let c = 0; c < cols; c++) { for (let r = 0; r < rows; r++) { if (board[r][c]) { heights[c] = rows - r; break; } } } return heights; }
    function countHoles(board) { const rows = board.length; let holes = 0; for (let c = 0; c < COLS; c++) { let seen = false; for (let r = 0; r < rows; r++) { if (board[r][c]) seen = true; else if (seen) holes++; } } return holes; }
    function bumpiness(heights) { let s = 0; for (let i = 0; i < heights.length - 1; i++) s += Math.abs(heights[i] - heights[i + 1]); return s; }
    function evaluate(board, linesCleared) { const heights = aggregateHeight(board); const agg = heights.reduce((a, b) => a + b, 0); const holes = countHoles(board); const bump = bumpiness(heights); return linesCleared * W_LINES - agg * W_AGG - holes * W_HOLES - bump * W_BUMP; }

    function hashBoard(board) {
        // Use a per-row bitmask (10 columns) and mix 32-bit masks into FNV-like hash.
        let h = 2166136261 >>> 0;
        for (let r = 0; r < board.length; r++) {
            const row = board[r];
            let mask = 0;
            for (let c = 0; c < row.length; c++) if (row[c]) mask |= (1 << c);
            h ^= (mask >>> 0);
            h = Math.imul(h, 16777619) >>> 0;
            h ^= 0x9e3779b1;
            h = Math.imul(h, 16777619) >>> 0;
        }
        return (h >>> 0).toString(36);
    }

    const placementCache = new Map(); // boardHash|type -> placements (LRU via reinsert)
    const DEFAULT_PLACEMENT_CACHE_MAX = 2000;
    let PLACEMENT_CACHE_MAX = DEFAULT_PLACEMENT_CACHE_MAX;
    let placementCacheHits = 0, placementCacheMisses = 0, placementGeneratedCount = 0;
    let placementCacheEvictions = 0, placementCacheFallbacks = 0, placementCacheMaxObserved = 0;
    let TOP_K = 1; // profiling default

    function getCacheKey(bHash, type/*, topK*/) { return bHash + '|' + type; }
    function cacheMetricsSnapshot() { return { placementCacheHits: placementCacheHits, placementCacheMisses: placementCacheMisses, placementGeneratedCount: placementGeneratedCount, placementCacheEvictions: placementCacheEvictions, placementCacheFallbacks: placementCacheFallbacks, placementCacheSize: placementCache.size, placementCacheMaxObserved: placementCacheMaxObserved }; }

    async function generatePlacementsForType(board, type, reqId, topKOverride) {
        const bHash = hashBoard(board);
        const topKLocalKey = (typeof topKOverride === 'number') ? Math.max(1, Math.floor(topKOverride)) : TOP_K;
        const key = getCacheKey(bHash, type, topKLocalKey);
        if (placementCache.has(key)) {
            // LRU: reinsert to mark as recently used
            const v = placementCache.get(key);
            placementCache.delete(key);
            placementCache.set(key, v);
            placementCacheHits++;
            return v;
        }
        // fallback: try to find any cached entry for same board+type (ignoring topK variance)
        if (placementCache.size > 0) {
            for (const k of placementCache.keys()) {
                if (k.indexOf(bHash + '|' + type + '|') === 0 || k === (bHash + '|' + type)) {
                    const v = placementCache.get(k);
                    // reinsert under requested key so future lookups hit directly
                    placementCache.set(key, v);
                    // mark fallback use and treat as a logical hit
                    placementCacheFallbacks++;
                    placementCacheHits++;
                    // also reinsert the original cached key to refresh LRU order
                    try { placementCache.delete(k); placementCache.set(k, v); } catch (e) { }
                    if (placementCache.size > placementCacheMaxObserved) placementCacheMaxObserved = placementCache.size;
                    return v;
                }
            }
        }
        const placements = [];
        let iterCount = 0;
        for (let rot = 0; rot < 4; rot++) {
            const mat = PRE_ROTATIONS[type][rot];
            const bbox = ROT_BBOX[type][rot];
            const minX = -bbox.minC; const maxX = COLS - 1 - bbox.maxC;
            for (let x = minX; x <= maxX; x++) {
                if (cancelled) return placements; // abort early if cancel requested
                iterCount++;
                // periodically report progress and yield so cancel messages are processed
                if ((iterCount & 31) === 0) { try { self.postMessage({ reqId: reqId, type: 'progress', progress: { piece: type, iterCount: iterCount } }); } catch (e) { } await new Promise(r => setTimeout(r, 0)); }
                const startY = -4;
                if (!canPlace(board, mat, x, startY)) continue;
                const y = dropY(board, mat, x, startY);
                const res = placeAndClear(board, mat, x, y, type);
                const score = evaluate(res.board, res.cleared);
                placements.push({ x, rot, board: res.board, cleared: res.cleared, score });
            }
        }
        // keep top placements per piece to reduce branching (tighter cutoff to speed search)
        placements.sort((a, b) => b.score - a.score);
        const topKToUse = (typeof topKOverride === 'number') ? Math.max(1, Math.floor(topKOverride)) : TOP_K;
        const top = placements.slice(0, topKToUse);
        placementCache.set(key, top);
        placementCacheMisses++;
        // record how many placements were generated before slicing
        placementGeneratedCount += placements.length;
        if (placementCache.size > placementCacheMaxObserved) placementCacheMaxObserved = placementCache.size;
        // limit cache size to avoid unbounded growth (evict oldest if large)
        if (placementCache.size > PLACEMENT_CACHE_MAX) { const it = placementCache.keys(); const oldest = it.next().value; try { placementCache.delete(oldest); placementCacheEvictions++; } catch (e) { } }
        return top;
    }

    let cancelled = false;
    self.onmessage = function (e) {
        const msg = e.data || {};
        // support cancel messages
        if (msg && msg.type === 'cancel') { cancelled = true; return; }
        cancelled = false;
        const reqId = msg.reqId;
        // send an immediate lightweight heartbeat so the caller can extend timeouts
        try { self.postMessage({ reqId: reqId, type: 'progress', progress: { started: true } }); } catch (e) { }
        const lookahead = (typeof msg.lookahead === 'number') ? msg.lookahead : 1;
        const s = msg.state || {};
        // accept tunable weights from caller
        try { const w = msg.weights || {}; W_LINES = Number(w.wLines || W_LINES); W_AGG = Number(w.wAgg || W_AGG); W_HOLES = Number(w.wHoles || W_HOLES); W_BUMP = Number(w.wBump || W_BUMP); HOLD_PENALTY = Number(w.holdPenalty || HOLD_PENALTY); } catch (e) { }
        const params = msg.params || {};
        // allow callers to tune cache max size per-request
        if (typeof params.cacheMaxSize !== 'undefined' && !isNaN(Number(params.cacheMaxSize))) { PLACEMENT_CACHE_MAX = Math.max(32, Math.floor(Number(params.cacheMaxSize))); }
        const beamWidthBaseMsg = Number(params.beamWidthBase) || 3;
        let perNodeLimitMsg = Number(params.perNodeLimit) || 2;
        let topKMsg = typeof params.topK === 'number' ? Number(params.topK) : 1;
        // adapt work amount based on provided timeoutMs or fastMode hint
        if (typeof params.timeoutMs === 'number') { if (params.timeoutMs <= 700) { perNodeLimitMsg = Math.min(perNodeLimitMsg, 2); topKMsg = Math.min(topKMsg, 2); } else if (params.timeoutMs <= 1500) { perNodeLimitMsg = Math.min(perNodeLimitMsg, 4); topKMsg = Math.min(topKMsg, 3); } }
        if (params.fastMode) { perNodeLimitMsg = Math.min(perNodeLimitMsg, 2); topKMsg = Math.min(topKMsg, 2); }
        (async function () {
            try {
                const sigObj = { next: (s.next || []).slice(0, lookahead), hold: s.hold, current: s.current };
                const sig = JSON.stringify(sigObj);
                const beamWidthBase = beamWidthBaseMsg;
                const perNodeLimit = perNodeLimitMsg;
                TOP_K = topKMsg;
                const root = { board: (s.board || []).map((r) => r.slice()), current: s.current ? s.current.type : null, hold: s.hold || null, next: (s.next || []).slice(), score: 0, firstAction: null };
                let beam = [root];
                const depthProfile = [];
                const startTotal = Date.now();
                for (let depth = 0; depth < lookahead; depth++) {
                    if (cancelled) { try { self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); } catch (e) { } ; return; }
                    const nextMap = new Map(); // key -> node (keep best score per key)
                    const depthStart = Date.now();
                    let expandedNodes = 0, placementsConsidered = 0;
                    for (const node of beam) {
                        if (cancelled) { try { self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); } catch (e) { } ; return; }
                        if (!node.current) continue;
                        expandedNodes++;
                        // dynamic per-node/topK adjustments based on depth and remaining budget
                        const elapsedSoFarLocal = Date.now() - startTotal;
                        const remainingBudgetLocal = (typeof params.timeoutMs === 'number' ? params.timeoutMs : 1000) - elapsedSoFarLocal;
                        let perNodeLimitLocal = perNodeLimitMsg;
                        let topKLocal = topKMsg;
                        if (params.adaptive) { const depthFactorLocal = 1 - (depth / Math.max(1, lookahead)); perNodeLimitLocal = Math.max(1, Math.min(perNodeLimitMsg, Math.ceil(perNodeLimitMsg * (0.25 + 0.75 * depthFactorLocal)))); topKLocal = Math.max(1, Math.min(topKMsg, Math.ceil(topKMsg * (0.25 + 0.75 * depthFactorLocal)))); if (remainingBudgetLocal < 500) { perNodeLimitLocal = Math.min(perNodeLimitLocal, 1); topKLocal = Math.min(topKLocal, 1); } }
                        const placementsAll = await generatePlacementsForType(node.board, node.current, reqId, topKLocal);
                        const placements = placementsAll.slice(0, perNodeLimitLocal);
                        placementsConsidered += placements.length;
                        for (const p of placements) {
                            if (cancelled) { try { self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); } catch (e) { } ; return; }
                            const newNext = node.next.slice();
                            const newCur = newNext.length ? newNext.shift() : null;
                            const newKey = hashBoard(p.board) + '|' + (newCur || 'null') + '|' + (node.hold || 'null') + '|' + newNext.join(',');
                            const newScore = node.score + p.score;
                            const existing = nextMap.get(newKey);
                            const nd = { board: p.board, current: newCur, hold: node.hold, next: newNext, score: newScore, firstAction: node.firstAction || { type: 'place', x: p.x, rot: p.rot } };
                            if (!existing || existing.score < nd.score) nextMap.set(newKey, nd);
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
                                    if (cancelled) { try { self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); } catch (e) { } ; return; }
                                    const newKey = hashBoard(p.board) + '|' + (newNextAfterHold.length ? newNextAfterHold[0] : 'null') + '|' + (swappedHold || 'null') + '|' + newNextAfterHold.join(',');
                                    const newScore = node.score + p.score - HOLD_PENALTY; // small penalty for hold
                                    const nd2 = { board: p.board, current: newNextAfterHold.length ? newNextAfterHold.shift() : null, hold: swappedHold, next: newNextAfterHold, score: newScore, firstAction: node.firstAction || { type: 'hold', slot: 1 } };
                                    const existing = nextMap.get(newKey);
                                    if (!existing || existing.score < nd2.score) nextMap.set(newKey, nd2);
                                }
                            }
                        }
                    }
                    // build new beam from nextMap values, sorted by score
                    const nextArr = Array.from(nextMap.values());
                    if (nextArr.length === 0) break;
                    nextArr.sort((a, b) => b.score - a.score);
                    const beamWidth = Math.max(1, Math.floor(beamWidthBase / (1 + Math.floor(depth / 2))));
                    beam = nextArr.slice(0, beamWidth);
                    const depthEnd = Date.now();
                    depthProfile.push({ depth, expandedNodes, placementsConsidered, nextMapSize: nextMap.size, timeMs: depthEnd - depthStart });
                    // send a lightweight progress heartbeat so the caller can extend timeouts
                    try { self.postMessage({ reqId: reqId, type: 'progress', progress: { depth: depth, expandedNodes: expandedNodes, placementsConsidered: placementsConsidered, nextMapSize: nextMap.size, timeMs: depthEnd - depthStart } }); } catch (e) { }
                    // also publish an intermediate best-so-far plan so the main thread can use early results
                    try {
                        const bestNow = (beam && beam.length ? beam[0] : null) || root;
                        let _planNow = { action: 'harddrop' };
                        if (bestNow && bestNow.firstAction && bestNow.firstAction.type === 'place') _planNow = { action: 'place', x: bestNow.firstAction.x, rotation: bestNow.firstAction.rot };
                        else if (bestNow && bestNow.firstAction && bestNow.firstAction.type === 'hold') _planNow = { action: 'hold', slot: 1 };
                        try { self.postMessage({ reqId: reqId, plan: _planNow, score: bestNow ? bestNow.score : 0, sig: sig, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }), intermediate: true }); } catch (e) { }
                    } catch (e) { }
                    // yield to event loop so cancel messages are processed
                    await new Promise(r => setTimeout(r, 0));
                }
                beam.sort((a, b) => b.score - a.score);
                const best = beam[0] || root;
                let plan = { action: 'harddrop' };
                if (best.firstAction && best.firstAction.type === 'place') plan = { action: 'place', x: best.firstAction.x, rotation: best.firstAction.rot };
                else if (best.firstAction && best.firstAction.type === 'hold') plan = { action: 'hold', slot: 1 };
                const bestScore = best.score || 0;
                try { self.postMessage({ reqId: reqId, plan: plan, score: bestScore, sig: sig, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); } catch (e) { try { self.postMessage({ reqId: reqId, error: String(e) }); } catch (e) { } }
            } catch (err) { try { self.postMessage({ reqId: reqId, error: String(err) }); } catch (e) { } }
        })();
    };
})();
