import Input from "./input.js";

// Attach runtime UI controls (palettes, tuning, AI panel)
export default function attachInputSettings(input: Input) {
  if (typeof document === "undefined") return;
  function onReady(fn: () => void) {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  onReady(() => {
    const game = (window as any).game as any;
    const renderer = (window as any).renderer as any;
    const ai = (window as any).ai as any;

    // palette colors arranged as column pairs: [topBright, bottomDark, ...]
    // top row: white, light green, light blue, light yellow, light orange
    // bottom row: black, dark green, dark blue, dark orange, gray
    const outerColors = [
      "#ffffff",
      "#050505", // white / black
      "#dcfce7",
      "#1f6f63", // light green / dark green
      "#dbeafe",
      "#0b2f6b", // light blue / dark blue (changed to dark blue)
      "#f3f4f6",
      "#f59e0b", // light gray (replaced yellow) / dark orange
      "#fff4e6",
      "#6b7280", // light orange / gray
    ];
    // make board (inner) palette use the same swatches as HUD
    const innerColors = outerColors.slice();

    // Helpers: convert hex to RGB, compute luminance, pick readable foreground, set controls bg/fg
    function hexToRgb(hex: string) {
      const h = hex.replace("#", "");
      const bigint = parseInt(
        h.length === 3
          ? h
              .split("")
              .map((c) => c + c)
              .join("")
          : h,
        16,
      );
      return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255,
      };
    }
    function relativeLuminance(r: number, g: number, b: number) {
      const srgb = [r / 255, g / 255, b / 255].map((c) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
      );
      return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    }
    function pickForeground(hex: string) {
      try {
        const { r, g, b } = hexToRgb(hex);
        const L = relativeLuminance(r, g, b);
        // use white for dark backgrounds, black for light backgrounds
        return L < 0.5 ? "#ffffff" : "#111111";
      } catch (e) {
        return "#ffffff";
      }
    }
    function applyControlsStyle(hex: string) {
      try {
        const { r, g, b } = hexToRgb(hex);
        const alpha = 0.9; // transparency for controls
        const rgba = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        document.documentElement.style.setProperty("--controls-bg", rgba);
        document.documentElement.style.setProperty(
          "--controls-foreground",
          pickForeground(hex),
        );
      } catch (e) {}
    }

    function createSwatches(
      containerId: string,
      colors: string[],
      cssVar: string,
      defaultIndex = 5,
    ) {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = "";
      colors.forEach((col, idx) => {
        const sw = document.createElement("div");
        sw.className = "palette-swatch";
        sw.style.background = col;
        sw.title = col;
        sw.addEventListener("click", () => {
          document.documentElement.style.setProperty(cssVar, col);
          // update selected class
          Array.from(container.children).forEach((ch) =>
            (ch as HTMLElement).classList.remove("selected"),
          );
          sw.classList.add("selected");
          if (cssVar === "--frame-bg") applyControlsStyle(col);
        });
        container.appendChild(sw);
      });
      // set default
      const idx = Math.max(0, Math.min(colors.length - 1, defaultIndex));
      const child = container.children[idx] as HTMLElement | undefined;
      if (child) (child as HTMLElement).classList.add("selected");
      document.documentElement.style.setProperty(cssVar, colors[idx]);
      if (cssVar === "--frame-bg") applyControlsStyle(colors[idx]);
    }

    // render palette pickers (default selection = first swatch)
    createSwatches("palette-outer-panel", outerColors, "--frame-bg", 0);
    createSwatches("palette-inner-panel", innerColors, "--inner-bg", 0);

    // set title attributes for AI labels so full text is visible on hover (since labels are single-line)
    try {
      const aiLabelEls = Array.from(
        document.querySelectorAll(
          "#ai-panel .setting-row label, #right-controls #ai-panel .setting-row label",
        ),
      ) as HTMLElement[];
      aiLabelEls.forEach((el) => {
        const t = el.textContent ? el.textContent.trim() : "";
        if (t && !el.getAttribute("title")) el.setAttribute("title", t);
      });
    } catch (e) {}

    // DAS/ARR/Soft Drop wiring
    try {
      const dasRange = document.getElementById(
        "das-range",
      ) as HTMLInputElement | null;
      const dasNum = document.getElementById(
        "das-number",
      ) as HTMLInputElement | null;
      const arrRange = document.getElementById(
        "arr-range",
      ) as HTMLInputElement | null;
      const arrNum = document.getElementById(
        "arr-number",
      ) as HTMLInputElement | null;
      const softRange = document.getElementById(
        "soft-range",
      ) as HTMLInputElement | null;
      const softNum = document.getElementById(
        "soft-number",
      ) as HTMLInputElement | null;
      if (dasRange && dasNum) {
        dasRange.value = String(input.getDAS());
        dasNum.value = String(input.getDAS());
        dasRange.addEventListener("input", () => {
          const v = Number(dasRange.value);
          input.setDAS(v);
          dasNum.value = String(v);
        });
        dasNum.addEventListener("change", () => {
          const v = Number(dasNum.value);
          input.setDAS(v);
          dasRange.value = String(v);
        });
      }
      if (arrRange && arrNum) {
        arrRange.value = String(input.getARR());
        arrNum.value = String(input.getARR());
        arrRange.addEventListener("input", () => {
          const v = Number(arrRange.value);
          input.setARR(v);
          arrNum.value = String(v);
        });
        arrNum.addEventListener("change", () => {
          const v = Number(arrNum.value);
          input.setARR(v);
          arrRange.value = String(v);
        });
      }
      if (softRange && softNum) {
        softRange.value = String(input.getSoftDropInterval());
        softNum.value = String(input.getSoftDropInterval());
        softRange.addEventListener("input", () => {
          const v = Number(softRange.value);
          input.setSoftDropInterval(v);
          softNum.value = String(v);
        });
        softNum.addEventListener("change", () => {
          const v = Number(softNum.value);
          input.setSoftDropInterval(v);
          softRange.value = String(v);
        });
      }
    } catch (e) {}

    // Next count wiring (renderer/game)
    try {
      const nextRange = document.getElementById(
        "next-count-range",
      ) as HTMLInputElement | null;
      const nextNum = document.getElementById(
        "next-count-number",
      ) as HTMLInputElement | null;
      if (nextRange && nextNum && renderer && game) {
        const cur =
          typeof renderer.getNextCount === "function"
            ? renderer.getNextCount()
            : 6;
        nextRange.value = String(cur);
        nextNum.value = String(cur);
        nextRange.addEventListener("input", () => {
          const v = Number(nextRange.value);
          try {
            renderer.setNextCount(v);
          } catch (e) {}
          try {
            game.setNextQueueLength(v);
          } catch (e) {}
          nextNum.value = String(v);
        });
        nextNum.addEventListener("change", () => {
          const v = Number(nextNum.value);
          try {
            renderer.setNextCount(v);
          } catch (e) {}
          try {
            game.setNextQueueLength(v);
          } catch (e) {}
          nextRange.value = String(v);
        });
      }
    } catch (e) {}

    // allow hold toggles
    try {
      const ah1 = document.getElementById(
        "allow-hold1",
      ) as HTMLInputElement | null;
      const ah2 = document.getElementById(
        "allow-hold2",
      ) as HTMLInputElement | null;
      if (ah1 && game) {
        ah1.checked = !!game.allowHold1;
        ah1.addEventListener("change", () => {
          try {
            game.setAllowHold1(ah1.checked);
          } catch (e) {}
        });
      }
      if (ah2 && game) {
        ah2.checked = !!game.allowHold2;
        ah2.addEventListener("change", () => {
          try {
            game.setAllowHold2(ah2.checked);
          } catch (e) {}
        });
      }
    } catch (e) {}

    // AI panel wiring
    try {
      const aiToggle = document.getElementById(
        "ai-toggle",
      ) as HTMLInputElement | null;
      const aiLookRange = document.getElementById(
        "ai-lookahead-range",
      ) as HTMLInputElement | null;
      const aiLookNum = document.getElementById(
        "ai-lookahead-number",
      ) as HTMLInputElement | null;
      const aiDisableInput = document.getElementById(
        "ai-disable-input",
      ) as HTMLInputElement | null;
      if (ai && aiToggle) {
        aiToggle.checked = !!ai.isEnabled();
        aiToggle.addEventListener("change", () => {
          try {
            ai.setEnabled(aiToggle.checked);
          } catch (e) {}
        });
      }
      if (ai && aiLookRange && aiLookNum) {
        const curLook =
          typeof ai.getLookahead === "function" ? ai.getLookahead() : 6;
        aiLookRange.value = String(curLook);
        aiLookNum.value = String(curLook);
        const applyLook = (v: number) => {
          try {
            if (typeof ai.setLookahead === "function") ai.setLookahead(v);
          } catch (e) {}
          try {
            if (renderer && typeof renderer.setNextCount === "function")
              renderer.setNextCount(v);
          } catch (e) {}
        };
        aiLookRange.addEventListener("input", () => {
          const v = Number(aiLookRange.value);
          applyLook(v);
          aiLookNum.value = String(v);
        });
        aiLookNum.addEventListener("change", () => {
          const v = Number(aiLookNum.value);
          applyLook(v);
          aiLookRange.value = String(v);
        });
      }
      if (ai && aiDisableInput) {
        aiDisableInput.checked = !!ai.getDisableInputDuringRun?.();
        aiDisableInput.addEventListener("change", () => {
          try {
            if (typeof ai.setDisableInputDuringRun === "function")
              ai.setDisableInputDuringRun(aiDisableInput.checked);
          } catch (e) {}
        });
      }
      // AI evaluation weight controls (if present in DOM)
      try {
        const wLinesR = document.getElementById(
          "ai-weight-lines-range",
        ) as HTMLInputElement | null;
        const wLinesN = document.getElementById(
          "ai-weight-lines-number",
        ) as HTMLInputElement | null;
        const wAggR = document.getElementById(
          "ai-weight-agg-range",
        ) as HTMLInputElement | null;
        const wAggN = document.getElementById(
          "ai-weight-agg-number",
        ) as HTMLInputElement | null;
        const wHolesR = document.getElementById(
          "ai-weight-holes-range",
        ) as HTMLInputElement | null;
        const wHolesN = document.getElementById(
          "ai-weight-holes-number",
        ) as HTMLInputElement | null;
        const wBumpR = document.getElementById(
          "ai-weight-bump-range",
        ) as HTMLInputElement | null;
        const wBumpN = document.getElementById(
          "ai-weight-bump-number",
        ) as HTMLInputElement | null;
        const holdPenR = document.getElementById(
          "ai-weight-hold-range",
        ) as HTMLInputElement | null;
        const holdPenN = document.getElementById(
          "ai-weight-hold-number",
        ) as HTMLInputElement | null;
        if (ai) {
          if (wLinesR && wLinesN && typeof ai.getWeightLines === "function") {
            const cur = ai.getWeightLines();
            wLinesR.value = String(cur);
            wLinesN.value = String(cur);
            wLinesR.addEventListener("input", () => {
              const v = Number(wLinesR.value);
              try {
                ai.setWeightLines(v);
              } catch (e) {}
              wLinesN.value = String(v);
            });
            wLinesN.addEventListener("change", () => {
              const v = Number(wLinesN.value);
              try {
                ai.setWeightLines(v);
              } catch (e) {}
              wLinesR.value = String(v);
            });
          }
          if (wAggR && wAggN && typeof ai.getWeightAgg === "function") {
            const cur = ai.getWeightAgg();
            wAggR.value = String(cur);
            wAggN.value = String(cur);
            wAggR.addEventListener("input", () => {
              const v = Number(wAggR.value);
              try {
                ai.setWeightAgg(v);
              } catch (e) {}
              wAggN.value = String(v);
            });
            wAggN.addEventListener("change", () => {
              const v = Number(wAggN.value);
              try {
                ai.setWeightAgg(v);
              } catch (e) {}
              wAggR.value = String(v);
            });
          }
          if (wHolesR && wHolesN && typeof ai.getWeightHoles === "function") {
            const cur = ai.getWeightHoles();
            wHolesR.value = String(cur);
            wHolesN.value = String(cur);
            wHolesR.addEventListener("input", () => {
              const v = Number(wHolesR.value);
              try {
                ai.setWeightHoles(v);
              } catch (e) {}
              wHolesN.value = String(v);
            });
            wHolesN.addEventListener("change", () => {
              const v = Number(wHolesN.value);
              try {
                ai.setWeightHoles(v);
              } catch (e) {}
              wHolesR.value = String(v);
            });
          }
          if (wBumpR && wBumpN && typeof ai.getWeightBump === "function") {
            const cur = ai.getWeightBump();
            wBumpR.value = String(cur);
            wBumpN.value = String(cur);
            wBumpR.addEventListener("input", () => {
              const v = Number(wBumpR.value);
              try {
                ai.setWeightBump(v);
              } catch (e) {}
              wBumpN.value = String(v);
            });
            wBumpN.addEventListener("change", () => {
              const v = Number(wBumpN.value);
              try {
                ai.setWeightBump(v);
              } catch (e) {}
              wBumpR.value = String(v);
            });
          }
          if (holdPenR && holdPenN && typeof ai.getHoldPenalty === "function") {
            const cur = ai.getHoldPenalty();
            holdPenR.value = String(cur);
            holdPenN.value = String(cur);
            holdPenR.addEventListener("input", () => {
              const v = Number(holdPenR.value);
              try {
                ai.setHoldPenalty(v);
              } catch (e) {}
              holdPenN.value = String(v);
            });
            holdPenN.addEventListener("change", () => {
              const v = Number(holdPenN.value);
              try {
                ai.setHoldPenalty(v);
              } catch (e) {}
              holdPenR.value = String(v);
            });
          }
          // beam width / per-node controls
          try {
            const beamR = document.getElementById(
              "ai-beamwidth-range",
            ) as HTMLInputElement | null;
            const beamN = document.getElementById(
              "ai-beamwidth-number",
            ) as HTMLInputElement | null;
            const perNodeR = document.getElementById(
              "ai-pernode-range",
            ) as HTMLInputElement | null;
            const perNodeN = document.getElementById(
              "ai-pernode-number",
            ) as HTMLInputElement | null;
            const topKR = document.getElementById(
              "ai-topk-range",
            ) as HTMLInputElement | null;
            const topKN = document.getElementById(
              "ai-topk-number",
            ) as HTMLInputElement | null;
            if (ai) {
              if (beamR && beamN && typeof ai.getBeamWidthBase === "function") {
                const cur = ai.getBeamWidthBase();
                beamR.value = String(cur);
                beamN.value = String(cur);
                beamR.addEventListener("input", () => {
                  const v = Number(beamR.value);
                  try {
                    ai.setBeamWidthBase(v);
                  } catch (e) {}
                  beamN.value = String(v);
                });
                beamN.addEventListener("change", () => {
                  const v = Number(beamN.value);
                  try {
                    ai.setBeamWidthBase(v);
                  } catch (e) {}
                  beamR.value = String(v);
                });
              }
              if (
                perNodeR &&
                perNodeN &&
                typeof ai.getPerNodeLimit === "function"
              ) {
                const cur = ai.getPerNodeLimit();
                perNodeR.value = String(cur);
                perNodeN.value = String(cur);
                perNodeR.addEventListener("input", () => {
                  const v = Number(perNodeR.value);
                  try {
                    ai.setPerNodeLimit(v);
                  } catch (e) {}
                  perNodeN.value = String(v);
                });
                perNodeN.addEventListener("change", () => {
                  const v = Number(perNodeN.value);
                  try {
                    ai.setPerNodeLimit(v);
                  } catch (e) {}
                  perNodeR.value = String(v);
                });
              }
              if (topKR && topKN && typeof ai.getTopK === "function") {
                const cur = ai.getTopK();
                topKR.value = String(cur);
                topKN.value = String(cur);
                topKR.addEventListener("input", () => {
                  const v = Number(topKR.value);
                  try {
                    ai.setTopK(v);
                  } catch (e) {}
                  topKN.value = String(v);
                });
                topKN.addEventListener("change", () => {
                  const v = Number(topKN.value);
                  try {
                    ai.setTopK(v);
                  } catch (e) {}
                  topKR.value = String(v);
                });
              }
            }
          } catch (e) {}
          // additional AI runtime tuning parameters
          try {
            const planTimeoutInput = document.getElementById(
              "plan-timeout-ms",
            ) as HTMLInputElement | null;
            const earlyFallbackInput = document.getElementById(
              "early-fallback-ms",
            ) as HTMLInputElement | null;
            const repeatPlanInput = document.getElementById(
              "repeat-plan-threshold",
            ) as HTMLInputElement | null;
            const workerOverwriteInput = document.getElementById(
              "worker-overwrite-delta",
            ) as HTMLInputElement | null;
            const workerMinProfileInput = document.getElementById(
              "worker-min-profile-ms",
            ) as HTMLInputElement | null;
            const maxWorkersInput = document.getElementById(
              "max-concurrent-workers",
            ) as HTMLInputElement | null;
            if (ai) {
              if (
                planTimeoutInput &&
                typeof ai.getPlanTimeoutMs === "function"
              ) {
                const cur = ai.getPlanTimeoutMs();
                planTimeoutInput.value = String(cur);
                planTimeoutInput.addEventListener("change", () => {
                  const v = Number(planTimeoutInput.value);
                  try {
                    ai.setPlanTimeoutMs(v);
                  } catch (e) {}
                });
              }
              if (
                earlyFallbackInput &&
                typeof ai.getEarlyFallbackMs === "function"
              ) {
                const cur = ai.getEarlyFallbackMs();
                earlyFallbackInput.value = String(cur);
                earlyFallbackInput.addEventListener("change", () => {
                  const v = Number(earlyFallbackInput.value);
                  try {
                    ai.setEarlyFallbackMs(v);
                  } catch (e) {}
                });
              }
              if (
                repeatPlanInput &&
                typeof ai.getRepeatPlanThreshold === "function"
              ) {
                const cur = ai.getRepeatPlanThreshold();
                repeatPlanInput.value = String(cur);
                repeatPlanInput.addEventListener("change", () => {
                  const v = Number(repeatPlanInput.value);
                  try {
                    ai.setRepeatPlanThreshold(v);
                  } catch (e) {}
                });
              }
              if (
                workerOverwriteInput &&
                typeof ai.getWorkerOverwriteScoreDelta === "function"
              ) {
                const cur = ai.getWorkerOverwriteScoreDelta();
                workerOverwriteInput.value = String(cur);
                workerOverwriteInput.addEventListener("change", () => {
                  const v = Number(workerOverwriteInput.value);
                  try {
                    ai.setWorkerOverwriteScoreDelta(v);
                  } catch (e) {}
                });
              }
              if (
                workerMinProfileInput &&
                typeof ai.getWorkerMinProfileMsForRelax === "function"
              ) {
                const cur = ai.getWorkerMinProfileMsForRelax();
                workerMinProfileInput.value = String(cur);
                workerMinProfileInput.addEventListener("change", () => {
                  const v = Number(workerMinProfileInput.value);
                  try {
                    ai.setWorkerMinProfileMsForRelax(v);
                  } catch (e) {}
                });
              }
              // hold/higher-risk tuning
              try {
                const holdThrInput = document.getElementById(
                  "hold-improvement-threshold",
                ) as HTMLInputElement | null;
                const holdDebounceInput = document.getElementById(
                  "hold-debounce-ms",
                ) as HTMLInputElement | null;
                const highRiskMaxInput = document.getElementById(
                  "high-risk-max-height",
                ) as HTMLInputElement | null;
                const highRiskHolesInput = document.getElementById(
                  "high-risk-holes",
                ) as HTMLInputElement | null;
                if (
                  ai &&
                  holdThrInput &&
                  typeof ai.getHoldImprovementThreshold === "function"
                ) {
                  const cur = ai.getHoldImprovementThreshold();
                  holdThrInput.value = String(cur);
                  holdThrInput.addEventListener("change", () => {
                    const v = Number(holdThrInput.value);
                    try {
                      ai.setHoldImprovementThreshold(v);
                    } catch (e) {}
                  });
                }
                if (
                  ai &&
                  holdDebounceInput &&
                  typeof ai.getHoldDebounceMs === "function"
                ) {
                  const cur = ai.getHoldDebounceMs();
                  holdDebounceInput.value = String(cur);
                  holdDebounceInput.addEventListener("change", () => {
                    const v = Number(holdDebounceInput.value);
                    try {
                      ai.setHoldDebounceMs(v);
                    } catch (e) {}
                  });
                }
                if (
                  ai &&
                  highRiskMaxInput &&
                  typeof ai.getHighRiskMaxHeight === "function"
                ) {
                  const cur = ai.getHighRiskMaxHeight();
                  highRiskMaxInput.value = String(cur);
                  highRiskMaxInput.addEventListener("change", () => {
                    const v = Number(highRiskMaxInput.value);
                    try {
                      ai.setHighRiskMaxHeight(v);
                    } catch (e) {}
                  });
                }
                if (
                  ai &&
                  highRiskHolesInput &&
                  typeof ai.getHighRiskHoles === "function"
                ) {
                  const cur = ai.getHighRiskHoles();
                  highRiskHolesInput.value = String(cur);
                  highRiskHolesInput.addEventListener("change", () => {
                    const v = Number(highRiskHolesInput.value);
                    try {
                      ai.setHighRiskHoles(v);
                    } catch (e) {}
                  });
                }
              } catch (e) {}
              if (
                maxWorkersInput &&
                typeof ai.getMaxConcurrentWorkers === "function"
              ) {
                const cur = ai.getMaxConcurrentWorkers();
                maxWorkersInput.value = String(cur);
                maxWorkersInput.addEventListener("change", () => {
                  const v = Number(maxWorkersInput.value);
                  try {
                    ai.setMaxConcurrentWorkers(v);
                  } catch (e) {}
                });
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    } catch (e) {}

    // Lock monitor wiring: stats, events, controls
    try {
      const lockEnabled = document.getElementById(
        "lock-monitor-enabled",
      ) as HTMLInputElement | null;
      const lockThreshold = document.getElementById(
        "lock-rapid-threshold",
      ) as HTMLInputElement | null;
      const lockExportBtn = document.getElementById(
        "lock-export-btn",
      ) as HTMLButtonElement | null;
      const lockExportCsvBtn = document.getElementById(
        "lock-export-csv-btn",
      ) as HTMLButtonElement | null;
      const lockClearBtn = document.getElementById(
        "lock-clear-btn",
      ) as HTMLButtonElement | null;
      const lockStatsEl = document.getElementById(
        "lock-stats",
      ) as HTMLElement | null;
      const lockEventsList = document.getElementById(
        "lock-events-list",
      ) as HTMLElement | null;
      if (game) {
        try {
          if (lockEnabled && typeof game.setLockMonitorEnabled === "function") {
            // try to reflect current state if possible
            try {
              lockEnabled.checked = !!(game.monitorLocks !== undefined
                ? game.monitorLocks
                : true);
            } catch (e) {}
            lockEnabled.addEventListener("change", () => {
              try {
                game.setLockMonitorEnabled(lockEnabled.checked);
              } catch (e) {}
            });
          }
          if (lockThreshold && typeof game.getLockStats === "function") {
            const s = game.getLockStats();
            if (s && typeof s.rapidLockThresholdMs === "number")
              lockThreshold.value = String(s.rapidLockThresholdMs);
            lockThreshold.addEventListener("change", () => {
              const v = Number(lockThreshold.value);
              try {
                game.setLockRapidThresholdMs(v);
              } catch (e) {}
            });
          }
          if (lockExportBtn)
            lockExportBtn.addEventListener("click", () => {
              try {
                if (typeof game.exportLockEventsToWindow === "function")
                  game.exportLockEventsToWindow();
                lockRefresh();
              } catch (e) {}
            });
          if (lockExportCsvBtn)
            lockExportCsvBtn.addEventListener("click", () => {
              // CSV generation will be handled below via blob fallback
              try {
                // fallback: create CSV via browser blob using latest events
                const ev2 =
                  typeof game.getLockEvents === "function"
                    ? game.getLockEvents()
                    : ([] as any[]);
                if (!ev2 || !ev2.length) return;
                const header = [
                  "ts",
                  "type",
                  "piece",
                  "beforeFilled",
                  "afterFilled",
                  "delta",
                ];
                const csvRows = [header.join(",")];
                for (const it of ev2) {
                  const cells = [
                    it.ts,
                    it.type,
                    it.piece,
                    it.beforeFilled,
                    it.afterFilled,
                    it.delta,
                  ].map((c) => `${String(c).replace(/"/g, '""')}`);
                  csvRows.push('"' + cells.join('","') + '"');
                }
                const csvText = csvRows.join("\n");
                const blob = new Blob([csvText], {
                  type: "text/csv;charset=utf-8;",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `lock_events_${Date.now()}.csv`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                  try {
                    URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                  } catch (e) {}
                }, 2000);
              } catch (e) {}
            });
          if (lockClearBtn)
            lockClearBtn.addEventListener("click", () => {
              try {
                if (typeof game.clearLockEvents === "function")
                  game.clearLockEvents();
                lockRefresh();
              } catch (e) {}
            });

          function lockRefresh() {
            try {
              if (!lockStatsEl || !lockEventsList) return;
              const s =
                typeof game.getLockStats === "function"
                  ? game.getLockStats()
                  : ({} as any);
              const ev =
                typeof game.getLockEvents === "function"
                  ? game.getLockEvents()
                  : ([] as any[]);
              lockStatsEl.textContent = `total=${s.totalLocks || 0}, anomalies=${s.anomalyCount || 0}, last=${s.lastLockTs || "n/a"}`;
              lockEventsList.innerHTML = "";
              for (let i = Math.max(0, ev.length - 10); i < ev.length; i++) {
                const item = ev[i];
                const d = document.createElement("div");
                d.className = "lock-event";
                d.style.padding = "4px 0";
                d.style.borderBottom = "1px solid rgba(255,255,255,0.04)";
                try {
                  d.textContent = `${new Date(item.ts).toLocaleTimeString()} ${item.type} ${item.piece} before:${item.beforeFilled} after:${item.afterFilled} Δ:${item.delta}`;
                } catch (e) {
                  d.textContent = JSON.stringify(item);
                }
                lockEventsList.appendChild(d);
              }
            } catch (e) {}
          }

          lockRefresh();
          setInterval(lockRefresh, 1000);
        } catch (e) {}
      }
    } catch (e) {}

    // reset settings button (index.html uses reset-settings-2)
    try {
      const resetBtn = document.getElementById(
        "reset-settings-2",
      ) as HTMLButtonElement | null;
      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          createSwatches("palette-outer-panel", outerColors, "--frame-bg", 0);
          createSwatches("palette-inner-panel", innerColors, "--inner-bg", 0);
          try {
            const nextRange = document.getElementById(
              "next-count-range",
            ) as HTMLInputElement | null;
            const nextNum = document.getElementById(
              "next-count-number",
            ) as HTMLInputElement | null;
            if (nextRange && nextNum) {
              nextRange.value = "6";
              nextNum.value = "6";
              renderer && renderer.setNextCount && renderer.setNextCount(6);
              game && game.setNextQueueLength && game.setNextQueueLength(6);
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
  });
}
