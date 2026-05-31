#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const argv = process.argv.slice(2);
let url = "http://127.0.0.1:8080/";
let out = null;
let trials = 20;
let method = "probe";
let budgetMs = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if ((a === "--url" || a === "-u") && argv[i + 1]) url = argv[++i];
  else if ((a === "--out" || a === "-o") && argv[i + 1]) out = argv[++i];
  else if ((a === "--trials" || a === "-t") && argv[i + 1])
    trials = Number(argv[++i]);
  else if ((a === "--method" || a === "-m") && argv[i + 1]) method = argv[++i];
  else if ((a === "--budget" || a === "-b") && argv[i + 1])
    budgetMs = Number(argv[++i]);
}

(async function main() {
  try {
    const benchDir = path.join(process.cwd(), "bench_results");
    if (!fs.existsSync(benchDir)) fs.mkdirSync(benchDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile =
      out || path.join(benchDir, `combo_bench_full_auto_${ts}.json`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    await page.goto(url, { waitUntil: "networkidle2" });
    console.log("Page loaded:", url);

    try {
      await page.waitForFunction(
        () => window.ai && typeof window.ai.probeStateWithParams === "function",
        { timeout: 15000 },
      );
      console.log("Detected window.ai");
    } catch (e) {
      console.warn("window.ai not detected within timeout; continuing");
    }

    const res = await page.evaluate(
      async (trials, method, budgetMs) => {
        const ai = window.ai || {};
        const pools = [1, 2, 3, 4];
        const timeouts = [700, 1500, 3000];
        const perNodeLimits = [1, 2];
        const topKs = [1, 2];
        const beamWidthBases = [1, 2];
        const results = [];
        const startedAt = Date.now();

        for (const pool of pools) {
          try {
            if (typeof ai.setWorkerPoolSize === "function")
              ai.setWorkerPoolSize(pool);
          } catch (e) {}
          try {
            if (typeof ai.ensureWorkerPoolInitialized === "function")
              await ai.ensureWorkerPoolInitialized();
          } catch (e) {}
          await new Promise((r) => setTimeout(r, 50));

          for (const timeout of timeouts) {
            for (const perNodeLimit of perNodeLimits) {
              try {
                if (typeof ai.setPerNodeLimit === "function")
                  ai.setPerNodeLimit(perNodeLimit);
              } catch (e) {}
              for (const topK of topKs) {
                for (const beamWidthBase of beamWidthBases) {
                  const sampleTimes = [];
                  for (let t = 0; t < trials; t++) {
                    const state =
                      ai.game && typeof ai.game.getState === "function"
                        ? ai.game.getState()
                        : null;
                    const start = Date.now();
                    try {
                      if (
                        method === "decideWithBudget" &&
                        typeof ai.decideWithBudget === "function"
                      ) {
                        const b =
                          typeof budgetMs === "number" && !isNaN(budgetMs)
                            ? budgetMs
                            : timeout;
                        await ai.decideWithBudget(b, {
                          perNodeLimit,
                          beamWidthBase,
                          topK,
                        });
                      } else if (
                        typeof ai.probeStateWithParams === "function"
                      ) {
                        await ai.probeStateWithParams(
                          state,
                          {},
                          { beamWidthBase, perNodeLimit, topK },
                          timeout,
                        );
                      } else if (typeof ai.runParameterSweep === "function") {
                        await ai.runParameterSweep(
                          { beamWidthBase, perNodeLimit, topK, trials: 1 },
                          timeout,
                        );
                      } else {
                        await new Promise((r) => setTimeout(r, 1));
                      }
                    } catch (e) {
                      // swallow
                    }
                    sampleTimes.push(Date.now() - start);
                  }
                  results.push({
                    pool,
                    timeout,
                    perNodeLimit,
                    topK,
                    beamWidthBase,
                    trials,
                    sampleTimes,
                  });
                  await new Promise((r) => setTimeout(r, 10));
                }
              }
            }
          }
        }

        const endedAt = Date.now();
        const out = {
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          results,
        };
        window.__combo_bench_results = out;
        window.__lastComboBenchResults = out.results;
        return out;
      },
      trials,
      method,
      budgetMs,
    );

    fs.writeFileSync(outFile, JSON.stringify(res, null, 2), "utf8");
    console.log("Bench results written to", outFile);
    await browser.close();
  } catch (err) {
    console.error("run_combo_bench error:", err && err.stack ? err.stack : err);
    process.exit(2);
  }
})();
