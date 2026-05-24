(() => {
  'use strict';
  const COLS = 10;
  const FULL_MASK = (1 << COLS) - 1;

  const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    J: [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    L: [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    O: [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
    S: [[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
    T: [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    Z: [[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]]
  };

  function rotateCW(m){ const n=m.length; const res=Array.from({length:n},()=>Array(n).fill(0)); for(let r=0;r<n;r++) for(let c=0;c<n;c++) res[c][n-1-r]=m[r][c]; return res; }

  const PRE_ROTATIONS = {};
  const ROT_BBOX = {};
  for (const t in SHAPES) {
    const base = SHAPES[t].map(r=>r.slice());
    const r0 = base; const r1 = rotateCW(r0); const r2 = rotateCW(r1); const r3 = rotateCW(r2);
    PRE_ROTATIONS[t] = [r0, r1, r2, r3];
    ROT_BBOX[t] = PRE_ROTATIONS[t].map(mat => {
      let minC = mat[0].length, maxC = -1;
      for (let rr=0; rr<mat.length; rr++) for (let cc=0; cc<mat[rr].length; cc++) if (mat[rr][cc]){ if (cc<minC) minC=cc; if (cc>maxC) maxC=cc; }
      return { minC, maxC };
    });
  }
  const ROTATION_COUNT = {};
  for (const tt in PRE_ROTATIONS){ const seen = new Set(); PRE_ROTATIONS[tt].forEach(m=>seen.add(JSON.stringify(m))); ROTATION_COUNT[tt] = Math.max(1, seen.size); }

  function toMaskArray(board){
    const rows = board ? board.length : 0;
    const masks = new Array(rows);
    for (let r=0; r<rows; r++){
      const row = board[r];
      if (typeof row === 'number') masks[r] = row >>> 0;
      else {
        let mask = 0;
        if (row) for (let c=0;c<row.length;c++) if (row[c]) mask |= (1<<c);
        masks[r] = mask;
      }
    }
    return masks;
  }

  function cloneBoardMasks(b){ return b.slice(); }

  function canPlaceMasks(boardMasks, mat, x, y){ const rows = boardMasks.length; for (let r=0;r<mat.length;r++){ for (let c=0;c<mat[r].length;c++){ if(!mat[r][c]) continue; const bx=x+c, by=y+r; if (bx<0||bx>=COLS) return false; if (by>=rows) return false; if (by>=0 && ((boardMasks[by] >>> bx) & 1)) return false; } } return true; }

  function dropYMasks(boardMasks, mat, x, startY){ let y=startY; while (canPlaceMasks(boardMasks, mat, x, y+1)) y++; return y; }

  function placeAndClearMasks(boardMasks, mat, x, y){
    const b = cloneBoardMasks(boardMasks);
    const rows = b.length;
    for (let r=0;r<mat.length;r++){
      const by = y + r;
      if (by<0||by>=rows) continue;
      let addMask = 0;
      for (let c=0;c<mat[r].length;c++) if (mat[r][c]){ const bx = x + c; if (bx>=0 && bx<COLS) addMask |= (1<<bx); }
      b[by] = (b[by] | addMask) >>> 0;
    }
    // clear full lines
    let cleared = 0;
    for (let rr = b.length - 1; rr >= 0; rr--){ if (b[rr] === FULL_MASK){ b.splice(rr,1); b.unshift(0); cleared++; rr++; } }
    return { board: b, cleared };
  }

  let W_LINES = 1000, W_AGG = 6, W_HOLES = 130, W_BUMP = 5, HOLD_PENALTY = 320;
  const POPCNT = (function(){ const arr = new Uint8Array(1<<COLS); for(let i=0;i<(1<<COLS);i++){ let v=i, c=0; while(v){ c += v & 1; v >>>= 1; } arr[i]=c; } return arr; })();

  function computeHeightsAndHoles(boardMasks){
    const rows = boardMasks.length;
    const firstOcc = new Array(COLS).fill(rows);
    let seenMask = 0;
    let holes = 0;
    const colMaskAll = (1<<COLS)-1;
    for (let r=0;r<rows;r++){
      const rowmask = (typeof boardMasks[r] === 'number') ? (boardMasks[r]>>>0) : 0;
      let m = rowmask & (~seenMask) & colMaskAll;
      while (m){ const lsb = m & -m; const c = 31 - Math.clz32(lsb); if (firstOcc[c] === rows) firstOcc[c] = r; m &= m - 1; }
      const holesMask = (~rowmask) & seenMask & colMaskAll;
      if (holesMask) holes += POPCNT[holesMask];
      seenMask |= rowmask;
    }
    const heights = new Array(COLS);
    for (let c=0;c<COLS;c++){ const fo = firstOcc[c]; heights[c] = (fo === rows) ? 0 : (rows - fo); }
    return { heights, holes };
  }

  function evaluate(boardMasks, linesCleared){ const ch = computeHeightsAndHoles(boardMasks); const heights = ch.heights; const holes = ch.holes; let agg=0, bump=0; for (let i=0;i<COLS;i++){ agg += heights[i]; if (i < COLS-1){ const d = heights[i] - heights[i+1]; bump += d >= 0 ? d : -d; } } return linesCleared * W_LINES - agg * W_AGG - holes * W_HOLES - bump * W_BUMP; }

  function hashBoardMasks(boardMasks){ let h = 2166136261 >>> 0; for (let r=0;r<boardMasks.length;r++){ const row = boardMasks[r]; const mask = (typeof row === 'number') ? (row>>>0) : 0; h ^= (mask >>> 0); h = Math.imul(h, 16777619) >>> 0; h ^= 0x9e3779b1; h = Math.imul(h, 16777619) >>> 0; } return (h >>> 0).toString(36); }

  function hashBoard(board){ // accepts array-of-arrays or masks
    if (!board || !board.length) return 'empty';
    if (typeof board[0] === 'number') return hashBoardMasks(board);
    return hashBoardMasks(toMaskArray(board));
  }

  const placementCache = new Map();
  const DEFAULT_PLACEMENT_CACHE_MAX = 512;
  let PLACEMENT_CACHE_MAX = DEFAULT_PLACEMENT_CACHE_MAX;
  let placementCacheHits=0, placementCacheMisses=0, placementGeneratedCount=0, placementCacheEvictions=0, placementCacheFallbacks=0, placementCacheMaxObserved=0;
  let TOP_K = 1;

  function getCacheKey(bHash, type){ return bHash + '|' + type; }
  function cacheMetricsSnapshot(){ return { placementCacheHits, placementCacheMisses, placementGeneratedCount, placementCacheEvictions, placementCacheFallbacks, placementCacheSize: placementCache.size, placementCacheMaxObserved }; }

  async function generatePlacementsForType(board, type, reqId, topKOverride){
    // accept either mask-array or board arrays
    const boardMasks = (board && board.length && typeof board[0] === 'number') ? board : toMaskArray(board || []);
    const bHash = hashBoardMasks(boardMasks);
    const topKLocalKey = (typeof topKOverride === 'number') ? Math.max(1, Math.floor(topKOverride)) : TOP_K;
    const key = getCacheKey(bHash, type, topKLocalKey);
    if (placementCache.has(key)){
      const v = placementCache.get(key);
      placementCache.delete(key); placementCache.set(key, v);
      placementCacheHits++;
      return v;
    }
    if (placementCache.size > 0){
      for (const k of placementCache.keys()){
        if (k.indexOf(bHash + '|' + type + '|') === 0 || k === (bHash + '|' + type)){
          const v = placementCache.get(k);
          placementCache.set(key, v);
          placementCacheFallbacks++; placementCacheHits++;
          try { placementCache.delete(k); placementCache.set(k, v); } catch (e) {}
          if (placementCache.size > placementCacheMaxObserved) placementCacheMaxObserved = placementCache.size;
          return v;
        }
      }
    }
    let iterCount = 0;
    const topKToUse = topKLocalKey;
    const topPlacements = [];
    let placementsGenerated = 0;
    const rotCount = ROTATION_COUNT[type] || 4;
    for (let rot=0; rot<rotCount; rot++){
      const mat = PRE_ROTATIONS[type][rot];
      const bbox = ROT_BBOX[type][rot];
      const minX = -bbox.minC; const maxX = COLS - 1 - bbox.maxC;
      for (let x=minX; x<=maxX; x++){
        if (cancelled) return topPlacements;
        iterCount++;
        if ((iterCount & 255) === 0){ try { self.postMessage({ reqId: reqId, type: 'progress', progress: { piece: type, iterCount } }); } catch(e){} await new Promise(r=>setTimeout(r,0)); }
        const startY = -4;
        if (!canPlaceMasks(boardMasks, mat, x, startY)) continue;
        const y = dropYMasks(boardMasks, mat, x, startY);
        const res = placeAndClearMasks(boardMasks, mat, x, y);
        const score = evaluate(res.board, res.cleared);
        placementsGenerated++;
        const candidate = { x, rot, board: res.board, cleared: res.cleared, score };
        if (topPlacements.length < topKToUse) topPlacements.push(candidate);
        else {
          let minIdx = 0; for (let i=1;i<topPlacements.length;i++) if (topPlacements[i].score < topPlacements[minIdx].score) minIdx = i;
          if (candidate.score > topPlacements[minIdx].score) topPlacements[minIdx] = candidate;
        }
      }
    }
    topPlacements.sort((a,b)=>b.score - a.score);
    placementCache.set(key, topPlacements);
    placementCacheMisses++;
    placementGeneratedCount += placementsGenerated;
    if (placementCache.size > placementCacheMaxObserved) placementCacheMaxObserved = placementCache.size;
    if (placementCache.size > PLACEMENT_CACHE_MAX){ const it = placementCache.keys(); const oldest = it.next().value; try{ placementCache.delete(oldest); placementCacheEvictions++; }catch(e){} }
    return topPlacements;
  }

  let cancelled = false;
  self.onmessage = function(e){
    const msg = e.data || {};
    if (msg && msg.type === 'cancel'){ cancelled = true; return; }
    cancelled = false;
    const reqId = msg.reqId;
    try { self.postMessage({ reqId: reqId, type: 'progress', progress: { started: true } }); } catch(e){}
    const lookahead = (typeof msg.lookahead === 'number') ? msg.lookahead : 1;
    const s = msg.state || {};
    try { const w = msg.weights || {}; W_LINES = Number(w.wLines || W_LINES); W_AGG = Number(w.wAgg || W_AGG); W_HOLES = Number(w.wHoles || W_HOLES); W_BUMP = Number(w.wBump || W_BUMP); HOLD_PENALTY = Number(w.holdPenalty || HOLD_PENALTY); } catch(e){}
    const params = msg.params || {};
    if (typeof params.cacheMaxSize !== 'undefined' && !isNaN(Number(params.cacheMaxSize))) PLACEMENT_CACHE_MAX = Math.max(32, Math.floor(Number(params.cacheMaxSize)));
    const beamWidthBaseMsg = Number(params.beamWidthBase) || 1;
    let perNodeLimitMsg = Number(params.perNodeLimit) || 1;
    let topKMsg = typeof params.topK === 'number' ? Number(params.topK) : 1;
    if (typeof params.timeoutMs === 'number'){
      if (params.timeoutMs <= 700){ perNodeLimitMsg = Math.min(perNodeLimitMsg, 1); topKMsg = Math.min(topKMsg, 1); }
      else if (params.timeoutMs <= 1500){ perNodeLimitMsg = Math.min(perNodeLimitMsg, 2); topKMsg = Math.min(topKMsg, 2); }
    }
    if (params.fastMode){ perNodeLimitMsg = Math.min(perNodeLimitMsg, 1); topKMsg = Math.min(topKMsg, 1); }

    (async () => {
      try {
        const sigObj = { next: (s.next || []).slice(0, lookahead), hold: s.hold, current: s.current };
        const sig = JSON.stringify(sigObj);
        const beamWidthBase = beamWidthBaseMsg;
        const perNodeLimit = perNodeLimitMsg;
        TOP_K = topKMsg;
        const root = { board: toMaskArray(s.board || []), current: s.current ? s.current.type : null, hold: s.hold || null, next: (s.next || []).slice(), score: 0, firstAction: null };
        let beam = [root];
        const depthProfile = [];
        const startTotal = Date.now();
        for (let depth=0; depth<lookahead; depth++){
          if (cancelled){ try{ self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); }catch(e){}; return; }
          const nextMap = new Map();
          const depthStart = Date.now();
          let expandedNodes = 0, placementsConsidered = 0;
          for (const node of beam){
            if (cancelled){ try{ self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); }catch(e){}; return; }
            if (!node.current) continue;
            expandedNodes++;
            const elapsedSoFarLocal = Date.now() - startTotal;
            const remainingBudgetLocal = (typeof params.timeoutMs === 'number' ? params.timeoutMs : 1000) - elapsedSoFarLocal;
            let perNodeLimitLocal = perNodeLimitMsg;
            let topKLocal = topKMsg;
            if (params.adaptive){ const depthFactorLocal = 1 - (depth / Math.max(1, lookahead)); perNodeLimitLocal = Math.max(1, Math.min(perNodeLimitMsg, Math.ceil(perNodeLimitMsg * (0.25 + 0.75 * depthFactorLocal)))); topKLocal = Math.max(1, Math.min(topKMsg, Math.ceil(topKMsg * (0.25 + 0.75 * depthFactorLocal)))); if (remainingBudgetLocal < 500){ perNodeLimitLocal = Math.min(perNodeLimitLocal, 1); topKLocal = Math.min(topKLocal, 1); } }
            const placementsAll = await generatePlacementsForType(node.board, node.current, reqId, topKLocal);
            const placements = placementsAll.slice(0, perNodeLimitLocal);
            placementsConsidered += placements.length;
            for (const p of placements){
              if (cancelled){ try{ self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); }catch(e){}; return; }
              const newNext = node.next.slice();
              const newCur = newNext.length ? newNext.shift() : null;
              const newKey = hashBoardMasks(p.board) + '|' + (newCur || 'null') + '|' + (node.hold || 'null') + '|' + newNext.join(',');
              const newScore = node.score + p.score;
              const existing = nextMap.get(newKey);
              const nd = { board: p.board, current: newCur, hold: node.hold, next: newNext, score: newScore, firstAction: node.firstAction || { type: 'place', x: p.x, rot: p.rot } };
              if (!existing || existing.score < nd.score) nextMap.set(newKey, nd);
            }
            // try hold
            if (node.hold !== null || (node.next && node.next.length > 0)){
              const swappedHold = node.hold === null ? node.current : node.hold;
              const newCurType = node.hold === null ? (node.next && node.next.length ? node.next[0] : null) : node.hold;
              const newNextAfterHold = node.hold === null ? node.next.slice(1) : node.next.slice();
              if (newCurType){
                const placements2All = await generatePlacementsForType(node.board, newCurType, reqId, topKLocal);
                const placements2 = placements2All.slice(0, perNodeLimitLocal);
                placementsConsidered += placements2.length;
                for (const p of placements2){
                  if (cancelled){ try{ self.postMessage({ reqId: reqId, cancelled: true, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); }catch(e){}; return; }
                  const newKey = hashBoardMasks(p.board) + '|' + (newNextAfterHold.length ? newNextAfterHold[0] : 'null') + '|' + (swappedHold || 'null') + '|' + newNextAfterHold.join(',');
                  const newScore = node.score + p.score - HOLD_PENALTY;
                  const nd2 = { board: p.board, current: newNextAfterHold.length ? newNextAfterHold.shift() : null, hold: swappedHold, next: newNextAfterHold, score: newScore, firstAction: node.firstAction || { type: 'hold', slot: 1 } };
                  const existing = nextMap.get(newKey);
                  if (!existing || existing.score < nd2.score) nextMap.set(newKey, nd2);
                }
              }
            }
          }
          const nextArr = Array.from(nextMap.values());
          if (nextArr.length === 0) break;
          nextArr.sort((a,b)=>b.score - a.score);
          const beamWidth = Math.max(1, Math.floor(beamWidthBase / (1 + Math.floor(depth / 2))));
          beam = nextArr.slice(0, beamWidth);
          const depthEnd = Date.now();
          depthProfile.push({ depth, expandedNodes, placementsConsidered, nextMapSize: nextMap.size, timeMs: depthEnd - depthStart });
          try{ self.postMessage({ reqId: reqId, type: 'progress', progress: { depth: depth, expandedNodes, placementsConsidered, nextMapSize: nextMap.size, timeMs: depthEnd - depthStart } }); }catch(e){}
          try {
            const bestNow = (beam && beam.length ? beam[0] : null) || root;
            let _planNow = { action: 'harddrop' };
            if (bestNow && bestNow.firstAction && bestNow.firstAction.type === 'place') _planNow = { action: 'place', x: bestNow.firstAction.x, rotation: bestNow.firstAction.rot };
            else if (bestNow && bestNow.firstAction && bestNow.firstAction.type === 'hold') _planNow = { action: 'hold', slot: 1 };
            try{ self.postMessage({ reqId: reqId, plan: _planNow, score: bestNow ? bestNow.score : 0, sig: sig, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }), intermediate: true }); }catch(e){}
          }catch(e){}
          await new Promise(r=>setTimeout(r,0));
        }
        beam.sort((a,b)=>b.score - a.score);
        const best = beam[0] || root;
        let plan = { action: 'harddrop' };
        if (best.firstAction && best.firstAction.type === 'place') plan = { action: 'place', x: best.firstAction.x, rotation: best.firstAction.rot };
        else if (best.firstAction && best.firstAction.type === 'hold') plan = { action: 'hold', slot: 1 };
        const bestScore = best.score || 0;
        try{ self.postMessage({ reqId: reqId, plan, score: bestScore, sig, profile: Object.assign({ depthProfile: depthProfile.slice() }, cacheMetricsSnapshot(), { totalTimeMs: Date.now() - startTotal }) }); }catch(e){ try{ self.postMessage({ reqId: reqId, error: String(e) }); }catch(e){} }
      }catch(err){ try{ self.postMessage({ reqId: reqId, error: String(err) }); }catch(e){} }
    })();
  };

})();
