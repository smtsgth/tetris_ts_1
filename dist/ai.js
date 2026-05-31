import { aiProbeWorkerMain } from "./ai_probe_worker_main.js";
// Generate the probe worker script by converting a self-contained function to source text.
// AI with worker scaffolding: sends simple planning requests to a Blob worker,
// supports timeout and synchronous fallback, and suppresses holds during fallback.
export default class AI {
    getEarlyFallbackMs() {
        return this.EARLY_FALLBACK_MS;
    }
    setEarlyFallbackMs(n) {
        try {
            this.EARLY_FALLBACK_MS = Math.max(0, Math.round(Number(n) || 0));
        }
        catch (e) { }
    }
    // Compute effective plan timeout scaled by `speedMultiplier` to allow faster runs when sped up
    getPlanTimeoutMs() {
        try {
            return Math.max(1, Math.round(this.BASE_PLAN_TIMEOUT_MS / Math.max(1, this.speedMultiplier)));
        }
        catch (e) {
            return this.BASE_PLAN_TIMEOUT_MS;
        }
    }
    // Allow runtime tuning of base plan timeout (ms)
    setPlanTimeoutMs(n) {
        try {
            this.BASE_PLAN_TIMEOUT_MS = Math.max(1, Math.round(Number(n) || 1));
        }
        catch (e) {
            /* ignore */
        }
    }
    // Compute an effective max concurrent workers value that can scale with `speedMultiplier`.
    getEffectiveMaxWorkers() {
        try {
            return Math.max(1, Math.min(4096, Math.round(this.maxConcurrentWorkers * Math.max(1, this.speedMultiplier))));
        }
        catch (e) {
            return this.maxConcurrentWorkers;
        }
    }
    // Lazy-initialize a small worker pool to avoid repeated Worker creation costs.
    ensureWorkerPoolInitialized() {
        try {
            if (this.workerPool && this.workerPool.length > 0)
                return;
            const target = Math.max(1, Math.min(this.defaultWorkerPoolSize, this.getEffectiveMaxWorkers()));
            for (let i = 0; i < target; i++) {
                try {
                    const created = this.createWorkerForRequest();
                    const w = created.worker;
                    const url = created.url;
                    // route messages to the shared onWorkerMessage handler by default
                    try {
                        w.onmessage = (ev) => {
                            try {
                                this.onWorkerMessage(ev.data);
                            }
                            catch (e) { }
                        };
                    }
                    catch (e) { }
                    this.workerPool.push({
                        worker: w,
                        url: url,
                        busy: false,
                        id: `pool-${Date.now()}-${i}`,
                    });
                }
                catch (e) {
                    try {
                        this.logs.push("workerPool create error: " + String(e));
                    }
                    catch (e) { }
                }
            }
        }
        catch (e) { }
    }
    // Acquire a worker from the pool (or create a fresh one if none idle).
    acquireWorker() {
        try {
            this.ensureWorkerPoolInitialized();
            for (const p of this.workerPool) {
                if (!p.busy) {
                    p.busy = true;
                    return { worker: p.worker, url: p.url, pooled: true };
                }
            }
            // no idle pooled worker, create a new transient worker
            const created = this.createWorkerForRequest();
            return { worker: created.worker, url: created.url, pooled: false };
        }
        catch (e) {
            // fallback: try direct creation
            try {
                const created = this.createWorkerForRequest();
                return { worker: created.worker, url: created.url, pooled: false };
            }
            catch (err) {
                throw err;
            }
        }
    }
    constructor(game) {
        this.enabled = false;
        this.speedMultiplier = 1;
        this.debug = false;
        this.lookahead = 6;
        this.weightLines = 1000;
        this.weightAgg = 6;
        this.weightHoles = 130;
        this.weightBump = 5;
        this.holdPenalty = 20;
        this.beamWidthBase = 1;
        this.perNodeLimit = 1;
        this.disableInputDuringRun = true;
        this.logs = [];
        // active workers map: allow multiple concurrent workers (for parallel fallback)
        this.activeWorkers = new Map();
        this.workerTimeouts = new Map();
        this.earlyFallbackTimers = new Map();
        this.appliedFallbacks = new Map();
        this.reqCounter = 0;
        this.pendingReqId = null;
        this.scheduleTimer = null;
        // base timeout (ms) used to compute per-request timeouts scaled by `speedMultiplier`
        this.BASE_PLAN_TIMEOUT_MS = 500; // base ms (scaled by speedMultiplier) - tuned for responsiveness
        this.REPEAT_PLAN_THRESHOLD = 3;
        this.lastPlanSig = null;
        this.repeatCount = 0;
        // guard to prevent planOnce from starting new workers while a probe/sweep is running
        this.probeInProgress = false;
        this.maxConcurrentWorkers = 320; // configured base concurrent workers (more aggressive)
        // early fallback timers are tracked per-request in earlyFallbackTimers map
        this.EARLY_FALLBACK_MS = 30; // ms (delay synchronous fallback to let workers explore) - tuned down
        // when a synchronous fallback has been applied, allow a worker result
        // to overwrite it if the worker did meaningful work or slightly better score
        this.WORKER_OVERWRITE_SCORE_DELTA = 2;
        this.WORKER_MIN_PROFILE_MS_FOR_RELAX = 0; // allow worker overwrite immediately (very aggressive)
        this.APPLIED_FALLBACK_TTL_MS = 300; // ms - shorter TTL to free slots sooner
        // dedupe / anti-stacking helpers
        this.lastAppliedSig = null;
        this.lastAppliedAt = 0;
        this.APPLY_DEDUP_MS = 0; // ms: ignore re-applies with same sig within this window (aggressive -> none)
        this.lastHoldAtBySlot = new Map();
        this.lastHoldAt = 0;
        this.HOLD_DEBOUNCE_MS = 10; // ms debounce for hold applications (more aggressive)
        this.MIN_SCHEDULE_INTERVAL_MS = 1; // ms minimum schedule interval for ultra aggressive speedups
        // cached blob worker URL to avoid recreating Blob per-request
        this.cachedWorkerBlobUrl = null;
        // Worker pool to reuse Worker instances and reduce creation overhead
        this.workerPool = [];
        this.defaultWorkerPoolSize = 3;
        // lightweight profiling events collected at runtime (for bulk analysis)
        this.collectedProfiles = [];
        this.profileStarts = new Map();
        this.lastProfileTs = 0;
        this.game = game;
    }
    isEnabled() {
        return this.enabled;
    }
    setEnabled(v) {
        this.enabled = !!v;
        if (this.enabled)
            this.startLoop();
        else
            this.stopLoop();
    }
    // disable AI and wait for any active worker/schedule to clear (best-effort)
    // keepLock: when true, leave probeInProgress locked for caller to clear later
    async disableAndWait(timeoutMs = 2000, keepLock = false) {
        // set probe lock so planOnce won't start new workers while we clear
        this.probeInProgress = true;
        try {
            try {
                this.setEnabled(false);
            }
            catch (e) { }
            const start = Date.now();
            while ((this.activeWorkers.size > 0 ||
                this.pendingReqId ||
                this.workerTimeouts.size > 0 ||
                this.scheduleTimer) &&
                Date.now() - start < timeoutMs) {
                // ensure active workers are asked to cancel/terminated as a best-effort
                try {
                    for (const [rid, info] of Array.from(this.activeWorkers.entries())) {
                        try {
                            info.worker.postMessage({ type: "cancel", reqId: rid });
                        }
                        catch (e) { }
                        try {
                            this.terminateActiveWorker(rid);
                        }
                        catch (e) { }
                    }
                }
                catch (e) { }
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => setTimeout(r, 25));
            }
        }
        finally {
            // clear lock unless caller explicitly requested it to be preserved
            if (!keepLock)
                this.probeInProgress = false;
        }
    }
    setSpeedMultiplier(n) {
        this.speedMultiplier = Math.max(0.1, Number(n) || 1);
    }
    setDebugEnabled(v) {
        this.debug = !!v;
    }
    getLogs() {
        return this.logs.slice();
    }
    clearLogs() {
        this.logs = [];
    }
    // profile recording API
    recordProfile(ev) {
        try {
            const now = Date.now();
            const perfNow = typeof globalThis.performance !== "undefined" &&
                typeof globalThis.performance.now === "function"
                ? globalThis.performance.now()
                : null;
            const e = Object.assign({ ts: now }, ev || {});
            if (perfNow !== null)
                e.perfTs = Math.round(perfNow);
            // delta since last recorded profile (useful for throughput analysis)
            try {
                if (this.lastProfileTs && typeof this.lastProfileTs === "number")
                    e.deltaSinceLastMs = now - this.lastProfileTs;
            }
            catch (err) { }
            this.lastProfileTs = now;
            // track start times per reqId or sig so we can derive totalTimeMs when final/profile events arrive
            try {
                if (e && e.event === "plan-start" && typeof e.reqId === "string")
                    this.profileStarts.set(e.reqId, now);
                if (e && e.event === "worker-created" && typeof e.reqId === "string")
                    this.profileStarts.set(e.reqId, now);
                if (e &&
                    typeof e.reqId === "string" &&
                    this.profileStarts.has(e.reqId)) {
                    const s = this.profileStarts.get(e.reqId);
                    if (typeof s === "number")
                        e.derivedTotalTimeMs = now - s;
                    if (typeof e.event === "string" &&
                        ["worker-final", "worker-cancel", "worker-error"].includes(e.event))
                        this.profileStarts.delete(e.reqId);
                }
                // also support sig-based short-lived timings (for force-apply / bulk flows)
                if ((!e.reqId || e.reqId === null) &&
                    e.sig &&
                    typeof e.sig === "string") {
                    if (e.event === "plan-start" && e.sig)
                        this.profileStarts.set(e.sig, now);
                    if (this.profileStarts.has(e.sig)) {
                        const s2 = this.profileStarts.get(e.sig);
                        if (typeof s2 === "number")
                            e.derivedTotalTimeMs = now - s2;
                        if (typeof e.event === "string" &&
                            [
                                "worker-final",
                                "worker-cancel",
                                "worker-error",
                                "force-apply-invoked",
                            ].includes(e.event))
                            this.profileStarts.delete(e.sig);
                    }
                }
            }
            catch (err) { }
            this.collectedProfiles.push(e);
            // cap stored profiles to avoid unbounded memory growth
            if (this.collectedProfiles.length > 20000)
                this.collectedProfiles.shift();
        }
        catch (e) { }
    }
    getAllProfileEvents() {
        try {
            return this.collectedProfiles.slice();
        }
        catch (e) {
            return [];
        }
    }
    exportProfilesToWindow() {
        try {
            window.workerProfiles = this.getAllProfileEvents();
        }
        catch (e) { }
    }
    downloadProfiles() {
        try {
            const data = JSON.stringify(this.getAllProfileEvents());
            const b = new Blob([data], { type: "application/json" });
            const url = URL.createObjectURL(b);
            const a = document.createElement("a");
            a.href = url;
            a.download = "ai_profiles.json";
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                try {
                    URL.revokeObjectURL(url);
                    a.remove();
                }
                catch (e) { }
            }, 800);
        }
        catch (e) { }
    }
    setLookahead(n) {
        this.lookahead = Math.max(1, Math.min(16, Math.floor(Number(n) || 1)));
    }
    getLookahead() {
        return this.lookahead;
    }
    setDisableInputDuringRun(v) {
        this.disableInputDuringRun = !!v;
        if (!this.disableInputDuringRun) {
            try {
                window.input &&
                    typeof window.input.setLocked === "function" &&
                    window.input.setLocked(false);
            }
            catch (e) { }
        }
    }
    getDisableInputDuringRun() {
        return this.disableInputDuringRun;
    }
    // runtime accessors for concurrent worker tuning
    getMaxConcurrentWorkers() {
        return this.maxConcurrentWorkers;
    }
    setMaxConcurrentWorkers(n) {
        this.maxConcurrentWorkers = Math.max(1, Math.floor(Number(n) || 1));
    }
    // Worker pool size accessors and dynamic adjustment
    setWorkerPoolSize(n) {
        try {
            const newSize = Math.max(1, Math.floor(Number(n) || 1));
            this.defaultWorkerPoolSize = newSize;
            const target = Math.max(1, Math.min(this.defaultWorkerPoolSize, this.getEffectiveMaxWorkers()));
            if (!this.workerPool)
                this.workerPool = [];
            const current = this.workerPool.length;
            // grow pool if needed
            if (current < target) {
                for (let i = current; i < target; i++) {
                    try {
                        const created = this.createWorkerForRequest();
                        const w = created.worker;
                        const url = created.url;
                        try {
                            w.onmessage = (ev) => {
                                try {
                                    this.onWorkerMessage(ev.data);
                                }
                                catch (e) { }
                            };
                        }
                        catch (e) { }
                        this.workerPool.push({
                            worker: w,
                            url: url,
                            busy: false,
                            id: `pool-${Date.now()}-${i}`,
                        });
                    }
                    catch (e) {
                        try {
                            this.logs.push("workerPool grow error: " + String(e));
                        }
                        catch (ee) { }
                    }
                }
            }
            else if (current > target) {
                // shrink pool by terminating idle workers
                for (let i = this.workerPool.length - 1; i >= 0 && this.workerPool.length > target; i--) {
                    const p = this.workerPool[i];
                    if (!p.busy) {
                        try {
                            p.worker.terminate();
                        }
                        catch (e) { }
                        try {
                            if (p.url && p.url !== this.cachedWorkerBlobUrl) {
                                URL.revokeObjectURL(p.url);
                            }
                        }
                        catch (e) { }
                        this.workerPool.splice(i, 1);
                    }
                }
            }
        }
        catch (e) { }
    }
    getWorkerPoolSize() {
        return this.defaultWorkerPoolSize;
    }
    packBoardToUint32(board) {
        try {
            if (!board)
                return new Uint32Array(0);
            const rows = board.length || 0;
            const out = new Uint32Array(rows);
            if (rows === 0)
                return out;
            if (typeof board[0] === "number") {
                for (let i = 0; i < rows; i++)
                    out[i] = board[i] >>> 0;
                return out;
            }
            for (let r = 0; r < rows; r++) {
                const row = board[r] || [];
                let mask = 0;
                for (let c = 0; c < 10; c++) {
                    if (row[c])
                        mask |= 1 << c;
                }
                out[r] = mask >>> 0;
            }
            return out;
        }
        catch (e) {
            return new Uint32Array(0);
        }
    }
    // evaluation weight accessors (tuning)
    setWeightLines(n) {
        this.weightLines = Number(n) || 1000;
    }
    getWeightLines() {
        return this.weightLines;
    }
    setWeightAgg(n) {
        this.weightAgg = Number(n) || 6;
    }
    getWeightAgg() {
        return this.weightAgg;
    }
    setWeightHoles(n) {
        this.weightHoles = Number(n) || 130;
    }
    getWeightHoles() {
        return this.weightHoles;
    }
    setWeightBump(n) {
        this.weightBump = Number(n) || 5;
    }
    getWeightBump() {
        return this.weightBump;
    }
    setHoldPenalty(n) {
        this.holdPenalty = Number(n) || 20;
    }
    getHoldPenalty() {
        return this.holdPenalty;
    }
    setBeamWidthBase(n) {
        this.beamWidthBase = Math.max(1, Math.floor(Number(n) || 8));
    }
    getBeamWidthBase() {
        return this.beamWidthBase;
    }
    setPerNodeLimit(n) {
        this.perNodeLimit = Math.max(1, Math.floor(Number(n) || 8));
    }
    getPerNodeLimit() {
        return this.perNodeLimit;
    }
    // tuning setters for debounce / scheduling
    setHoldDebounce(ms) {
        this.HOLD_DEBOUNCE_MS = Math.max(0, Number(ms) || 700);
    }
    setMinScheduleInterval(ms) {
        this.MIN_SCHEDULE_INTERVAL_MS = Math.max(10, Number(ms) || 40);
    }
    startLoop() {
        try {
            if (this.disableInputDuringRun)
                window.input &&
                    typeof window.input.setLocked === "function" &&
                    window.input.setLocked(true);
        }
        catch (e) { }
        this.scheduleNext();
    }
    stopLoop() {
        // clear any per-worker timeouts
        try {
            for (const [rid, t] of Array.from(this.workerTimeouts.entries())) {
                try {
                    clearTimeout(t);
                }
                catch (e) { }
                this.workerTimeouts.delete(rid);
            }
        }
        catch (e) { }
        if (this.scheduleTimer) {
            try {
                clearTimeout(this.scheduleTimer);
            }
            catch (e) { }
            this.scheduleTimer = null;
        }
        try {
            this.terminateActiveWorker();
        }
        catch (e) { }
        try {
            if (this.disableInputDuringRun)
                window.input &&
                    typeof window.input.setLocked === "function" &&
                    window.input.setLocked(false);
        }
        catch (e) { }
    }
    scheduleNext() {
        if (!this.enabled)
            return;
        const interval = Math.max(this.MIN_SCHEDULE_INTERVAL_MS, Math.round(800 / this.speedMultiplier));
        if (this.scheduleTimer) {
            try {
                clearTimeout(this.scheduleTimer);
            }
            catch (e) { }
            this.scheduleTimer = null;
        }
        this.scheduleTimer = setTimeout(() => {
            this.scheduleTimer = null;
            if (!this.enabled)
                return;
            // if a probe/sweep is in progress, delay executing planOnce and reschedule shortly
            if (this.probeInProgress) {
                try {
                    this.logs.push("schedule delayed: probe in progress");
                }
                catch (e) { }
                // small backoff before retrying
                const backoff = Math.max(60, Math.round(200 / this.speedMultiplier));
                this.scheduleTimer = setTimeout(() => {
                    this.scheduleTimer = null;
                    if (!this.enabled)
                        return;
                    if (!this.probeInProgress)
                        this.planOnce();
                }, backoff);
                return;
            }
            this.planOnce();
        }, interval);
    }
    // create an inline worker (per-request) via Blob that accepts a small state snapshot and returns a trivial plan
    createWorkerForRequest() {
        // Prefer using external probe worker script when available to avoid inline blob creation
        try {
            const probeScript = "dist/ai_probe_worker.js";
            const w = new Worker(probeScript);
            return { worker: w, url: probeScript };
        }
        catch (e) {
            // fall back to inline Blob generation below when external worker can't be created
        }
        // reuse a cached blob URL when available to avoid creating many Blob objects
        try {
            if (this.cachedWorkerBlobUrl) {
                const w = new Worker(this.cachedWorkerBlobUrl);
                return { worker: w, url: this.cachedWorkerBlobUrl };
            }
        }
        catch (e) { }
        const code = "(" + aiProbeWorkerMain.toString() + ")();";
        const blob = new Blob([code], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        try {
            this.cachedWorkerBlobUrl = url;
        }
        catch (e) { }
        const w = new Worker(url);
        return { worker: w, url };
    }
    // create a probe worker; prefer external file `dist/ai_probe_worker.js` when available
    createProbeWorkerForRequest() {
        const probeScript = "dist/ai_probe_worker.js";
        // Always use the external probe worker; let errors bubble up if unavailable
        const w = new Worker(probeScript);
        return { worker: w, url: probeScript };
    }
    onWorkerMessage(msg) {
        var _a, _b;
        try {
            if (!msg || !msg.reqId)
                return;
            const reqId = msg.reqId;
            // clear any pending early-fallback timer for this request
            try {
                const ef = this.earlyFallbackTimers.get(reqId);
                if (ef) {
                    clearTimeout(ef);
                }
                this.earlyFallbackTimers.delete(reqId);
            }
            catch (e) { }
            // progress/heartbeat messages from worker - extend timeout and log, do not treat as final
            if (msg.type === "progress" || msg.type === "heartbeat") {
                try {
                    // only accept progress from known active workers
                    if (!this.activeWorkers.has(reqId))
                        return;
                    const p = msg.progress || msg.heartbeat || {};
                    try {
                        this.recordProfile({
                            event: "worker-progress",
                            reqId,
                            progress: p,
                        });
                    }
                    catch (e) { }
                    this.logs.push(`req:${reqId} progress depth:${p.depth} exp:${p.expandedNodes} placed:${p.placementsConsidered} t:${p.timeMs}`);
                }
                catch (e) { }
                // re-arm per-worker plan timeout so worker isn't prematurely considered timed out
                try {
                    const prev = this.workerTimeouts.get(reqId);
                    if (prev) {
                        try {
                            clearTimeout(prev);
                        }
                        catch (e) { }
                    }
                    this.workerTimeouts.set(reqId, setTimeout(() => {
                        try {
                            if (!this.activeWorkers.has(reqId))
                                return;
                            this.logs.push(`req:${reqId} timeout, performing sync fallback`);
                            // if a fallback already applied, just terminate this worker
                            if (this.appliedFallbacks.has(reqId)) {
                                try {
                                    const info = this.activeWorkers.get(reqId);
                                    if (info) {
                                        try {
                                            info.worker.postMessage({ type: "cancel", reqId });
                                        }
                                        catch (e) { }
                                    }
                                }
                                catch (e) { }
                                try {
                                    this.terminateActiveWorker(reqId);
                                }
                                catch (e) { }
                                this.workerTimeouts.delete(reqId);
                                return;
                            }
                            try {
                                const info = this.activeWorkers.get(reqId);
                                if (info) {
                                    try {
                                        info.worker.postMessage({ type: "cancel", reqId });
                                    }
                                    catch (e) { }
                                    setTimeout(() => {
                                        try {
                                            this.terminateActiveWorker(reqId);
                                        }
                                        catch (e) { }
                                    }, 150);
                                }
                            }
                            catch (e) { }
                            try {
                                this.game.setAllowHold1(false);
                                this.game.setAllowHold2(false);
                            }
                            catch (e) { }
                            const state = this.game.getState();
                            const fallback = this.syncFallbackPlan(state);
                            try {
                                this.game.setAllowHold1(true);
                                this.game.setAllowHold2(true);
                            }
                            catch (e) { }
                            try {
                                if (this.disableInputDuringRun)
                                    window.input &&
                                        typeof window.input.setLocked === "function" &&
                                        window.input.setLocked(false);
                            }
                            catch (e) { }
                            this.handlePlanResult(fallback);
                        }
                        catch (e) {
                            try {
                                this.logs.push("worker timeout handler error: " + String(e));
                            }
                            catch (_) { }
                        }
                        try {
                            this.workerTimeouts.delete(reqId);
                        }
                        catch (e) { }
                    }, this.getPlanTimeoutMs()));
                }
                catch (e) { }
                return;
            }
            // ignore responses from unknown workers
            if (!this.activeWorkers.has(reqId))
                return;
            // If worker sent an intermediate (best-so-far) plan, handle it without terminating the worker.
            if (msg && msg.plan && msg.intermediate) {
                try {
                    const result = { plan: msg.plan, score: msg.score, sig: msg.sig };
                    try {
                        this.recordProfile({
                            event: "worker-intermediate",
                            reqId,
                            plan: msg.plan,
                            score: msg.score,
                            sig: msg.sig,
                            profile: msg.profile || null,
                        });
                    }
                    catch (e) { }
                    this.logs.push(`req:${reqId} worker-intermediate sig:${result.sig} score:${result.score}`);
                    // compare against any applied fallback and possibly overwrite
                    if (this.appliedFallbacks.has(reqId)) {
                        try {
                            const applied = this.appliedFallbacks.get(reqId);
                            let appliedSigObj = null;
                            try {
                                appliedSigObj =
                                    applied && applied.parsedSig
                                        ? applied.parsedSig
                                        : applied && applied.sig
                                            ? JSON.parse(applied.sig)
                                            : null;
                            }
                            catch (e) {
                                appliedSigObj = null;
                            }
                            let resultSigObj = null;
                            try {
                                resultSigObj =
                                    result && result.sig ? JSON.parse(result.sig) : null;
                            }
                            catch (e) {
                                resultSigObj = null;
                            }
                            const sameInitialPiece = appliedSigObj &&
                                resultSigObj &&
                                typeof appliedSigObj === "object" &&
                                typeof resultSigObj === "object" &&
                                "current" in appliedSigObj &&
                                "current" in resultSigObj &&
                                String(appliedSigObj["current"]) ===
                                    String(resultSigObj["current"]);
                            const workerScore = typeof result.score === "number" ? result.score : 0;
                            const appliedScore = applied && typeof applied.score === "number"
                                ? applied.score
                                : 0;
                            try {
                                this.logs.push(`req:${reqId} intermediate worker vs applied: workerScore=${workerScore} appliedScore=${appliedScore} sameInitialPiece=${sameInitialPiece}`);
                            }
                            catch (e) { }
                            const delta = typeof this.WORKER_OVERWRITE_SCORE_DELTA === "number"
                                ? this.WORKER_OVERWRITE_SCORE_DELTA
                                : 0;
                            const minMs = typeof this.WORKER_MIN_PROFILE_MS_FOR_RELAX === "number"
                                ? this.WORKER_MIN_PROFILE_MS_FOR_RELAX
                                : 0;
                            const workerTime = msg &&
                                msg.profile &&
                                typeof msg.profile.totalTimeMs === "number"
                                ? msg.profile.totalTimeMs
                                : 0;
                            const allowRelax = workerTime >= minMs && workerScore >= appliedScore - delta;
                            if (sameInitialPiece &&
                                (workerScore > appliedScore || allowRelax)) {
                                this.logs.push(`req:${reqId} intermediate-overwrite applied (workerScore=${workerScore} appliedScore=${appliedScore} time=${workerTime}ms)`);
                                this.handlePlanResult(result);
                                // update appliedFallbacks to reflect this applied intermediate result
                                try {
                                    this.appliedFallbacks.set(reqId, {
                                        sig: (_a = result.sig) !== null && _a !== void 0 ? _a : "",
                                        score: workerScore,
                                        parsedSig: result.sig ? JSON.parse(result.sig) : null,
                                        snapshot: applied ? applied.snapshot : undefined,
                                        appliedAt: Date.now(),
                                    });
                                }
                                catch (e) { }
                            }
                            else {
                                this.logs.push(`req:${reqId} intermediate ignored (fallback in use or stale)`);
                            }
                        }
                        catch (e) {
                            try {
                                this.logs.push("intermediate overwrite handling error: " + String(e));
                            }
                            catch (_) { }
                        }
                    }
                    else {
                        // no applied fallback: treat intermediate as usable plan
                        try {
                            this.logs.push(`req:${reqId} intermediate result applied (no prior fallback)`);
                        }
                        catch (e) { }
                        this.handlePlanResult(result);
                    }
                    // re-arm per-worker timeout so worker isn't prematurely considered timed out
                    try {
                        const prev = this.workerTimeouts.get(reqId);
                        if (prev) {
                            try {
                                clearTimeout(prev);
                            }
                            catch (e) { }
                        }
                        this.workerTimeouts.set(reqId, setTimeout(() => {
                            try {
                                if (!this.activeWorkers.has(reqId))
                                    return;
                                this.logs.push(`req:${reqId} timeout, performing sync fallback`);
                                if (this.appliedFallbacks.has(reqId)) {
                                    try {
                                        const info = this.activeWorkers.get(reqId);
                                        if (info) {
                                            try {
                                                info.worker.postMessage({ type: "cancel", reqId });
                                            }
                                            catch (e) { }
                                        }
                                    }
                                    catch (e) { }
                                    try {
                                        this.terminateActiveWorker(reqId);
                                    }
                                    catch (e) { }
                                    this.workerTimeouts.delete(reqId);
                                    return;
                                }
                                try {
                                    const info = this.activeWorkers.get(reqId);
                                    if (info) {
                                        try {
                                            info.worker.postMessage({ type: "cancel", reqId });
                                        }
                                        catch (e) { }
                                        setTimeout(() => {
                                            try {
                                                this.terminateActiveWorker(reqId);
                                            }
                                            catch (e) { }
                                        }, 150);
                                    }
                                }
                                catch (e) { }
                                try {
                                    this.game.setAllowHold1(false);
                                    this.game.setAllowHold2(false);
                                }
                                catch (e) { }
                                const fallback = this.syncFallbackPlan(this.game.getState());
                                try {
                                    this.game.setAllowHold1(true);
                                    this.game.setAllowHold2(true);
                                }
                                catch (e) { }
                                try {
                                    if (this.disableInputDuringRun)
                                        window.input &&
                                            typeof window.input.setLocked === "function" &&
                                            window.input.setLocked(false);
                                }
                                catch (e) { }
                                this.handlePlanResult(fallback);
                            }
                            catch (e) {
                                try {
                                    this.logs.push("worker timeout handler error: " + String(e));
                                }
                                catch (_) { }
                            }
                            try {
                                this.workerTimeouts.delete(reqId);
                            }
                            catch (e) { }
                        }, this.getPlanTimeoutMs()));
                    }
                    catch (e) { }
                }
                catch (e) {
                    try {
                        this.logs.push("intermediate handling error: " + String(e));
                    }
                    catch (er) { }
                }
                return;
            }
            // final/cancel/error messages: clear per-worker timeout and early-fallback timers and process normally
            try {
                const t = this.workerTimeouts.get(reqId);
                if (t) {
                    clearTimeout(t);
                }
                this.workerTimeouts.delete(reqId);
            }
            catch (e) { }
            try {
                const ef = this.earlyFallbackTimers.get(reqId);
                if (ef) {
                    clearTimeout(ef);
                }
                this.earlyFallbackTimers.delete(reqId);
            }
            catch (e) { }
            if (this.pendingReqId === reqId)
                this.pendingReqId = null;
            // cleanup any active worker for this request
            try {
                this.terminateActiveWorker(reqId);
            }
            catch (e) { }
            if (msg.cancelled) {
                try {
                    this.recordProfile({
                        event: "worker-cancel",
                        reqId,
                        profile: msg.profile || null,
                    });
                }
                catch (e) { }
                this.logs.push(`req:${reqId} worker-cancelled`);
                const state = this.game.getState();
                const fallback = this.syncFallbackPlan(state);
                this.handlePlanResult(fallback);
                return;
            }
            if (msg.error) {
                try {
                    this.recordProfile({
                        event: "worker-error",
                        reqId,
                        error: msg.error,
                        profile: msg.profile || null,
                    });
                }
                catch (e) { }
                this.logs.push(`req:${reqId} worker-error:${msg.error}`);
                // fallback
                const state = this.game.getState();
                const fallback = this.syncFallbackPlan(state);
                this.handlePlanResult(fallback);
                return;
            }
            const result = { plan: msg.plan, score: msg.score, sig: msg.sig };
            this.logs.push(`req:${reqId} worker-result sig:${result.sig} score:${result.score}`);
            if (msg.profile) {
                try {
                    const p = msg.profile;
                    const d0 = p.depthProfile && p.depthProfile[0]
                        ? p.depthProfile[0].timeMs
                        : "n/a";
                    this.logs.push(`req:${reqId} profile totalMs:${p.totalTimeMs} gen:${p.placementGeneratedCount} hits:${p.placementCacheHits} misses:${p.placementCacheMisses} d0:${d0}`);
                }
                catch (e) { }
            }
            try {
                this.recordProfile({
                    event: "worker-final",
                    reqId,
                    plan: result.plan,
                    score: result.score,
                    sig: result.sig,
                    profile: msg.profile || null,
                });
            }
            catch (e) { }
            // detect repeats
            if (this.lastPlanSig && result.sig === this.lastPlanSig) {
                this.repeatCount++;
            }
            else {
                this.repeatCount = 0;
                this.lastPlanSig = (_b = result.sig) !== null && _b !== void 0 ? _b : null;
            }
            // if we already applied a synchronous fallback for this worker, decide whether to overwrite
            if (this.appliedFallbacks.has(reqId)) {
                try {
                    const applied = this.appliedFallbacks.get(reqId);
                    // compare parsed sigs (initial piece at planning time) so worker results
                    // can overwrite an applied fallback even after the game progressed.
                    let appliedSigObj = null;
                    try {
                        appliedSigObj =
                            applied && applied.parsedSig
                                ? applied.parsedSig
                                : applied && applied.sig
                                    ? JSON.parse(applied.sig)
                                    : null;
                    }
                    catch (e) {
                        appliedSigObj = null;
                    }
                    let resultSigObj = null;
                    try {
                        resultSigObj = result && result.sig ? JSON.parse(result.sig) : null;
                    }
                    catch (e) {
                        resultSigObj = null;
                    }
                    const sameInitialPiece = appliedSigObj &&
                        resultSigObj &&
                        appliedSigObj.current &&
                        resultSigObj.current &&
                        appliedSigObj.current === resultSigObj.current;
                    const workerScore = typeof result.score === "number" ? result.score : 0;
                    const appliedScore = typeof applied.score === "number" ? applied.score : 0;
                    try {
                        this.logs.push(`req:${reqId} worker vs applied: workerScore=${workerScore} appliedScore=${appliedScore} sameInitialPiece=${sameInitialPiece} workerSig:${result.sig} appliedSig:${applied.sig}`);
                    }
                    catch (e) { }
                    // prefer worker result if it's for the same initial piece and has a better score
                    // or if the worker performed meaningful work (profile.totalTimeMs) and
                    // its score is within a small delta of the applied fallback.
                    try {
                        const delta = typeof this.WORKER_OVERWRITE_SCORE_DELTA === "number"
                            ? this.WORKER_OVERWRITE_SCORE_DELTA
                            : 0;
                        const minMs = typeof this.WORKER_MIN_PROFILE_MS_FOR_RELAX === "number"
                            ? this.WORKER_MIN_PROFILE_MS_FOR_RELAX
                            : 0;
                        const workerTime = msg && msg.profile && typeof msg.profile.totalTimeMs === "number"
                            ? msg.profile.totalTimeMs
                            : 0;
                        const allowRelax = workerTime >= minMs && workerScore >= appliedScore - delta;
                        if (sameInitialPiece &&
                            (workerScore > appliedScore || allowRelax)) {
                            this.logs.push(`req:${reqId} worker-overwrite applied (workerScore=${workerScore} appliedScore=${appliedScore} time=${workerTime}ms)`);
                            this.handlePlanResult(result);
                        }
                        else {
                            this.logs.push(`req:${reqId} worker-result ignored (fallback in use or stale)`);
                        }
                    }
                    catch (e) {
                        this.logs.push(`req:${reqId} worker overwrite decision error: ${String(e)}`);
                    }
                }
                catch (e) {
                    try {
                        this.logs.push("worker overwrite handling error: " + String(e));
                    }
                    catch (_) { }
                }
                try {
                    this.appliedFallbacks.delete(reqId);
                }
                catch (e) { }
            }
            else {
                if (this.repeatCount >= this.REPEAT_PLAN_THRESHOLD) {
                    // repeated results -> use synchronous fallback and log
                    this.logs.push(`req:${reqId} repeated-sig threshold reached, using sync fallback`);
                    const state = this.game.getState();
                    const fallback = this.syncFallbackPlan(state);
                    this.handlePlanResult(fallback);
                }
                else {
                    this.handlePlanResult(result);
                }
            }
        }
        catch (e) {
            try {
                this.logs.push("worker message handling error: " + String(e));
            }
            catch (er) { }
        }
    }
    planOnce() {
        try {
            if (this.disableInputDuringRun)
                window.input &&
                    typeof window.input.setLocked === "function" &&
                    window.input.setLocked(true);
        }
        catch (e) { }
        // if a probe/sweep has locked planning, skip starting a new worker
        if (this.probeInProgress) {
            try {
                this.logs.push(`plan aborted: probeInProgress`);
            }
            catch (e) { }
            try {
                this.scheduleNext();
            }
            catch (e) { }
            return;
        }
        const state = this.game.getState();
        const reqId = `${Date.now()}-${++this.reqCounter}`;
        this.pendingReqId = reqId;
        this.logs.push(`req:${reqId} start lookahead=${this.lookahead}`);
        try {
            this.recordProfile({
                event: "plan-start",
                reqId,
                lookahead: this.lookahead,
                params: {
                    beamWidthBase: this.beamWidthBase,
                    perNodeLimit: this.perNodeLimit,
                },
            });
        }
        catch (e) { }
        try {
            // enforce max concurrent workers: if at limit, terminate the oldest to free a slot
            try {
                if (this.activeWorkers.size >= this.getEffectiveMaxWorkers()) {
                    // Prefer terminating the oldest worker that has NOT had an early synchronous fallback applied,
                    // so that workers which might still overwrite an applied fallback are preserved.
                    // find an active worker that has NOT yet had a fallback applied (prefer to kill that)
                    let oldestToKill = null;
                    for (const k of this.activeWorkers.keys()) {
                        if (!this.appliedFallbacks.has(k)) {
                            oldestToKill = k;
                            break;
                        }
                    }
                    // if every active worker already has an applied fallback, pick the oldest applied one
                    if (!oldestToKill) {
                        try {
                            const now = Date.now();
                            let candidate = null;
                            let candidateAge = -1;
                            for (const k of this.activeWorkers.keys()) {
                                try {
                                    const app = this.appliedFallbacks.get(k);
                                    const age = app && typeof app.appliedAt === "number"
                                        ? now - app.appliedAt
                                        : -1;
                                    if (age > candidateAge) {
                                        candidate = k;
                                        candidateAge = age;
                                    }
                                }
                                catch (e) { }
                            }
                            if (!candidate) {
                                try {
                                    this.logs.push(`max workers busy and all have applied fallbacks; deferring start`);
                                }
                                catch (e) { }
                                try {
                                    this.scheduleNext();
                                }
                                catch (e) { }
                                return;
                            }
                            // If the oldest-applied fallback is still recent, defer starting a new worker
                            if (candidateAge < this.APPLIED_FALLBACK_TTL_MS) {
                                try {
                                    this.logs.push(`req:${candidate} all workers applied but oldest age=${candidateAge}ms < TTL=${this.APPLIED_FALLBACK_TTL_MS}; deferring start`);
                                }
                                catch (e) { }
                                try {
                                    this.scheduleNext();
                                }
                                catch (e) { }
                                return;
                            }
                            // otherwise terminate the oldest applied worker to free a slot
                            try {
                                this.logs.push(`req:${candidate} oldest-applied-stale, terminating to free slot (age=${candidateAge}ms)`);
                            }
                            catch (e) { }
                            try {
                                const info = this.activeWorkers.get(candidate);
                                if (info) {
                                    try {
                                        info.worker.postMessage({
                                            type: "cancel",
                                            reqId: candidate,
                                        });
                                    }
                                    catch (e) { }
                                    setTimeout(() => {
                                        try {
                                            this.terminateActiveWorker(candidate);
                                        }
                                        catch (e) { }
                                    }, 120);
                                }
                            }
                            catch (e) { }
                        }
                        catch (e) {
                            try {
                                this.logs.push(`max workers busy fallback-candidate selection error: ${String(e)}`);
                            }
                            catch (e) { }
                            try {
                                this.scheduleNext();
                            }
                            catch (e) { }
                            return;
                        }
                    }
                    else {
                        const killKey = oldestToKill;
                        try {
                            this.logs.push(`req:${killKey} oldest-worker-terminated to free slot`);
                        }
                        catch (e) { }
                        try {
                            const info = this.activeWorkers.get(killKey);
                            if (info) {
                                try {
                                    info.worker.postMessage({ type: "cancel", reqId: killKey });
                                }
                                catch (e) { }
                                setTimeout(() => {
                                    try {
                                        this.terminateActiveWorker(killKey);
                                    }
                                    catch (e) { }
                                }, 120);
                            }
                        }
                        catch (e) { }
                    }
                }
            }
            catch (e) { }
            const created = this.acquireWorker();
            // adaptive/fast hints: when AI is sped up, ask worker to reduce per-node work
            const fastMode = this.speedMultiplier > 1.5 || this.MIN_SCHEDULE_INTERVAL_MS < 30;
            // pack board into a Uint32Array (bit-rows) and transfer buffer to worker to avoid structured-clone cost
            const boardBits = this.packBoardToUint32(state && state.board ? state.board : []);
            const payload = {
                reqId,
                lookahead: this.lookahead,
                weights: {
                    wLines: this.weightLines,
                    wAgg: this.weightAgg,
                    wHoles: this.weightHoles,
                    wBump: this.weightBump,
                    holdPenalty: this.holdPenalty,
                },
                params: {
                    beamWidthBase: this.beamWidthBase,
                    perNodeLimit: this.perNodeLimit,
                    adaptive: true,
                    fastMode: fastMode,
                    timeoutMs: this.getPlanTimeoutMs(),
                },
                state: {
                    board: boardBits,
                    next: (state.next || []).slice(0, this.lookahead),
                    hold: state.hold,
                    current: state.current
                        ? {
                            type: state.current.type,
                            x: state.current.x,
                            y: state.current.y,
                            rotation: state.current.rotation,
                        }
                        : null,
                },
            };
            // register worker in activeWorkers map and send payload
            const w = created.worker;
            const url = created.url;
            try {
                this.recordProfile({ event: "worker-created", reqId, url });
            }
            catch (e) { }
            this.activeWorkers.set(reqId, {
                worker: w,
                url,
                pooled: !!(created && created.pooled),
            });
            w.onmessage = (ev) => {
                try {
                    if (this.debug) {
                        try {
                            this.logs.push(`raw-msg:${reqId}:${JSON.stringify(ev.data)}`);
                        }
                        catch (e) { }
                    }
                    this.onWorkerMessage(ev.data);
                }
                catch (err) {
                    try {
                        this.logs.push("onmessage handling failed: " + String(err));
                    }
                    catch (_) { }
                }
            };
            try {
                const transfers = [];
                if (payload &&
                    payload.state &&
                    payload.state.board &&
                    payload.state.board.buffer)
                    transfers.push(payload.state.board.buffer);
                w.postMessage(payload, transfers);
            }
            catch (e) {
                this.logs.push(`req:${reqId} postMessage failed: ${String(e)}`);
                try {
                    this.terminateActiveWorker(reqId);
                }
                catch (er) { }
                const fallback = this.syncFallbackPlan(state);
                this.handlePlanResult(fallback);
                return;
            }
            // start per-worker timeout (PLAN_TIMEOUT_MS)
            if (this.workerTimeouts.has(reqId)) {
                try {
                    clearTimeout(this.workerTimeouts.get(reqId));
                }
                catch (e) { }
                this.workerTimeouts.delete(reqId);
            }
            this.workerTimeouts.set(reqId, setTimeout(() => {
                try {
                    if (!this.activeWorkers.has(reqId))
                        return;
                    this.logs.push(`req:${reqId} timeout, performing sync fallback`);
                    // if a fallback already applied, just terminate this worker
                    if (this.appliedFallbacks.has(reqId)) {
                        try {
                            const info = this.activeWorkers.get(reqId);
                            if (info) {
                                try {
                                    info.worker.postMessage({ type: "cancel", reqId });
                                }
                                catch (e) { }
                            }
                        }
                        catch (e) { }
                        try {
                            this.terminateActiveWorker(reqId);
                        }
                        catch (e) { }
                        this.workerTimeouts.delete(reqId);
                        return;
                    }
                    // cooperative cancel then terminate after grace
                    try {
                        const info = this.activeWorkers.get(reqId);
                        if (info) {
                            try {
                                info.worker.postMessage({ type: "cancel", reqId });
                            }
                            catch (e) { }
                            setTimeout(() => {
                                try {
                                    this.terminateActiveWorker(reqId);
                                }
                                catch (e) { }
                            }, 150);
                        }
                    }
                    catch (e) { }
                    try {
                        this.game.setAllowHold1(false);
                        this.game.setAllowHold2(false);
                    }
                    catch (e) { }
                    const fallback = this.syncFallbackPlan(state);
                    try {
                        this.game.setAllowHold1(true);
                        this.game.setAllowHold2(true);
                    }
                    catch (e) { }
                    try {
                        if (this.disableInputDuringRun)
                            window.input &&
                                typeof window.input.setLocked === "function" &&
                                window.input.setLocked(false);
                    }
                    catch (e) { }
                    this.handlePlanResult(fallback);
                }
                catch (e) {
                    try {
                        this.logs.push("worker timeout handler error: " + String(e));
                    }
                    catch (_) { }
                }
                try {
                    this.workerTimeouts.delete(reqId);
                }
                catch (e) { }
            }, this.getPlanTimeoutMs()));
            // start early fallback timer to ensure a quick response if worker is slow
            if (this.earlyFallbackTimers.has(reqId)) {
                try {
                    clearTimeout(this.earlyFallbackTimers.get(reqId));
                }
                catch (e) { }
                this.earlyFallbackTimers.delete(reqId);
            }
            this.earlyFallbackTimers.set(reqId, setTimeout(() => {
                try {
                    if (!this.activeWorkers.has(reqId))
                        return;
                    this.logs.push(`req:${reqId} early-fallback (ms=${this.EARLY_FALLBACK_MS})`);
                    // apply immediate synchronous fallback but keep the worker running
                    try {
                        this.game.setAllowHold1(false);
                        this.game.setAllowHold2(false);
                    }
                    catch (e) { }
                    const fallback = this.syncFallbackPlan(state);
                    // record applied fallback (store parsed sig + snapshot) so worker final can be compared later
                    try {
                        let parsed = null;
                        try {
                            parsed =
                                fallback && fallback.sig ? JSON.parse(fallback.sig) : null;
                        }
                        catch (e) {
                            parsed = null;
                        }
                        const snap = {
                            board: state && state.board
                                ? (state.board || []).map((r) => r.slice())
                                : null,
                            next: state && state.next ? (state.next || []).slice() : null,
                            hold: state && state.hold ? state.hold : null,
                            current: state && state.current ? state.current.type : null,
                        };
                        this.appliedFallbacks.set(reqId, {
                            sig: fallback.sig,
                            score: fallback.score || 0,
                            parsedSig: parsed,
                            snapshot: snap,
                            appliedAt: Date.now(),
                        });
                        try {
                            this.recordProfile({
                                event: "fallback-applied",
                                reqId,
                                sig: fallback.sig,
                                score: fallback.score || 0,
                            });
                        }
                        catch (e) { }
                    }
                    catch (e) { }
                    try {
                        this.logs.push(`req:${reqId} fallback-applied sig:${fallback.sig} score:${fallback.score || 0}`);
                    }
                    catch (e) { }
                    try {
                        this.game.setAllowHold1(true);
                        this.game.setAllowHold2(true);
                    }
                    catch (e) { }
                    try {
                        if (this.disableInputDuringRun)
                            window.input &&
                                typeof window.input.setLocked === "function" &&
                                window.input.setLocked(false);
                    }
                    catch (e) { }
                    this.handlePlanResult(fallback);
                }
                catch (e) {
                    try {
                        this.logs.push("early-fallback error: " + String(e));
                    }
                    catch (er) { }
                }
                try {
                    const t = this.earlyFallbackTimers.get(reqId);
                    if (t) {
                        clearTimeout(t);
                    }
                    this.earlyFallbackTimers.delete(reqId);
                }
                catch (e) { }
            }, this.EARLY_FALLBACK_MS));
        }
        catch (e) {
            this.logs.push(`req:${reqId} postMessage failed: ${String(e)}`);
            const fallback = this.syncFallbackPlan(state);
            this.handlePlanResult(fallback);
            return;
        }
        // per-worker timeout is handled via set in workerTimeouts map
    }
    terminateActiveWorker(reqId) {
        try {
            if (typeof reqId === "string") {
                const info = this.activeWorkers.get(reqId);
                if (info) {
                    // if worker was pooled, return it to pool rather than terminating
                    if (info.pooled) {
                        try {
                            for (const p of this.workerPool) {
                                if (p.worker === info.worker) {
                                    p.busy = false;
                                    break;
                                }
                            }
                        }
                        catch (e) { }
                        try {
                            info.worker.onmessage = (ev) => {
                                try {
                                    this.onWorkerMessage(ev.data);
                                }
                                catch (e) { }
                            };
                        }
                        catch (e) { }
                    }
                    else {
                        try {
                            info.worker.terminate();
                        }
                        catch (e) { }
                        try {
                            if (info.url && info.url !== this.cachedWorkerBlobUrl) {
                                URL.revokeObjectURL(info.url);
                            }
                        }
                        catch (e) { }
                    }
                    this.activeWorkers.delete(reqId);
                }
                const t = this.workerTimeouts.get(reqId);
                if (t) {
                    try {
                        clearTimeout(t);
                    }
                    catch (e) { }
                    this.workerTimeouts.delete(reqId);
                }
                const ef = this.earlyFallbackTimers.get(reqId);
                if (ef) {
                    try {
                        clearTimeout(ef);
                    }
                    catch (e) { }
                    this.earlyFallbackTimers.delete(reqId);
                }
                try {
                    this.appliedFallbacks.delete(reqId);
                }
                catch (e) { }
                return;
            }
            // terminate all
            for (const [rid, info] of Array.from(this.activeWorkers.entries())) {
                try {
                    if (info.pooled) {
                        try {
                            for (const p of this.workerPool) {
                                if (p.worker === info.worker) {
                                    p.busy = false;
                                    break;
                                }
                            }
                        }
                        catch (e) { }
                        try {
                            info.worker.onmessage = (ev) => {
                                try {
                                    this.onWorkerMessage(ev.data);
                                }
                                catch (e) { }
                            };
                        }
                        catch (e) { }
                    }
                    else {
                        try {
                            info.worker.terminate();
                        }
                        catch (e) { }
                        try {
                            if (info.url && info.url !== this.cachedWorkerBlobUrl) {
                                URL.revokeObjectURL(info.url);
                            }
                        }
                        catch (e) { }
                    }
                }
                catch (e) { }
                this.activeWorkers.delete(rid);
                const t = this.workerTimeouts.get(rid);
                if (t) {
                    try {
                        clearTimeout(t);
                    }
                    catch (e) { }
                    this.workerTimeouts.delete(rid);
                }
                const ef = this.earlyFallbackTimers.get(rid);
                if (ef) {
                    try {
                        clearTimeout(ef);
                    }
                    catch (e) { }
                    this.earlyFallbackTimers.delete(rid);
                }
                try {
                    this.appliedFallbacks.delete(rid);
                }
                catch (e) { }
            }
        }
        catch (e) { }
    }
    // Probe current (or provided) state with specified params/weights using a transient worker.
    // Returns a promise resolving to worker result { plan, score, sig } or { cancelled:true } or { error }
    async probeStateWithParams(state, weights = {}, params = {}, timeoutMs = 700) {
        // ensure AI is stopped and any active worker cleaned up before creating a transient probe worker
        // Use disableAndWait to reliably cancel/terminate any active worker and clear schedule timers.
        const wasEnabledBeforeProbe = this.enabled;
        let disabledByProbe = false;
        try {
            // attempt to disable and wait; keep lock true so probeStateWithParams will clear it when done
            // reduce wait to avoid long probe setup overhead (short-circuit to 200ms)
            await this.disableAndWait(200, true);
            disabledByProbe = wasEnabledBeforeProbe;
        }
        catch (e) {
            // proceed anyway
        }
        // log probe start and params for diagnostics
        try {
            this.logs.push(`probe start lookahead=${(params && params.lookahead) || this.lookahead} bw=${params && params.beamWidthBase} pnl=${params && params.perNodeLimit}`);
        }
        catch (e) { }
        const ret = new Promise((resolve) => {
            try {
                // create a dedicated probe worker (prefer external probe script)
                const created = this.createProbeWorkerForRequest();
                const w = created.worker;
                const url = created.url;
                const pooled = false;
                const originalOnMessage = null;
                let done = false;
                let graceTimer = null;
                let timer = setTimeout(() => {
                    if (done)
                        return;
                    try {
                        w.postMessage({ type: "cancel" });
                    }
                    catch (e) { }
                    // short grace period
                    graceTimer = setTimeout(() => {
                        if (done)
                            return;
                        done = true;
                        if (pooled) {
                            try {
                                /* restore handler and mark pool idle */ w.onmessage =
                                    originalOnMessage ||
                                        ((ev) => {
                                            try {
                                                this.onWorkerMessage(ev.data);
                                            }
                                            catch (e) { }
                                        });
                            }
                            catch (e) { }
                            try {
                                /* restore handler and mark pool idle */ w.onmessage =
                                    originalOnMessage ||
                                        ((ev) => {
                                            try {
                                                this.onWorkerMessage(ev.data);
                                            }
                                            catch (e) { }
                                        });
                            }
                            catch (e) { }
                            try {
                                for (const p of this.workerPool) {
                                    if (p.worker === w) {
                                        p.busy = false;
                                        break;
                                    }
                                }
                            }
                            catch (e) { }
                        }
                        else {
                            try {
                                w.terminate();
                            }
                            catch (e) { }
                            try {
                                if (url && url !== this.cachedWorkerBlobUrl) {
                                    URL.revokeObjectURL(url);
                                }
                            }
                            catch (e) { }
                        }
                        resolve({ timeout: true });
                    }, 350);
                }, timeoutMs);
                w.onmessage = (ev) => {
                    if (done)
                        return;
                    const msg = ev.data || {};
                    // progress heartbeat: reset timeout
                    if (msg && msg.type === "progress") {
                        try {
                            clearTimeout(timer);
                        }
                        catch (e) { }
                        timer = setTimeout(() => {
                            if (done)
                                return;
                            try {
                                w.postMessage({ type: "cancel" });
                            }
                            catch (e) { }
                            graceTimer = setTimeout(() => {
                                if (done)
                                    return;
                                done = true;
                                if (pooled) {
                                    try {
                                        w.onmessage =
                                            originalOnMessage ||
                                                ((ev) => {
                                                    try {
                                                        this.onWorkerMessage(ev.data);
                                                    }
                                                    catch (e) { }
                                                });
                                    }
                                    catch (e) { }
                                    try {
                                        w.onmessage =
                                            originalOnMessage ||
                                                ((ev) => {
                                                    try {
                                                        this.onWorkerMessage(ev.data);
                                                    }
                                                    catch (e) { }
                                                });
                                    }
                                    catch (e) { }
                                    try {
                                        for (const p of this.workerPool) {
                                            if (p.worker === w) {
                                                p.busy = false;
                                                break;
                                            }
                                        }
                                    }
                                    catch (e) { }
                                }
                                else {
                                    try {
                                        w.terminate();
                                    }
                                    catch (e) { }
                                    try {
                                        if (url && url !== this.cachedWorkerBlobUrl) {
                                            URL.revokeObjectURL(url);
                                        }
                                    }
                                    catch (e) { }
                                }
                                resolve({ timeout: true });
                            }, 350);
                        }, timeoutMs);
                        return;
                    }
                    // final/cancel/error
                    done = true;
                    try {
                        clearTimeout(timer);
                    }
                    catch (e) { }
                    if (graceTimer) {
                        try {
                            clearTimeout(graceTimer);
                        }
                        catch (e) { }
                    }
                    if (pooled) {
                        try {
                            w.onmessage =
                                originalOnMessage ||
                                    ((ev) => {
                                        try {
                                            this.onWorkerMessage(ev.data);
                                        }
                                        catch (e) { }
                                    });
                        }
                        catch (e) { }
                        try {
                            w.onmessage =
                                originalOnMessage ||
                                    ((ev) => {
                                        try {
                                            this.onWorkerMessage(ev.data);
                                        }
                                        catch (e) { }
                                    });
                        }
                        catch (e) { }
                        try {
                            for (const p of this.workerPool) {
                                if (p.worker === w) {
                                    p.busy = false;
                                    break;
                                }
                            }
                        }
                        catch (e) { }
                    }
                    else {
                        try {
                            w.terminate();
                        }
                        catch (e) { }
                        try {
                            if (url && url !== this.cachedWorkerBlobUrl) {
                                URL.revokeObjectURL(url);
                            }
                        }
                        catch (e) { }
                    }
                    resolve(msg || {});
                };
                const boardBits = this.packBoardToUint32(state && state.board ? state.board : []);
                const payload = {
                    reqId: `probe-${Date.now()}`,
                    lookahead: typeof (params && params.lookahead) === "number"
                        ? params.lookahead
                        : this.lookahead,
                    weights: weights || {},
                    params: Object.assign({}, params || {}, { timeoutMs: timeoutMs }),
                    state: Object.assign({}, state, { board: boardBits }),
                };
                try {
                    const tr = [];
                    if (boardBits && boardBits.buffer)
                        tr.push(boardBits.buffer);
                    w.postMessage(payload, tr);
                }
                catch (e) {
                    clearTimeout(timer);
                    try {
                        w.terminate();
                    }
                    catch (e) { }
                    try {
                        if (url && url !== this.cachedWorkerBlobUrl) {
                            URL.revokeObjectURL(url);
                        }
                    }
                    catch (e) { }
                    resolve({ error: String(e) });
                }
            }
            catch (e) {
                resolve({ error: String(e) });
            }
        });
        // restore previous AI state and clear probe flag when probe completes (success or error)
        ret.then(() => {
            if (disabledByProbe) {
                try {
                    this.setEnabled(true);
                }
                catch (e) { }
            }
            this.probeInProgress = false;
        }, () => {
            if (disabledByProbe) {
                try {
                    this.setEnabled(true);
                }
                catch (e) { }
            }
            this.probeInProgress = false;
        });
        return ret;
    }
    // Run parameter sweep over combinations (non-destructive; pauses AI while running)
    async runParameterSweep(options = {}) {
        const beamWidths = options.beamWidths || [6, 8, 10];
        const perNodeLimits = options.perNodeLimits || [8, 12];
        const weightSets = options.weightSets || [
            {
                wLines: this.weightLines,
                wAgg: this.weightAgg,
                wHoles: this.weightHoles,
                wBump: this.weightBump,
                holdPenalty: this.holdPenalty,
            },
        ];
        const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 700;
        const trials = typeof options.trials === "number" ? options.trials : 1;
        const fastMode = !!options.fastMode;
        const probeLookaheadOverride = fastMode
            ? Math.max(1, Math.min(2, this.lookahead))
            : undefined;
        // ensure AI is paused before running sweep to avoid resource contention
        const wasEnabled = this.enabled;
        if (wasEnabled) {
            try {
                await this.disableAndWait(2000, true);
            }
            catch (e) {
                try {
                    this.setEnabled(false);
                }
                catch (e) { }
            }
        }
        const state = this.game.getState();
        const results = [];
        for (const bw of beamWidths) {
            for (const pnl of perNodeLimits) {
                for (const wset of weightSets) {
                    for (let t = 0; t < trials; t++) {
                        const start = Date.now();
                        // call probe
                        // pass weights object keys matching worker expectations
                        const weights = {
                            wLines: wset.wLines,
                            wAgg: wset.wAgg,
                            wHoles: wset.wHoles,
                            wBump: wset.wBump,
                            holdPenalty: wset.holdPenalty,
                        };
                        const params = { beamWidthBase: bw, perNodeLimit: pnl };
                        // snapshot state shallow copy
                        const st = {
                            board: (state.board || []).map((r) => r.slice()),
                            next: (state.next || []).slice(),
                            hold: state.hold,
                            current: state.current,
                        };
                        // eslint-disable-next-line no-await-in-loop
                        const probeParams = Object.assign({}, params, typeof probeLookaheadOverride === "number"
                            ? { lookahead: probeLookaheadOverride }
                            : {});
                        probeParams.timeoutMs = timeoutMs;
                        probeParams.fastMode = fastMode;
                        const res = await this.probeStateWithParams(st, weights, probeParams, timeoutMs);
                        const elapsed = Date.now() - start;
                        results.push({
                            beamWidth: bw,
                            perNodeLimit: pnl,
                            weights: weights,
                            trial: t,
                            result: res,
                            time: elapsed,
                        });
                        const rv = res;
                        this.logs.push(`sweep bw=${bw} pnl=${pnl} trial=${t} -> ${rv && (rv.score !== undefined ? "score:" + rv.score : rv.error ? "err:" + rv.error : rv.timeout ? "timeout" : "cancelled")} time=${elapsed}`);
                    }
                }
            }
        }
        // clear probe lock and restore previous enabled state
        try {
            this.probeInProgress = false;
        }
        catch (e) { }
        if (wasEnabled)
            this.setEnabled(true);
        return results;
    }
    // very small sync fallback plan (deterministic simple plan)
    syncFallbackPlan(state) {
        try {
            const sigObj = {
                next: (state.next || []).slice(0, this.lookahead),
                hold: state.hold,
                current: state.current ? state.current.type : null,
            };
            const sig = JSON.stringify(sigObj);
            const cur = state.current ? state.current.type : null;
            const board = (state.board || []).map((r) => r.slice());
            if (!cur)
                return { plan: { action: "harddrop" }, score: 0, sig };
            // quick synchronous one-ply greedy placement to avoid hold-loop.
            const SHAPES = {
                I: [
                    [0, 0, 0, 0],
                    [1, 1, 1, 1],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ],
                J: [
                    [1, 0, 0, 0],
                    [1, 1, 1, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ],
                L: [
                    [0, 0, 1, 0],
                    [1, 1, 1, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ],
                O: [
                    [0, 1, 1, 0],
                    [0, 1, 1, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ],
                S: [
                    [0, 1, 1, 0],
                    [1, 1, 0, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ],
                T: [
                    [0, 1, 0, 0],
                    [1, 1, 1, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ],
                Z: [
                    [1, 1, 0, 0],
                    [0, 1, 1, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ],
            };
            function rotateCW(m) {
                const n = m.length;
                const res = Array.from({ length: n }, () => Array(n).fill(0));
                for (let r = 0; r < n; r++)
                    for (let c = 0; c < n; c++)
                        res[c][n - 1 - r] = m[r][c];
                return res;
            }
            function getRotationMatrix(type, rot) {
                if (type === "O")
                    return SHAPES[type].map((r) => r.slice());
                let m = SHAPES[type].map((r) => r.slice());
                const r = ((rot % 4) + 4) % 4;
                for (let i = 0; i < r; i++)
                    m = rotateCW(m);
                return m;
            }
            function canPlace(board, mat, x, y) {
                const rows = board.length;
                for (let r = 0; r < mat.length; r++) {
                    for (let c = 0; c < mat[r].length; c++) {
                        if (!mat[r][c])
                            continue;
                        const bx = x + c, by = y + r;
                        if (bx < 0 || bx >= 10)
                            return false;
                        if (by >= rows)
                            return false;
                        if (by >= 0 && board[by][bx])
                            return false;
                    }
                }
                return true;
            }
            function dropY(board, mat, x, startY) {
                let y = startY;
                while (canPlace(board, mat, x, y + 1))
                    y++;
                return y;
            }
            function placeAndClear(board, mat, x, y, type) {
                const b = board.map((r) => r.slice());
                for (let r = 0; r < mat.length; r++)
                    for (let c = 0; c < mat[r].length; c++)
                        if (mat[r][c]) {
                            const bx = x + c, by = y + r;
                            if (by >= 0 && by < b.length && bx >= 0 && bx < 10)
                                b[by][bx] = type;
                        }
                let cleared = 0;
                for (let rr = b.length - 1; rr >= 0; rr--) {
                    if (b[rr].every((cell) => cell)) {
                        b.splice(rr, 1);
                        b.unshift(Array(10).fill(null));
                        cleared++;
                        rr++;
                    }
                }
                return { board: b, cleared };
            }
            function aggregateHeight(board) {
                const cols = 10, rows = board.length, heights = Array(cols).fill(0);
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        if (board[r][c]) {
                            heights[c] = rows - r;
                            break;
                        }
                    }
                }
                return heights;
            }
            function countHoles(board) {
                const rows = board.length;
                let holes = 0;
                for (let c = 0; c < 10; c++) {
                    let seen = false;
                    for (let r = 0; r < rows; r++) {
                        if (board[r][c])
                            seen = true;
                        else if (seen)
                            holes++;
                    }
                }
                return holes;
            }
            function bumpiness(heights) {
                let s = 0;
                for (let i = 0; i < heights.length - 1; i++)
                    s += Math.abs(heights[i] - heights[i + 1]);
                return s;
            }
            const evaluateBoard = (board, linesCleared) => {
                const heights = aggregateHeight(board);
                const agg = heights.reduce((a, b) => a + b, 0);
                const holes = countHoles(board);
                const bump = bumpiness(heights);
                return (linesCleared * this.weightLines -
                    agg * this.weightAgg -
                    holes * this.weightHoles -
                    bump * this.weightBump);
            };
            const placements = [];
            for (let rot = 0; rot < 4; rot++) {
                const mat = getRotationMatrix(cur, rot);
                let minC = mat[0].length, maxC = -1;
                for (let r = 0; r < mat.length; r++)
                    for (let c = 0; c < mat[r].length; c++)
                        if (mat[r][c]) {
                            if (c < minC)
                                minC = c;
                            if (c > maxC)
                                maxC = c;
                        }
                const minX = -minC;
                const maxX = 10 - 1 - maxC;
                for (let x = minX; x <= maxX; x++) {
                    const startY = -4;
                    if (!canPlace(board, mat, x, startY))
                        continue;
                    const y = dropY(board, mat, x, startY);
                    const res = placeAndClear(board, mat, x, y, cur);
                    const score = evaluateBoard(res.board, res.cleared);
                    placements.push({ x, rot, score, cleared: res.cleared });
                }
            }
            if (placements.length > 0) {
                placements.sort((a, b) => b.score - a.score);
                const best = placements[0];
                return {
                    plan: { action: "place", x: best.x, rotation: best.rot },
                    score: best.score,
                    sig,
                };
            }
            // fallback to previous simple heuristics if no placement found
            let plan = { action: "harddrop" };
            const next0 = state.next && state.next.length ? state.next[0] : null;
            if (!state.hold) {
                if (cur && (cur === "S" || cur === "Z" || cur === "O"))
                    plan = { action: "hold", slot: 1 };
                else
                    plan = { action: "harddrop" };
            }
            else {
                if (cur && state.hold !== cur) {
                    if (next0 && state.hold === next0)
                        plan = { action: "hold", slot: 1 };
                    else
                        plan = { action: "harddrop" };
                }
            }
            const score = sig.length;
            return { plan, score, sig };
        }
        catch (e) {
            return { plan: { action: "noop" }, score: 0, sig: "err" };
        }
    }
    // apply result to the game (very simple mapping) and schedule next
    handlePlanResult(result) {
        try {
            const sig = result && result.sig ? result.sig : null;
            // ignore duplicate applies within a small time window to avoid stacking the same action repeatedly
            if (sig && this.lastAppliedSig === sig) {
                const age = Date.now() - this.lastAppliedAt;
                if (age < this.APPLY_DEDUP_MS) {
                    try {
                        this.logs.push(`skip duplicate apply sig:${sig} age:${age}`);
                    }
                    catch (e) { }
                    try {
                        this.scheduleNext();
                    }
                    catch (e) { }
                    return;
                }
            }
            this.logs.push(`apply plan sig:${result.sig} action:${result.plan && result.plan.action}`);
            // perform a simple action with guards to prevent hold stacking
            try {
                if (result.plan && result.plan.action === "harddrop") {
                    if (typeof this.game.hardDrop === "function")
                        this.game.hardDrop();
                }
                else if (result.plan && result.plan.action === "hold") {
                    const slot = Number(result.plan.slot) || 1;
                    const now = Date.now();
                    const last = this.lastHoldAtBySlot.get(slot) || 0;
                    // if not forcing holds, respect debounce to avoid repeated holds stacking
                    if (!this.FORCE_APPLY_HOLDS_IN_SWEEP &&
                        now - last < this.HOLD_DEBOUNCE_MS) {
                        try {
                            this.logs.push(`skip hold apply slot:${slot} debounce age:${now - last}`);
                        }
                        catch (e) { }
                    }
                    else {
                        if (typeof this.game.holdPiece === "function")
                            this.game.holdPiece(slot);
                        // record hold timestamps
                        try {
                            this.lastHoldAt = now;
                            this.lastHoldAtBySlot.set(slot, now);
                        }
                        catch (e) { }
                    }
                }
                else if (result.plan && result.plan.action === "place") {
                    // rotate to desired orientation then move horizontally then harddrop
                    try {
                        const targetRot = Number(result.plan.rotation) || 0;
                        const targetX = Number(result.plan.x);
                        // rotate until matching target rotation (attempt up to 4 times)
                        for (let i = 0; i < 5; i++) {
                            try {
                                const cur = this.game.getState && this.game.getState().current
                                    ? this.game.getState().current
                                    : null;
                                const curRot = cur && typeof cur.rotation === "number" ? cur.rotation : 0;
                                if (curRot === targetRot)
                                    break;
                                if (typeof this.game.rotateCW === "function")
                                    this.game.rotateCW();
                            }
                            catch (e) {
                                break;
                            }
                        }
                        // move horizontally towards targetX
                        try {
                            const s = this.game.getState();
                            const curX = s.current ? s.current.x : 3;
                            let dx = Math.round(targetX - curX);
                            while (dx !== 0) {
                                if (dx > 0) {
                                    this.game.move(1, 0);
                                    dx--;
                                }
                                else {
                                    this.game.move(-1, 0);
                                    dx++;
                                }
                            }
                        }
                        catch (e) { }
                        // finally hard drop
                        if (typeof this.game.hardDrop === "function")
                            this.game.hardDrop();
                    }
                    catch (e) { }
                }
            }
            catch (e) { }
            // unlock input after action
            try {
                if (this.disableInputDuringRun)
                    window.input &&
                        typeof window.input.setLocked === "function" &&
                        window.input.setLocked(false);
            }
            catch (e) { }
            // record applied sig/time for dedupe
            try {
                this.lastAppliedSig = sig;
                this.lastAppliedAt = Date.now();
            }
            catch (e) { }
        }
        catch (e) {
            try {
                this.logs.push("handlePlanResult error: " + String(e));
            }
            catch (er) { }
        }
        // schedule next planning cycle
        try {
            this.scheduleNext();
        }
        catch (e) { }
    }
}
// Attach a small, resilient debug helper to the window so external automation
// (Playwright) can reliably query profile counts/samples without touching
// potentially fragile internals directly.
try {
    try {
        window.__getAiProfilesSummary = function () {
            try {
                const ai = window.ai;
                if (!ai)
                    return { ok: false, error: "no ai" };
                let profiles = [];
                try {
                    profiles =
                        typeof ai.getAllProfileEvents === "function"
                            ? ai.getAllProfileEvents()
                            : ai.collectedProfiles || [];
                }
                catch (e) {
                    try {
                        profiles = ai.collectedProfiles || [];
                    }
                    catch (er) {
                        profiles = [];
                    }
                }
                const len = Array.isArray(profiles) ? profiles.length : -1;
                const sample = Array.isArray(profiles) ? profiles.slice(-50) : [];
                return { ok: true, len, sample };
            }
            catch (e) {
                return { ok: false, error: String(e) };
            }
        };
    }
    catch (e) { }
}
catch (e) { }
// Force-apply API: call handlePlanResult with relaxed guards and force-hold flags.
try {
    try {
        window.__forceApplyPlan = function (planObj, reqId) {
            try {
                const ai = window.ai;
                if (!ai)
                    return { ok: false, error: "no ai" };
                const slot = planObj && planObj.plan && typeof planObj.plan.slot === "number"
                    ? planObj.plan.slot
                    : 1;
                const prevRelax = window.__RELAX_APPLY_GUARDS;
                const prevForce = ai.FORCE_APPLY_HOLDS_IN_SWEEP;
                const prevDisable = ai.DISABLE_FALLBACKS;
                try {
                    window.__RELAX_APPLY_GUARDS = true;
                    try {
                        ai.FORCE_APPLY_HOLDS_IN_SWEEP = true;
                    }
                    catch (e) { }
                    try {
                        ai.DISABLE_FALLBACKS = true;
                    }
                    catch (e) { }
                    // reset debounce so repeated forced applies can take effect
                    try {
                        ai.lastHoldAt = 0;
                        if (ai.lastHoldAtBySlot &&
                            typeof ai.lastHoldAtBySlot.set === "function")
                            ai.lastHoldAtBySlot.set(slot, 0);
                    }
                    catch (e) { }
                    try {
                        if (typeof ai.recordProfile === "function")
                            ai.recordProfile({
                                event: "force-apply-invoked",
                                sig: planObj && planObj.sig ? planObj.sig : null,
                            });
                    }
                    catch (e) { }
                    if (typeof ai.forceApplyPlan === "function") {
                        try {
                            return ai.forceApplyPlan(planObj, reqId);
                        }
                        catch (e) {
                            /* fallthrough */
                        }
                    }
                    if (typeof ai.handlePlanResult === "function") {
                        try {
                            ai.handlePlanResult(planObj, reqId || "force-" + Date.now());
                        }
                        catch (e) {
                            return { ok: false, error: String(e) };
                        }
                        try {
                            return { ok: true };
                        }
                        catch (e) {
                            return { ok: false, error: String(e) };
                        }
                    }
                    return { ok: false, error: "no-apply-fn" };
                }
                finally {
                    window.__RELAX_APPLY_GUARDS = prevRelax;
                    try {
                        ai.FORCE_APPLY_HOLDS_IN_SWEEP = prevForce;
                    }
                    catch (e) { }
                    try {
                        ai.DISABLE_FALLBACKS = prevDisable;
                    }
                    catch (e) { }
                }
            }
            catch (e) {
                return { ok: false, error: String(e) };
            }
        };
    }
    catch (e) { }
}
catch (e) { }
// Bulk injection helper: top-level, safe batched forced plan application with status.
try {
    try {
        window.__bulkForceInject = function (count, batchSize, pauseMs) {
            try {
                const total = Number(count) || 1000;
                const bs = Math.max(1, Number(batchSize) || 100);
                const pause = Math.max(0, Number(pauseMs) || 10);
                const ai = window.ai;
                const applyFn = window.__forceApplyPlan
                    ? function (plan, reqId) {
                        try {
                            return window.__forceApplyPlan(plan, reqId);
                        }
                        catch (e) {
                            return { ok: false, error: String(e) };
                        }
                    }
                    : function (plan, reqId) {
                        try {
                            if (ai && typeof ai.handlePlanResult === "function") {
                                ai.handlePlanResult(plan, reqId);
                                return { ok: true };
                            }
                        }
                        catch (e) {
                            return { ok: false, error: String(e) };
                        }
                        return { ok: false, error: "no-apply-fn" };
                    };
                try {
                    window.__bulkInjectionStatus = {
                        running: true,
                        total: total,
                        injected: 0,
                        errors: 0,
                        batches: [],
                        startedAt: Date.now(),
                    };
                }
                catch (e) { }
                let stopped = false;
                window.__bulkForceInjectStop = function () {
                    stopped = true;
                    try {
                        window.__bulkInjectionStatus.requestedStop = true;
                    }
                    catch (e) { }
                };
                (async () => {
                    try {
                        const totalBatches = Math.ceil(total / bs);
                        for (let b = 0; b < totalBatches; b++) {
                            if (stopped)
                                break;
                            const toSend = Math.min(bs, total - b * bs);
                            let injectedInBatch = 0;
                            let errorsInBatch = 0;
                            for (let i = 0; i < toSend; i++) {
                                if (stopped)
                                    break;
                                const idx = b * bs + i;
                                try {
                                    const plan = {
                                        plan: { action: "hold", hold: true, holdSlot: 1 },
                                        score: Math.floor(Math.random() * 1000),
                                        sig: "bulk-inject-" + Date.now() + "-" + idx,
                                    };
                                    try {
                                        const r = applyFn(plan, "bulk-" + idx);
                                        if (r && r.ok === false) {
                                            errorsInBatch++;
                                        }
                                        else {
                                            injectedInBatch++;
                                        }
                                    }
                                    catch (e) {
                                        errorsInBatch++;
                                    }
                                }
                                catch (e) {
                                    errorsInBatch++;
                                }
                                if ((i & 63) === 0)
                                    await new Promise((r) => setTimeout(r, 0));
                            }
                            try {
                                const s = window.__bulkInjectionStatus || {};
                                s.injected = (s.injected || 0) + injectedInBatch;
                                s.errors = (s.errors || 0) + errorsInBatch;
                                try {
                                    s.batches.push({
                                        batch: b,
                                        injected: injectedInBatch,
                                        errors: errorsInBatch,
                                        ts: Date.now(),
                                    });
                                }
                                catch (e) { }
                                window.__bulkInjectionStatus = s;
                            }
                            catch (e) { }
                            await new Promise((r) => setTimeout(r, pause));
                        }
                    }
                    catch (e) {
                        try {
                            window.__bulkInjectionStatus.error = String(e);
                        }
                        catch (er) { }
                    }
                    finally {
                        try {
                            window.__bulkInjectionStatus.running = false;
                            window.__bulkInjectionStatus.finishedAt = Date.now();
                        }
                        catch (e) { }
                    }
                })();
                return { ok: true };
            }
            catch (e) {
                return { ok: false, error: String(e) };
            }
        };
        window.__getBulkInjectionStatus = function () {
            try {
                return (window.__bulkInjectionStatus || {
                    running: false,
                    injected: 0,
                    errors: 0,
                });
            }
            catch (e) {
                return { running: false, error: String(e) };
            }
        };
    }
    catch (e) { }
}
catch (e) { }
