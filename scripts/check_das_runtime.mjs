import Input from '../dist/input.js';

(async () => {
  const mockGame = {
    moves: 0,
    move: (dx, dy = 0) => { mockGame.moves++; return true; },
    getState: () => ({ over: false, paused: false, current: { x: 0, y: 0 } }),
  };

  const input = new Input(mockGame);
  const down = { key: 'ArrowLeft', repeat: false };
  input.onKeyDown(down);
  console.log('after down moves:', mockGame.moves);
  await new Promise(r => setTimeout(r, 100));
  console.log('after 100ms moves:', mockGame.moves);
  await new Promise(r => setTimeout(r, 200));
  console.log('after +200ms moves:', mockGame.moves);
  await new Promise(r => setTimeout(r, 100));
  console.log('after +100ms moves:', mockGame.moves);
  input.onKeyUp({ key: 'ArrowLeft' });
  const before = mockGame.moves;
  await new Promise(r => setTimeout(r, 500));
  console.log('after keyup+500ms moves:', mockGame.moves, 'should equal', before);
})();
