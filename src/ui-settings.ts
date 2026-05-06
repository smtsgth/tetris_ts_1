import Input from './input.js';

// Attach runtime UI controls (palettes, tuning, AI panel)
export default function attachInputSettings(input: Input) {
  if (typeof document === 'undefined') return;
  function onReady(fn: () => void) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(() => {
    const game = (window as any).game as any;
    const renderer = (window as any).renderer as any;
    const ai = (window as any).ai as any;

    // palette colors: 2 dark, 5 light (indexes 0-6)
    const outerColors = ['#050505','#111213','#2f3e46','#556b86','#9fb4d9','#dbeafe','#ffffff'];
    const innerColors = ['#0b1221','#101827','#1f6f63','#f59e0b','#ef4444','#fef3c7','#ffffff'];

    function createSwatches(containerId: string, colors: string[], cssVar: string, defaultIndex = 5) {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = '';
      colors.forEach((col, idx) => {
        const sw = document.createElement('div');
        sw.className = 'palette-swatch';
        sw.style.background = col;
        sw.title = col;
        sw.addEventListener('click', () => {
          document.documentElement.style.setProperty(cssVar, col);
          // update selected class
          Array.from(container.children).forEach(ch => (ch as HTMLElement).classList.remove('selected'));
          sw.classList.add('selected');
        });
        container.appendChild(sw);
      });
      // set default
      const idx = Math.max(0, Math.min(colors.length - 1, defaultIndex));
      const child = container.children[idx] as HTMLElement | undefined;
      if (child) (child as HTMLElement).classList.add('selected');
      document.documentElement.style.setProperty(cssVar, colors[idx]);
    }

    // render palette pickers
    createSwatches('palette-outer-panel', outerColors, '--frame-bg', 5);
    createSwatches('palette-inner-panel', innerColors, '--inner-bg', 5);

    // DAS/ARR/Soft Drop wiring
    try {
      const dasRange = document.getElementById('das-range') as HTMLInputElement | null;
      const dasNum = document.getElementById('das-number') as HTMLInputElement | null;
      const arrRange = document.getElementById('arr-range') as HTMLInputElement | null;
      const arrNum = document.getElementById('arr-number') as HTMLInputElement | null;
      const softRange = document.getElementById('soft-range') as HTMLInputElement | null;
      const softNum = document.getElementById('soft-number') as HTMLInputElement | null;
      if (dasRange && dasNum) {
        dasRange.value = String(input.getDAS()); dasNum.value = String(input.getDAS());
        dasRange.addEventListener('input', () => { const v = Number(dasRange.value); input.setDAS(v); dasNum.value = String(v); });
        dasNum.addEventListener('change', () => { const v = Number(dasNum.value); input.setDAS(v); dasRange.value = String(v); });
      }
      if (arrRange && arrNum) {
        arrRange.value = String(input.getARR()); arrNum.value = String(input.getARR());
        arrRange.addEventListener('input', () => { const v = Number(arrRange.value); input.setARR(v); arrNum.value = String(v); });
        arrNum.addEventListener('change', () => { const v = Number(arrNum.value); input.setARR(v); arrRange.value = String(v); });
      }
      if (softRange && softNum) {
        softRange.value = String(input.getSoftDropInterval()); softNum.value = String(input.getSoftDropInterval());
        softRange.addEventListener('input', () => { const v = Number(softRange.value); input.setSoftDropInterval(v); softNum.value = String(v); });
        softNum.addEventListener('change', () => { const v = Number(softNum.value); input.setSoftDropInterval(v); softRange.value = String(v); });
      }
    } catch (e) { }

    // Next count wiring (renderer/game)
    try {
      const nextRange = document.getElementById('next-count-range') as HTMLInputElement | null;
      const nextNum = document.getElementById('next-count-number') as HTMLInputElement | null;
      if (nextRange && nextNum && renderer && game) {
        const cur = typeof renderer.getNextCount === 'function' ? renderer.getNextCount() : 6;
        nextRange.value = String(cur); nextNum.value = String(cur);
        nextRange.addEventListener('input', () => { const v = Number(nextRange.value); try { renderer.setNextCount(v); } catch (e) {} try { game.setNextQueueLength(v); } catch (e) {} nextNum.value = String(v); });
        nextNum.addEventListener('change', () => { const v = Number(nextNum.value); try { renderer.setNextCount(v); } catch (e) {} try { game.setNextQueueLength(v); } catch (e) {} nextRange.value = String(v); });
      }
    } catch (e) { }

    // allow hold toggles
    try {
      const ah1 = document.getElementById('allow-hold1') as HTMLInputElement | null;
      const ah2 = document.getElementById('allow-hold2') as HTMLInputElement | null;
      if (ah1 && game) { ah1.checked = !!game.allowHold1; ah1.addEventListener('change', () => { try { game.setAllowHold1(ah1.checked); } catch (e) {} }); }
      if (ah2 && game) { ah2.checked = !!game.allowHold2; ah2.addEventListener('change', () => { try { game.setAllowHold2(ah2.checked); } catch (e) {} }); }
    } catch (e) { }

    // AI panel wiring
    try {
      const aiToggle = document.getElementById('ai-toggle') as HTMLInputElement | null;
      const aiLookRange = document.getElementById('ai-lookahead-range') as HTMLInputElement | null;
      const aiLookNum = document.getElementById('ai-lookahead-number') as HTMLInputElement | null;
      const aiDisableInput = document.getElementById('ai-disable-input') as HTMLInputElement | null;
      if (ai && aiToggle) {
        aiToggle.checked = !!ai.isEnabled();
        aiToggle.addEventListener('change', () => { try { ai.setEnabled(aiToggle.checked); } catch (e) {} });
      }
      if (ai && aiLookRange && aiLookNum) {
        const curLook = typeof ai.getLookahead === 'function' ? ai.getLookahead() : 6;
        aiLookRange.value = String(curLook); aiLookNum.value = String(curLook);
        const applyLook = (v: number) => { try { if (typeof ai.setLookahead === 'function') ai.setLookahead(v); } catch (e) {} try { if (renderer && typeof renderer.setNextCount === 'function') renderer.setNextCount(v); } catch (e) {} };
        aiLookRange.addEventListener('input', () => { const v = Number(aiLookRange.value); applyLook(v); aiLookNum.value = String(v); });
        aiLookNum.addEventListener('change', () => { const v = Number(aiLookNum.value); applyLook(v); aiLookRange.value = String(v); });
      }
      if (ai && aiDisableInput) {
        aiDisableInput.checked = !!ai.getDisableInputDuringRun?.();
        aiDisableInput.addEventListener('change', () => { try { if (typeof ai.setDisableInputDuringRun === 'function') ai.setDisableInputDuringRun(aiDisableInput.checked); } catch (e) {} });
      }
      // AI evaluation weight controls (if present in DOM)
      try {
        const wLinesR = document.getElementById('ai-weight-lines-range') as HTMLInputElement | null;
        const wLinesN = document.getElementById('ai-weight-lines-number') as HTMLInputElement | null;
        const wAggR = document.getElementById('ai-weight-agg-range') as HTMLInputElement | null;
        const wAggN = document.getElementById('ai-weight-agg-number') as HTMLInputElement | null;
        const wHolesR = document.getElementById('ai-weight-holes-range') as HTMLInputElement | null;
        const wHolesN = document.getElementById('ai-weight-holes-number') as HTMLInputElement | null;
        const wBumpR = document.getElementById('ai-weight-bump-range') as HTMLInputElement | null;
        const wBumpN = document.getElementById('ai-weight-bump-number') as HTMLInputElement | null;
        const holdPenR = document.getElementById('ai-weight-hold-range') as HTMLInputElement | null;
        const holdPenN = document.getElementById('ai-weight-hold-number') as HTMLInputElement | null;
        if (ai) {
          if (wLinesR && wLinesN && typeof ai.getWeightLines === 'function') {
            const cur = ai.getWeightLines(); wLinesR.value = String(cur); wLinesN.value = String(cur);
            wLinesR.addEventListener('input', () => { const v = Number(wLinesR.value); try { ai.setWeightLines(v); } catch (e) {} wLinesN.value = String(v); });
            wLinesN.addEventListener('change', () => { const v = Number(wLinesN.value); try { ai.setWeightLines(v); } catch (e) {} wLinesR.value = String(v); });
          }
          if (wAggR && wAggN && typeof ai.getWeightAgg === 'function') {
            const cur = ai.getWeightAgg(); wAggR.value = String(cur); wAggN.value = String(cur);
            wAggR.addEventListener('input', () => { const v = Number(wAggR.value); try { ai.setWeightAgg(v); } catch (e) {} wAggN.value = String(v); });
            wAggN.addEventListener('change', () => { const v = Number(wAggN.value); try { ai.setWeightAgg(v); } catch (e) {} wAggR.value = String(v); });
          }
          if (wHolesR && wHolesN && typeof ai.getWeightHoles === 'function') {
            const cur = ai.getWeightHoles(); wHolesR.value = String(cur); wHolesN.value = String(cur);
            wHolesR.addEventListener('input', () => { const v = Number(wHolesR.value); try { ai.setWeightHoles(v); } catch (e) {} wHolesN.value = String(v); });
            wHolesN.addEventListener('change', () => { const v = Number(wHolesN.value); try { ai.setWeightHoles(v); } catch (e) {} wHolesR.value = String(v); });
          }
          if (wBumpR && wBumpN && typeof ai.getWeightBump === 'function') {
            const cur = ai.getWeightBump(); wBumpR.value = String(cur); wBumpN.value = String(cur);
            wBumpR.addEventListener('input', () => { const v = Number(wBumpR.value); try { ai.setWeightBump(v); } catch (e) {} wBumpN.value = String(v); });
            wBumpN.addEventListener('change', () => { const v = Number(wBumpN.value); try { ai.setWeightBump(v); } catch (e) {} wBumpR.value = String(v); });
          }
          if (holdPenR && holdPenN && typeof ai.getHoldPenalty === 'function') {
            const cur = ai.getHoldPenalty(); holdPenR.value = String(cur); holdPenN.value = String(cur);
            holdPenR.addEventListener('input', () => { const v = Number(holdPenR.value); try { ai.setHoldPenalty(v); } catch (e) {} holdPenN.value = String(v); });
            holdPenN.addEventListener('change', () => { const v = Number(holdPenN.value); try { ai.setHoldPenalty(v); } catch (e) {} holdPenR.value = String(v); });
          }
          // beam width / per-node controls
          try {
            const beamR = document.getElementById('ai-beamwidth-range') as HTMLInputElement | null;
            const beamN = document.getElementById('ai-beamwidth-number') as HTMLInputElement | null;
            const perNodeR = document.getElementById('ai-pernode-range') as HTMLInputElement | null;
            const perNodeN = document.getElementById('ai-pernode-number') as HTMLInputElement | null;
            if (ai) {
              if (beamR && beamN && typeof ai.getBeamWidthBase === 'function') {
                const cur = ai.getBeamWidthBase(); beamR.value = String(cur); beamN.value = String(cur);
                beamR.addEventListener('input', () => { const v = Number(beamR.value); try { ai.setBeamWidthBase(v); } catch (e) {} beamN.value = String(v); });
                beamN.addEventListener('change', () => { const v = Number(beamN.value); try { ai.setBeamWidthBase(v); } catch (e) {} beamR.value = String(v); });
              }
              if (perNodeR && perNodeN && typeof ai.getPerNodeLimit === 'function') {
                const cur = ai.getPerNodeLimit(); perNodeR.value = String(cur); perNodeN.value = String(cur);
                perNodeR.addEventListener('input', () => { const v = Number(perNodeR.value); try { ai.setPerNodeLimit(v); } catch (e) {} perNodeN.value = String(v); });
                perNodeN.addEventListener('change', () => { const v = Number(perNodeN.value); try { ai.setPerNodeLimit(v); } catch (e) {} perNodeR.value = String(v); });
              }
            }
          } catch (e) { }
        }
      } catch (e) { }
    } catch (e) { }

    // reset settings button
    try {
      const resetBtn = document.getElementById('reset-settings') as HTMLButtonElement | null;
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          createSwatches('palette-outer-panel', outerColors, '--frame-bg', 5);
          createSwatches('palette-inner-panel', innerColors, '--inner-bg', 5);
          try { const nextRange = document.getElementById('next-count-range') as HTMLInputElement | null; const nextNum = document.getElementById('next-count-number') as HTMLInputElement | null; if (nextRange && nextNum) { nextRange.value = '6'; nextNum.value = '6'; renderer && renderer.setNextCount && renderer.setNextCount(6); game && game.setNextQueueLength && game.setNextQueueLength(6); } } catch (e) {}
        });
      }
    } catch (e) { }
  });
}
