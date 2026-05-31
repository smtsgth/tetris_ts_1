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
    game.setLockMonitorEnabled(true);
    game.clearLockEvents && game.clearLockEvents();
    game.reset();
    const results = [];
    for (let i = 0; i < 20; i++) {
      const before = countFilled(game.getState().board);
      game.hardDrop();
      const after = countFilled(game.getState().board);
      results.push({ iter: i, before, after, over: game.getState().over });
      if (game.getState().over) break;
    }
    const events = typeof game.getLockEvents === 'function' ? game.getLockEvents() : [];
    const stats = typeof game.getLockStats === 'function' ? game.getLockStats() : {};
    console.log(JSON.stringify({ ok: true, iterations: results.length, stats, eventsCount: events.length, events: events.slice(0,20) }, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e) }));
    process.exit(2);
  }
})();
