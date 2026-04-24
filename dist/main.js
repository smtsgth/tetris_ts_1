import Game from './game.js';
import Renderer from './renderer.js';
import Input from './input.js';
const game = new Game();
const renderer = new Renderer(game);
const input = new Input(game);
// expose for debugging/automation
window.game = game;
window.renderer = renderer;
window.input = input;
function loop(ts) {
    game.update(ts);
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// click to restart when game over — attach after DOM ready and guard for missing element
function attachBoardClick() {
    const boardEl = document.getElementById('board');
    if (!boardEl)
        return;
    boardEl.addEventListener('click', () => {
        const s = game.getState();
        if (s.over) {
            if (window.input && typeof window.input.reset === 'function')
                window.input.reset();
            game.reset();
        }
    });
}
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', attachBoardClick);
else
    attachBoardClick();
console.log('Tetris TS initialized');
