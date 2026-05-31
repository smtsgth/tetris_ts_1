import Game from '../dist/game.js';

function countFilled(board) {
  let s = 0;
  for (const row of board) {
    for (const c of row) if (c !== null) s++;
  }
  return s;
}

(async () => {
  try {
    const game = new Game();
    let lockCount = 0;
    const origLock = game.lock.bind(game);
    game.lock = function() { lockCount++; return origLock(); };
    game.reset();
    const logs = [];
    for (let i = 0; i < 40; i++) {
      const before = countFilled(game.getState().board);
      game.hardDrop();
      const after = countFilled(game.getState().board);
      logs.push({ iter: i, before, after, lockCount, over: game.getState().over });
      if (game.getState().over) break;
    }
    console.log(JSON.stringify({ ok: true, iterations: logs.length, lockCount, logs }, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e) }));
    process.exit(2);
  }
})();
