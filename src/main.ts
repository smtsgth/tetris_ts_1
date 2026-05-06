import Game from './game.js';
import Renderer from './renderer.js';
import Input from './input.js';
import attachInputSettings from './ui-settings.js';
import AI from './ai.js';

const game = new Game();
const renderer = new Renderer(game);
const input = new Input(game);
const ai = new AI(game);
// expose for debugging/automation
(window as any).game = game;
(window as any).renderer = renderer;
(window as any).input = input;
(window as any).ai = ai;
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

// attach input settings UI wiring (reads/writes `input`)
if (typeof attachInputSettings === 'function') {
  try { attachInputSettings(input); } catch (e) { /* ignore init errors */ }
}

console.log('Tetris TS initialized');
