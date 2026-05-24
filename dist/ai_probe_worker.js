(function(){
  const COLS = 10;
  const SHAPES = {
    I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    J:[[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    L:[[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    O:[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
    S:[[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
    T:[[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    Z:[[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]]
  };
  function rotateCW(m){ const n=m.length; const res=Array.from({length:n},()=>Array(n).fill(0)); for(let r=0;r<n;r++) for(let c=0;c<n;c++) res[c][n-1-r]=m[r][c]; return res; }
  const PRE_ROTATIONS = {};
  const ROT_BBOX = {};
  for(const t in SHAPES){
    const base = SHAPES[t].map(r=>r.slice());
    const r0 = base; const r1 = rotateCW(r0); const r2 = rotateCW(r1); const r3 = rotateCW(r2);
    PRE_ROTATIONS[t] = [r0,r1,r2,r3];
    ROT_BBOX[t] = PRE_ROTATIONS[t].map(mat=>{ let minC=mat[0].length, maxC=-1; for(let rr=0; rr<mat.length; rr++) for(let cc=0; cc<mat[rr].length; cc++) if(mat[rr][cc]){ if(cc<minC) minC=cc; if(cc>maxC) maxC=cc; } return {minC,maxC}; });
  }
  function getRotationMatrix(type, rot){ const rr = ((rot%4)+4)%4; return PRE_ROTATIONS[type][rr]; }
  function canPlace(board, mat, x, y){ const rows = (board||[]).length; for(let r=0;r<mat.length;r++){ for(let c=0;c<mat[r].length;c++){ if(!mat[r][c]) continue; const bx=x+c, by=y+r; if(bx<0||bx>=COLS) return false; if(by>=rows) return false; if(by>=0 && board[by] && board[by][bx]) return false; } } return true; }
  function dropY(board, mat, x, startY){ let y=startY; while(canPlace(board, mat, x, y+1)) y++; return y; }
  function placeAndClear(board, mat, x, y, type){ const b = (board||[]).map(r=>r.slice()); for(let r=0;r<mat.length;r++) for(let c=0;c<mat[r].length;c++) if(mat[r][c]){ const bx=x+c, by=y+r; if(by>=0&&by<b.length&&bx>=0&&bx<COLS) b[by][bx]=type; } let cleared=0; for(let rr=b.length-1; rr>=0; rr--){ if(b[rr].every(cell=>cell)){ b.splice(rr,1); b.unshift(Array(COLS).fill(null)); cleared++; rr++; } } return { board: b, cleared }; }
  function aggregateHeight(board){ const cols=COLS, rows=(board||[]).length, heights=Array(cols).fill(0); for(let c=0;c<cols;c++){ for(let r=0;r<rows;r++){ if(board[r] && board[r][c]){ heights[c]=rows-r; break; } } } return heights; }
  function countHoles(board){ const rows=(board||[]).length; let holes=0; for(let c=0;c<COLS;c++){ let seen=false; for(let r=0;r<rows;r++){ if(board[r] && board[r][c]) seen=true; else if(seen) holes++; } } return holes; }
  function bumpiness(heights){ let s=0; for(let i=0;i<heights.length-1;i++) s+=Math.abs(heights[i]-heights[i+1]); return s; }
  function evaluate(board, linesCleared){ const heights=aggregateHeight(board); const agg=heights.reduce((a,b)=>a+b,0); const holes=countHoles(board); const bump=bumpiness(heights); return linesCleared*1000 - agg*6 - holes*130 - bump*5; }

  let cancelled = false;
  try { self.postMessage({ type: 'worker-ready' }); } catch (e) {}

  self.onmessage = function(e){
    const msg = e && e.data ? e.data : {};
    if(msg && msg.type === 'cancel'){ cancelled = true; return; }
    if(msg && (msg.type === 'handshake' || msg.type === 'init-handshake')){ try{ self.postMessage({ type:'worker-ready', handshakeId: msg.handshakeId }); }catch(e){} return; }
    const reqId = msg.reqId;
    try { self.postMessage({ reqId: reqId, type: 'progress', progress: { started: true } }); } catch (e) {}
    const s = msg.state || {};
    const cur = s.current ? s.current.type : null;
    if(!cur){ try{ self.postMessage({ reqId: reqId, plan: { action: 'harddrop' }, score: 0, sig: JSON.stringify({ next: (s.next||[]).slice(0, (msg.lookahead||1)), hold: s.hold, current: cur }) }); }catch(e){} return; }
    (async function(){
      try{
        const placements = [];
        for(let rot=0; rot<4; rot++){
          const mat = getRotationMatrix(cur, rot);
          let minC = mat[0].length, maxC = -1;
          for(let r=0;r<mat.length;r++) for(let c=0;c<mat[r].length;c++) if(mat[r][c]){ if(c<minC) minC=c; if(c>maxC) maxC=c; }
          const minX = -minC; const maxX = COLS - 1 - maxC;
          for(let x=minX; x<=maxX; x++){
            if(cancelled) return;
            if(!canPlace(s.board||[], mat, x, -4)) continue;
            const y = dropY(s.board||[], mat, x, -4);
            const res = placeAndClear(s.board||[], mat, x, y, cur);
            const score = evaluate(res.board, res.cleared);
            placements.push({ x, rot, score, cleared: res.cleared });
          }
        }
        placements.sort((a,b)=>b.score - a.score);
        const best = placements.length ? placements[0] : null;
        const plan = best ? { action: 'place', x: best.x, rotation: best.rot } : { action: 'harddrop' };
        try{ self.postMessage({ reqId: reqId, plan: plan, score: best ? best.score : 0, sig: JSON.stringify({ next: (s.next||[]).slice(0, (msg.lookahead||1)), hold: s.hold, current: cur }) }); }catch(e){}
      }catch(e){ try{ self.postMessage({ reqId: reqId, error: String(e) }); }catch(e){} }
    })();
  };
})();
