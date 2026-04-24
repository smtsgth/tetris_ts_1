import Game from './game.js';
import Renderer from './renderer.js';
import Input from './input.js';

const game = new Game();
const renderer = new Renderer(game);
const input = new Input(game);
// expose for debugging/automation
(window as any).game = game;
(window as any).renderer = renderer;
(window as any).input = input;
function loop(ts: number) {
  game.update(ts);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// click to restart when game over — attach after DOM ready and guard for missing element
function attachBoardClick() {
  const boardEl = document.getElementById('board') as HTMLCanvasElement | null;
  if (!boardEl)
    return;
  boardEl.addEventListener('click', () => {
    const s = game.getState();
    if (s.over) {
      if ((window as any).input && typeof (window as any).input.reset === 'function')
        (window as any).input.reset();
      game.reset();
    }
  });
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', attachBoardClick);
else
  attachBoardClick();

console.log('Tetris TS initialized');
