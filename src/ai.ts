import Game from './game.js';

// Minimal AI shim so builds and runtime can reference `new AI(game)`.
export default class AI {
  private game: Game;
  constructor(game: Game) {
    this.game = game;
  }

  isEnabled(): boolean { return false; }
  setEnabled(_v: boolean): void { /* no-op */ }
  setSpeedMultiplier(_n: number): void { /* no-op */ }
  setDebugEnabled(_v: boolean): void { /* no-op */ }
  getLogs(): string[] { return []; }
  clearLogs(): void { /* no-op */ }
}
