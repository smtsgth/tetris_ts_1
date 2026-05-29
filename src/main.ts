import Game from "./game.js";
import Renderer from "./renderer.js";
import Input from "./input.js";
import attachInputSettings from "./ui-settings.js";
import AI from "./ai.js";

const game = new Game();
const renderer = new Renderer(game);
const input = new Input(game);
const ai = new AI(game);
// Apply faster defaults for interactive responsiveness (can be tuned)
try {
  ai.setLookahead(1);
  ai.setBeamWidthBase(1);
  ai.setPerNodeLimit(1);
  ai.setMaxConcurrentWorkers(8);
} catch (e) {}
// expose for debugging/automation
(window as any).game = game;
(window as any).renderer = renderer;
(window as any).input = input;
(window as any).ai = ai;
// Pre-initialize worker pool on page load to reduce first-request overhead
try {
  if (typeof (ai as any).setWorkerPoolSize === "function")
    (ai as any).setWorkerPoolSize(
      (ai as any).getWorkerPoolSize ? (ai as any).getWorkerPoolSize() : 3,
    );
} catch (e) {}
function loop(ts: number) {
  game.update(ts);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// click to restart when game over — attach after DOM ready and guard for missing element
function attachBoardClick() {
  const boardEl = document.getElementById("board") as HTMLCanvasElement | null;
  if (!boardEl) return;
  boardEl.addEventListener("click", () => {
    const s = game.getState();
    if (s.over) {
      if (
        (window as any).input &&
        typeof (window as any).input.reset === "function"
      )
        (window as any).input.reset();
      game.reset();
    }
  });
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", attachBoardClick);
else attachBoardClick();

// attach input settings UI wiring (reads/writes `input`)
if (typeof attachInputSettings === "function") {
  try {
    attachInputSettings(input);
  } catch (e) {
    /* ignore init errors */
  }
}

console.log("Tetris TS initialized");
