// AI with worker scaffolding: sends simple planning requests to a Blob worker,
// supports timeout and synchronous fallback, and suppresses holds during fallback.
export default class AI {
    constructor(game) {
        this.enabled = false;
        this.speedMultiplier = 1;
        this.debug = false;
        this.lookahead = 6;
        this.weightLines = 1000;
        this.weightAgg = 6;
        this.weightHoles = 130;
        this.weightBump = 5;
        this.holdPenalty = 320;
        this.beamWidthBase = 4;
        this.perNodeLimit = 2;
        this.disableInputDuringRun = true;
        this.logs = [];
        // active workers map: allow multiple concurrent workers (for parallel fallback)
        this.activeWorkers = new Map();
        this.workerTimeouts = new Map();
        this.earlyFallbackTimers = new Map();
        this.holdReleaseTimers = new Map();
        this.appliedFallbacks = new Map();
        this.lastAppliedSig = null;
        this.lastAppliedAction = null;
        this.lastAppliedAt = 0;
        this.DEBOUNCE_MS = 300;
        this.lastAppliedPerReq = new Map();
        this.intermediateApplyCounts = new Map();
        this.DEBOUNCE_HOLD_MS = 800;
        this.MAX_INTERMEDIATE_APPLIES_PER_REQ = 3;
        this.reqCounter = 0;
        this.pendingReqId = null;
        this.scheduleTimer = null;
        this.PLAN_TIMEOUT_MS = 8000; // ms (increased to reduce premature sync fallbacks)
        this.REPEAT_PLAN_THRESHOLD = 3;
        this.lastPlanSig = null;
        this.repeatCount = 0;
        // guard to prevent planOnce from starting new workers while a probe/sweep is running
        this.probeInProgress = false;
        this.maxConcurrentWorkers = 8; // maximum concurrent background workers
        // early fallback timers are tracked per-request in earlyFallbackTimers map
        this.EARLY_FALLBACK_MS = 100; // ms (testing 100ms)
        // when a synchronous fallback has been applied, allow a worker result
        // to overwrite it if the worker did meaningful work or slightly better score
        this.WORKER_OVERWRITE_SCORE_DELTA = 2;
        this.WORKER_MIN_PROFILE_MS_FOR_RELAX = 60;
        this.APPLIED_FALLBACK_TTL_MS = 400; // ms - if applied fallback newer than this, prefer to defer instead of killing
        this.game = game;
        try {
            if (typeof (window).__autoCapturedLogs === 'undefined')
                window.__autoCapturedLogs = [];
            try {
                window.__autoCapturedLogs.push('ai:constructed');
            }
            catch (e) { }
        }
        catch (e) { }
    }
    isEnabled() { return this.enabled; }
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
            while ((this.activeWorkers.size > 0 || this.pendingReqId || this.workerTimeouts.size > 0 || this.scheduleTimer) && Date.now() - start < timeoutMs) {
                // ensure active workers are asked to cancel/terminated as a best-effort
                try {
                    for (const [rid, info] of Array.from(this.activeWorkers.entries())) {
                        try {
                            info.worker.postMessage({ type: 'cancel', reqId: rid });
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
                await new Promise(r => setTimeout(r, 25));
            }
        }
        finally {
            // clear lock unless caller explicitly requested it to be preserved
            if (!keepLock)
                this.probeInProgress = false;
        }
    }
    setSpeedMultiplier(n) { this.speedMultiplier = Math.max(0.1, Number(n) || 1); }
    setDebugEnabled(v) { this.debug = !!v; }
    getLogs() { return this.logs.slice(); }
    clearLogs() { this.logs = []; }
    setLookahead(n) { this.lookahead = Math.max(1, Math.min(16, Math.floor(Number(n) || 1))); }
    getLookahead() { return this.lookahead; }
    setDisableInputDuringRun(v) {
        this.disableInputDuringRun = !!v;
        if (!this.disableInputDuringRun) {
            try {
                window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(false);
            }
            catch (e) { }
        }
    }
    getDisableInputDuringRun() { return this.disableInputDuringRun; }
    // evaluation weight accessors (tuning)
    setWeightLines(n) { this.weightLines = Number(n) || 1000; }
    getWeightLines() { return this.weightLines; }
    setWeightAgg(n) { this.weightAgg = Number(n) || 6; }
    getWeightAgg() { return this.weightAgg; }
    setWeightHoles(n) { this.weightHoles = Number(n) || 130; }
    getWeightHoles() { return this.weightHoles; }
    setWeightBump(n) { this.weightBump = Number(n) || 5; }
    getWeightBump() { return this.weightBump; }
    setHoldPenalty(n) { this.holdPenalty = Number(n) || 320; }
    getHoldPenalty() { return this.holdPenalty; }
    setBeamWidthBase(n) { this.beamWidthBase = Math.max(1, Math.floor(Number(n) || 8)); }
    getBeamWidthBase() { return this.beamWidthBase; }
    setPerNodeLimit(n) { this.perNodeLimit = Math.max(1, Math.floor(Number(n) || 8)); }
    getPerNodeLimit() { return this.perNodeLimit; }
    startLoop() {
        try {
            if (this.disableInputDuringRun)
                window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(true);
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
                window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(false);
        }
        catch (e) { }
    }
    scheduleNext() {
        if (!this.enabled)
            return;
        const interval = Math.max(60, Math.round(800 / this.speedMultiplier));
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
                    this.logs.push('schedule delayed: probe in progress');
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
        createWorkerForRequest(reqId) {
                                // use static worker file to avoid template-string injection issues
                const url = 'worker_planner.js';
                const w = new Worker(url);
                return { worker: w, url };
    }
    onWorkerMessage(msg) {
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
            try {
                const hr = this.holdReleaseTimers.get(reqId);
                if (hr) {
                    try { clearTimeout(hr); }
                    catch (e) { }
                    this.holdReleaseTimers.delete(reqId);
                }
                try { this.game.setAllowHold1(true); this.game.setAllowHold2(true); }
                catch (e) { }
            }
            catch (e) { }
            // progress/heartbeat messages from worker - extend timeout and log, do not treat as final
            if (msg.type === 'progress' || msg.type === 'heartbeat') {
                try {
                    // only accept progress from known active workers
                    if (!this.activeWorkers.has(reqId))
                        return;
                    const p = msg.progress || msg.heartbeat || {};
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
                                            info.worker.postMessage({ type: 'cancel', reqId });
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
                                        info.worker.postMessage({ type: 'cancel', reqId });
                                    }
                                    catch (e) { }
                                    setTimeout(() => { try {
                                        this.terminateActiveWorker(reqId);
                                    }
                                    catch (e) { } }, 150);
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
                                    window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(false);
                            }
                            catch (e) { }
                            try { if (typeof reqId !== 'undefined' && fallback) fallback.reqId = reqId; } catch (e) {}
                            this.handlePlanResult(fallback);
                        }
                        catch (e) {
                            try {
                                this.logs.push('worker timeout handler error: ' + String(e));
                            }
                            catch (_) { }
                        }
                        try {
                            this.workerTimeouts.delete(reqId);
                        }
                        catch (e) { }
                    }, this.PLAN_TIMEOUT_MS));
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
                    try { result.reqId = reqId; } catch (e) { }
                    this.logs.push(`req:${reqId} worker-intermediate sig:${result.sig} score:${result.score}`);
                    // compare against any applied fallback and possibly overwrite
                    if (this.appliedFallbacks.has(reqId)) {
                        try {
                            const applied = this.appliedFallbacks.get(reqId);
                            let appliedSigObj = null;
                            try {
                                appliedSigObj = applied && applied.parsedSig ? applied.parsedSig : (applied && applied.sig ? JSON.parse(applied.sig) : null);
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
                            const getCurType = (o) => {
                                if (!o)
                                    return null;
                                if (typeof o.current === 'string')
                                    return o.current;
                                if (o.current && typeof o.current === 'object')
                                    return (o.current.type || null);
                                return null;
                            };
                            const sameInitialPiece = getCurType(appliedSigObj) && getCurType(resultSigObj) && getCurType(appliedSigObj) === getCurType(resultSigObj);
                            const workerScore = (typeof result.score === 'number') ? result.score : 0;
                            const appliedScore = (typeof applied.score === 'number') ? applied.score : 0;
                            try {
                                this.logs.push(`req:${reqId} intermediate worker vs applied: workerScore=${workerScore} appliedScore=${appliedScore} sameInitialPiece=${sameInitialPiece}`);
                            }
                            catch (e) { }
                            const delta = typeof this.WORKER_OVERWRITE_SCORE_DELTA === 'number' ? this.WORKER_OVERWRITE_SCORE_DELTA : 0;
                            const minMs = typeof this.WORKER_MIN_PROFILE_MS_FOR_RELAX === 'number' ? this.WORKER_MIN_PROFILE_MS_FOR_RELAX : 0;
                            const workerTime = (msg && msg.profile && typeof msg.profile.totalTimeMs === 'number') ? msg.profile.totalTimeMs : 0;
                            const allowRelax = workerTime >= minMs && (workerScore >= (appliedScore - delta));
                            if (sameInitialPiece && (workerScore > appliedScore || allowRelax)) {
                                this.logs.push(`req:${reqId} intermediate-overwrite applied (workerScore=${workerScore} appliedScore=${appliedScore} time=${workerTime}ms)`);
                                try { if (result) { result.reqId = reqId; result.intermediate = true; } } catch (e) {}
                                this.handlePlanResult(result);
                                // update appliedFallbacks to reflect this applied intermediate result
                                try {
                                    this.appliedFallbacks.set(reqId, { sig: result.sig, score: workerScore, parsedSig: (result.sig ? JSON.parse(result.sig) : null), snapshot: applied.snapshot, appliedAt: Date.now() });
                                }
                                catch (e) { }
                            }
                            else {
                                this.logs.push(`req:${reqId} intermediate ignored (fallback in use or stale)`);
                            }
                        }
                        catch (e) {
                            try {
                                this.logs.push('intermediate overwrite handling error: ' + String(e));
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
                        try {
                            if (result && result.plan && result.plan.action === 'hold' && this.holdReleaseTimers && this.holdReleaseTimers.has(reqId)) {
                                try { this.logs.push(`req:${reqId} skipping intermediate hold (holds suppressed)`); } catch (e) { }
                            }
                            else {
                                try { if (result) { result.reqId = reqId; result.intermediate = true; } } catch (e) {}
                                this.handlePlanResult(result);
                            }
                        }
                        catch (e) { }
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
                                                info.worker.postMessage({ type: 'cancel', reqId });
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
                                            info.worker.postMessage({ type: 'cancel', reqId });
                                        }
                                        catch (e) { }
                                        setTimeout(() => { try {
                                            this.terminateActiveWorker(reqId);
                                        }
                                        catch (e) { } }, 150);
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
                                        window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(false);
                                }
                                catch (e) { }
                                try { if (typeof reqId !== 'undefined' && fallback) fallback.reqId = reqId; } catch (e) {}
                                this.handlePlanResult(fallback);
                            }
                            catch (e) {
                                try {
                                    this.logs.push('worker timeout handler error: ' + String(e));
                                }
                                catch (_) { }
                            }
                            try {
                                this.workerTimeouts.delete(reqId);
                            }
                            catch (e) { }
                        }, this.PLAN_TIMEOUT_MS));
                    }
                    catch (e) { }
                }
                catch (e) {
                    try {
                        this.logs.push('intermediate handling error: ' + String(e));
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
                this.logs.push(`req:${reqId} worker-cancelled`);
                const state = this.game.getState();
                const fallback = this.syncFallbackPlan(state);
                try { if (fallback) fallback.reqId = reqId; } catch (e) { }
                                try { if (typeof reqId !== 'undefined' && fallback) fallback.reqId = reqId; } catch (e) {}
                                this.handlePlanResult(fallback);
                return;
            }
            if (msg.error) {
                this.logs.push(`req:${reqId} worker-error:${msg.error}`);
                // fallback
                const state = this.game.getState();
                const fallback = this.syncFallbackPlan(state);
                try { if (fallback) fallback.reqId = reqId; } catch (e) { }
                  try { if (typeof reqId !== 'undefined' && fallback) fallback.reqId = reqId; } catch (e) {}
                  this.handlePlanResult(fallback);
                return;
            }
            const result = { plan: msg.plan, score: msg.score, sig: msg.sig };
            try { result.reqId = reqId; } catch (e) { }
            this.logs.push(`req:${reqId} worker-result sig:${result.sig} score:${result.score}`);
            if (msg.profile) {
                try {
                    const p = msg.profile;
                    const d0 = (p.depthProfile && p.depthProfile[0]) ? p.depthProfile[0].timeMs : 'n/a';
                    this.logs.push(`req:${reqId} profile totalMs:${p.totalTimeMs} gen:${p.placementGeneratedCount} hits:${p.placementCacheHits} misses:${p.placementCacheMisses} d0:${d0}`);
                }
                catch (e) { }
            }
            // detect repeats
            if (this.lastPlanSig && result.sig === this.lastPlanSig) {
                this.repeatCount++;
            }
            else {
                this.repeatCount = 0;
                this.lastPlanSig = result.sig;
            }
            // if we already applied a synchronous fallback for this worker, decide whether to overwrite
            if (this.appliedFallbacks.has(reqId)) {
                try {
                    const applied = this.appliedFallbacks.get(reqId);
                    // compare parsed sigs (initial piece at planning time) so worker results
                    // can overwrite an applied fallback even after the game progressed.
                    let appliedSigObj = null;
                    try {
                        appliedSigObj = applied && applied.parsedSig ? applied.parsedSig : (applied && applied.sig ? JSON.parse(applied.sig) : null);
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
                    const getCurType = (o) => {
                        if (!o)
                            return null;
                        if (typeof o.current === 'string')
                            return o.current;
                        if (o.current && typeof o.current === 'object')
                            return (o.current.type || null);
                        return null;
                    };
                    const sameInitialPiece = getCurType(appliedSigObj) && getCurType(resultSigObj) && getCurType(appliedSigObj) === getCurType(resultSigObj);
                    const workerScore = (typeof result.score === 'number') ? result.score : 0;
                    const appliedScore = (typeof applied.score === 'number') ? applied.score : 0;
                    try {
                        this.logs.push(`req:${reqId} worker vs applied: workerScore=${workerScore} appliedScore=${appliedScore} sameInitialPiece=${sameInitialPiece} workerSig:${result.sig} appliedSig:${applied.sig}`);
                    }
                    catch (e) { }
                    // prefer worker result if it's for the same initial piece and has a better score
                    // or if the worker performed meaningful work (profile.totalTimeMs) and
                    // its score is within a small delta of the applied fallback.
                    try {
                        const delta = typeof this.WORKER_OVERWRITE_SCORE_DELTA === 'number' ? this.WORKER_OVERWRITE_SCORE_DELTA : 0;
                        const minMs = typeof this.WORKER_MIN_PROFILE_MS_FOR_RELAX === 'number' ? this.WORKER_MIN_PROFILE_MS_FOR_RELAX : 0;
                        const workerTime = (msg && msg.profile && typeof msg.profile.totalTimeMs === 'number') ? msg.profile.totalTimeMs : 0;
                        const allowRelax = workerTime >= minMs && (workerScore >= (appliedScore - delta));
                        if (sameInitialPiece && (workerScore > appliedScore || allowRelax)) {
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
                        this.logs.push('worker overwrite handling error: ' + String(e));
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
                    try { if (typeof reqId !== 'undefined' && fallback) fallback.reqId = reqId; } catch (e) {}
                    this.handlePlanResult(fallback);
                }
                else {
                    this.handlePlanResult(result);
                }
            }
        }
        catch (e) {
            try {
                this.logs.push('worker message handling error: ' + String(e));
            }
            catch (er) { }
        }
    }
    planOnce() {
        try {
            if (this.disableInputDuringRun)
                window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(true);
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
            // enforce max concurrent workers: if at limit, terminate the oldest to free a slot
            try {
                if (this.activeWorkers.size >= this.maxConcurrentWorkers) {
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
                                    const age = app && typeof app.appliedAt === 'number' ? (now - app.appliedAt) : -1;
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
                                        info.worker.postMessage({ type: 'cancel', reqId: candidate });
                                    }
                                    catch (e) { }
                                    setTimeout(() => { try {
                                        this.terminateActiveWorker(candidate);
                                    }
                                    catch (e) { } }, 120);
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
                                    info.worker.postMessage({ type: 'cancel', reqId: killKey });
                                }
                                catch (e) { }
                                setTimeout(() => { try {
                                    this.terminateActiveWorker(killKey);
                                }
                                catch (e) { } }, 120);
                            }
                        }
                        catch (e) { }
                    }
                }
            }
            catch (e) { }
            const created = this.createWorkerForRequest(reqId);
            const payload = {
                reqId,
                lookahead: this.lookahead,
                weights: { wLines: this.weightLines, wAgg: this.weightAgg, wHoles: this.weightHoles, wBump: this.weightBump, holdPenalty: this.holdPenalty },
                params: { beamWidthBase: this.beamWidthBase, perNodeLimit: this.perNodeLimit },
                state: {
                    board: state.board,
                    next: (state.next || []).slice(0, this.lookahead),
                    hold: state.hold,
                    current: state.current ? { type: state.current.type, x: state.current.x, y: state.current.y, rotation: state.current.rotation } : null
                }
            };
            // register worker in activeWorkers map and send payload
            const w = created.worker;
            const url = created.url;
            this.activeWorkers.set(reqId, { worker: w, url });
            try {
                if (typeof (window).__autoCapturedLogs === 'undefined')
                    window.__autoCapturedLogs = [];
            }
            catch (e) { }
            try {
                (w).onmessageerror = (ev) => {
                    try {
                        const rawErr = `req:${reqId} worker-onmessageerror`;
                        this.logs.push(rawErr);
                        try {
                            if (window.__autoCapturedLogs)
                                window.__autoCapturedLogs.push(rawErr);
                        }
                        catch (e) { }
                    }
                    catch (e) { }
                };
            }
            catch (e) { }
            try {
                w.onerror = (ev) => {
                    try {
                        const msg = ev && ev.message ? ev.message : String(ev);
                        const loc = ev && (ev.filename || ev.lineno || ev.colno) ? ` ${ev.filename || ''}:${ev.lineno || ''}:${ev.colno || ''}` : '';
                        const rawErr = `req:${reqId} worker-error-evt:${msg}${loc}`;
                        this.logs.push(rawErr);
                        try {
                            if (window.__autoCapturedLogs)
                                window.__autoCapturedLogs.push(rawErr);
                        }
                        catch (e) { }
                    }
                    catch (e) { }
                };
            }
            catch (e) { }
            w.onmessage = (ev) => {
                try {
                    try {
                        const d = ev && ev.data ? ev.data : {};
                        const t = (d && d.type) ? d.type : (d && d.plan ? 'plan' : (d && d.progress ? 'progress' : 'unknown'));
                        const planFlag = !!d.plan;
                        const sigFlag = !!d.sig;
                        const interm = !!d.intermediate;
                        const raw = `req:${reqId} raw-msg:type=${t}|plan=${planFlag}|sig=${sigFlag}|intermediate=${interm}`;
                        this.logs.push(raw);
                        try {
                            if (window.__autoCapturedLogs)
                                window.__autoCapturedLogs.push(raw);
                        }
                        catch (e) { }
                        try {
                            try {
                                const doc = window.document;
                                if (doc) {
                                    let el = doc.getElementById('__worker_debug');
                                    if (!el) { el = doc.createElement('pre'); el.id = '__worker_debug'; el.style.display = 'none'; doc.body && doc.body.appendChild(el); }
                                    try { el.textContent += raw + '\n'; } catch (e) {}
                                }
                            }
                            catch (e) { }
                        }
                        catch (e) { }
                    }
                    catch (e) {
                        try {
                            this.logs.push(`raw-msg:${reqId}:<unserializable>`);
                        }
                        catch (_) { }
                    }
                    this.onWorkerMessage(ev.data);
                }
                catch (err) {
                    try {
                        this.logs.push('onmessage handling failed: ' + String(err));
                    }
                    catch (_) { }
                }
            };
            try {
                w.postMessage(payload);
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
                                    info.worker.postMessage({ type: 'cancel', reqId });
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
                                info.worker.postMessage({ type: 'cancel', reqId });
                            }
                            catch (e) { }
                            setTimeout(() => { try {
                                this.terminateActiveWorker(reqId);
                            }
                            catch (e) { } }, 150);
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
                            window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(false);
                    }
                    catch (e) { }
                    this.handlePlanResult(fallback);
                }
                catch (e) {
                    try {
                        this.logs.push('worker timeout handler error: ' + String(e));
                    }
                    catch (_) { }
                }
                try {
                    this.workerTimeouts.delete(reqId);
                }
                catch (e) { }
            }, this.PLAN_TIMEOUT_MS));
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
                            parsed = fallback && fallback.sig ? JSON.parse(fallback.sig) : null;
                        }
                        catch (e) {
                            parsed = null;
                        }
                        const snap = { board: state && state.board ? (state.board || []).map((r) => r.slice()) : null, next: state && state.next ? (state.next || []).slice() : null, hold: state && state.hold ? state.hold : null, current: state && state.current ? state.current.type : null };
                        this.appliedFallbacks.set(reqId, { sig: fallback.sig, score: fallback.score || 0, parsedSig: parsed, snapshot: snap, appliedAt: Date.now() });
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
                            window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(false);
                    }
                    catch (e) { }
                    this.handlePlanResult(fallback);
                }
                catch (e) {
                    try {
                        this.logs.push('early-fallback error: ' + String(e));
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
            if (typeof reqId === 'string') {
                const info = this.activeWorkers.get(reqId);
                if (info) {
                    try {
                        info.worker.terminate();
                    }
                    catch (e) { }
                    try {
                        URL.revokeObjectURL(info.url);
                    }
                    catch (e) { }
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
                    info.worker.terminate();
                }
                catch (e) { }
                try {
                    URL.revokeObjectURL(info.url);
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
            await this.disableAndWait(2000, true);
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
                const created = this.createWorkerForRequest(payload.reqId);
                const w = created.worker;
                const url = created.url;
                let done = false;
                let graceTimer = null;
                let timer = setTimeout(() => {
                    if (done)
                        return;
                    try {
                        w.postMessage({ type: 'cancel' });
                    }
                    catch (e) { }
                    // give worker a short grace period to report profile on cancel
                    graceTimer = setTimeout(() => {
                        if (done)
                            return;
                        done = true;
                        try {
                            w.terminate();
                        }
                        catch (e) { }
                        try {
                            URL.revokeObjectURL(url);
                        }
                        catch (e) { }
                        resolve({ timeout: true });
                    }, 350);
                }, timeoutMs);
                w.onmessage = (ev) => {
                    if (done)
                        return;
                    const msg = ev.data || {};
                    // progress heartbeat: reset timeout
                    if (msg && msg.type === 'progress') {
                        try {
                            clearTimeout(timer);
                        }
                        catch (e) { }
                        timer = setTimeout(() => {
                            if (done)
                                return;
                            try {
                                w.postMessage({ type: 'cancel' });
                            }
                            catch (e) { }
                            graceTimer = setTimeout(() => {
                                if (done)
                                    return;
                                done = true;
                                try {
                                    w.terminate();
                                }
                                catch (e) { }
                                try {
                                    URL.revokeObjectURL(url);
                                }
                                catch (e) { }
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
                    try {
                        w.terminate();
                    }
                    catch (e) { }
                    try {
                        URL.revokeObjectURL(url);
                    }
                    catch (e) { }
                    resolve(msg || {});
                };
                const payload = { reqId: `probe-${Date.now()}`, lookahead: (typeof (params && params.lookahead) === 'number' ? params.lookahead : this.lookahead), weights: weights || {}, params: Object.assign({}, params || {}, { timeoutMs: timeoutMs }), state };
                try {
                    w.postMessage(payload);
                }
                catch (e) {
                    clearTimeout(timer);
                    try {
                        w.terminate();
                    }
                    catch (e) { }
                    try {
                        URL.revokeObjectURL(url);
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
        ret.then(() => { if (disabledByProbe) {
            try {
                this.setEnabled(true);
            }
            catch (e) { }
        } this.probeInProgress = false; }, () => { if (disabledByProbe) {
            try {
                this.setEnabled(true);
            }
            catch (e) { }
        } this.probeInProgress = false; });
        return ret;
    }
    // Run parameter sweep over combinations (non-destructive; pauses AI while running)
    async runParameterSweep(options = {}) {
        const beamWidths = options.beamWidths || [6, 8, 10];
        const perNodeLimits = options.perNodeLimits || [8, 12];
        const weightSets = options.weightSets || [{ wLines: this.weightLines, wAgg: this.weightAgg, wHoles: this.weightHoles, wBump: this.weightBump, holdPenalty: this.holdPenalty }];
        const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 700;
        const trials = typeof options.trials === 'number' ? options.trials : 1;
        const fastMode = !!options.fastMode;
        const probeLookaheadOverride = fastMode ? Math.max(1, Math.min(2, this.lookahead)) : undefined;
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
                        const weights = { wLines: wset.wLines, wAgg: wset.wAgg, wHoles: wset.wHoles, wBump: wset.wBump, holdPenalty: wset.holdPenalty };
                        const params = { beamWidthBase: bw, perNodeLimit: pnl };
                        // snapshot state shallow copy
                        const st = { board: (state.board || []).map((r) => r.slice()), next: (state.next || []).slice(), hold: state.hold, current: state.current };
                        // eslint-disable-next-line no-await-in-loop
                        const probeParams = Object.assign({}, params, (typeof probeLookaheadOverride === 'number' ? { lookahead: probeLookaheadOverride } : {}));
                        probeParams.timeoutMs = timeoutMs;
                        probeParams.fastMode = fastMode;
                        const res = await this.probeStateWithParams(st, weights, probeParams, timeoutMs);
                        const elapsed = Date.now() - start;
                        results.push({ beamWidth: bw, perNodeLimit: pnl, weights: weights, trial: t, result: res, time: elapsed });
                        const rv = res;
                        this.logs.push(`sweep bw=${bw} pnl=${pnl} trial=${t} -> ${rv && (rv.score !== undefined ? ('score:' + rv.score) : (rv.error ? ('err:' + rv.error) : (rv.timeout ? 'timeout' : 'cancelled')))} time=${elapsed}`);
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
            const sigObj = { next: (state.next || []).slice(0, this.lookahead), hold: state.hold, current: state.current ? state.current.type : null };
            const sig = JSON.stringify(sigObj);
            const cur = state.current ? state.current.type : null;
            const board = (state.board || []).map((r) => r.slice());
            if (!cur)
                return { plan: { action: 'harddrop' }, score: 0, sig };
            // quick synchronous one-ply greedy placement to avoid hold-loop.
            const SHAPES = {
                I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
                J: [[1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
                L: [[0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
                O: [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
                S: [[0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
                T: [[0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
                Z: [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
            };
            function rotateCW(m) { const n = m.length; const res = Array.from({ length: n }, () => Array(n).fill(0)); for (let r = 0; r < n; r++)
                for (let c = 0; c < n; c++)
                    res[c][n - 1 - r] = m[r][c]; return res; }
            function getRotationMatrix(type, rot) { if (type === 'O')
                return SHAPES[type].map((r) => r.slice()); let m = SHAPES[type].map((r) => r.slice()); const r = ((rot % 4) + 4) % 4; for (let i = 0; i < r; i++)
                m = rotateCW(m); return m; }
            function canPlace(board, mat, x, y) { const rows = board.length; for (let r = 0; r < mat.length; r++) {
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
            } return true; }
            function dropY(board, mat, x, startY) { let y = startY; while (canPlace(board, mat, x, y + 1))
                y++; return y; }
            function placeAndClear(board, mat, x, y, type) { const b = board.map((r) => r.slice()); for (let r = 0; r < mat.length; r++)
                for (let c = 0; c < mat[r].length; c++)
                    if (mat[r][c]) {
                        const bx = x + c, by = y + r;
                        if (by >= 0 && by < b.length && bx >= 0 && bx < 10)
                            b[by][bx] = type;
                    } let cleared = 0; for (let rr = b.length - 1; rr >= 0; rr--) {
                if (b[rr].every((cell) => cell)) {
                    b.splice(rr, 1);
                    b.unshift(Array(10).fill(null));
                    cleared++;
                    rr++;
                }
            } return { board: b, cleared }; }
            function aggregateHeight(board) { const cols = 10, rows = board.length, heights = Array(cols).fill(0); for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    if (board[r][c]) {
                        heights[c] = rows - r;
                        break;
                    }
                }
            } return heights; }
            function countHoles(board) { const rows = board.length; let holes = 0; for (let c = 0; c < 10; c++) {
                let seen = false;
                for (let r = 0; r < rows; r++) {
                    if (board[r][c])
                        seen = true;
                    else if (seen)
                        holes++;
                }
            } return holes; }
            function bumpiness(heights) { let s = 0; for (let i = 0; i < heights.length - 1; i++)
                s += Math.abs(heights[i] - heights[i + 1]); return s; }
            const evaluateBoard = (board, linesCleared) => { const heights = aggregateHeight(board); const agg = heights.reduce((a, b) => a + b, 0); const holes = countHoles(board); const bump = bumpiness(heights); return linesCleared * this.weightLines - agg * this.weightAgg - holes * this.weightHoles - bump * this.weightBump; };
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
                return { plan: { action: 'place', x: best.x, rotation: best.rot }, score: best.score, sig };
            }
            // fallback to previous simple heuristics if no placement found
            let plan = { action: 'harddrop' };
            const next0 = (state.next && state.next.length) ? state.next[0] : null;
            if (!state.hold) {
                if (cur && (cur === 'S' || cur === 'Z' || cur === 'O'))
                    plan = { action: 'hold', slot: 1 };
                else
                    plan = { action: 'harddrop' };
            }
            else {
                if (cur && state.hold !== cur) {
                    if (next0 && state.hold === next0)
                        plan = { action: 'hold', slot: 1 };
                    else
                        plan = { action: 'harddrop' };
                }
            }
            const score = sig.length;
            return { plan, score, sig };
        }
        catch (e) {
            return { plan: { action: 'noop' }, score: 0, sig: 'err' };
        }
    }
    // apply result to the game (very simple mapping) and schedule next
    handlePlanResult(result) {
        try {
            this.logs.push(`apply plan sig:${result.sig} action:${result.plan && result.plan.action}`);
            // debounce identical plans/actions; hold-specific window and intermediate-apply limits
            try {
                const now = Date.now();
                const sig = result && result.sig ? result.sig : null;
                const action = result && result.plan && result.plan.action ? result.plan.action : null;
                const rid = result && result.reqId ? String(result.reqId) : null;
                const isIntermediate = !!(result && result.intermediate);
                const debounceWindow = (action === 'hold') ? this.DEBOUNCE_HOLD_MS : this.DEBOUNCE_MS;

                if (isIntermediate && rid) {
                    try {
                        const cnt = (this.intermediateApplyCounts.get(rid) || 0) + 1;
                        this.intermediateApplyCounts.set(rid, cnt);
                        if (cnt > this.MAX_INTERMEDIATE_APPLIES_PER_REQ) {
                            try { this.logs.push(`req:${rid} skipping intermediate (applied ${cnt} > ${this.MAX_INTERMEDIATE_APPLIES_PER_REQ})`); } catch (e) { }
                            try { this.scheduleNext(); } catch (e) { }
                            return;
                        }
                    } catch (e) { }
                }

                if (rid) {
                    try {
                        const rec = this.lastAppliedPerReq.get(rid);
                        const limit = debounceWindow;
                        if (rec && sig && rec.sig === sig && (now - rec.at) < limit) {
                            try { this.logs.push(`req:${rid} skipping duplicate sig within ${limit}ms`); } catch (e) { }
                            try { this.scheduleNext(); } catch (e) { }
                            return;
                        }
                        if (rec && action && rec.action === action && (now - rec.at) < limit) {
                            try { this.logs.push(`req:${rid} skipping duplicate action ${action} within ${limit}ms`); } catch (e) { }
                            try { this.scheduleNext(); } catch (e) { }
                            return;
                        }
                    }
                    catch (e) { }
                }

                const globalLimit = debounceWindow;
                if (sig && this.lastAppliedSig === sig && (now - this.lastAppliedAt) < globalLimit) {
                    try { this.logs.push(`skipping duplicate sig within ${globalLimit}ms`); } catch (e) { }
                    try { this.scheduleNext(); } catch (e) { }
                    return;
                }
                if (action && this.lastAppliedAction === action && (now - this.lastAppliedAt) < globalLimit) {
                    try { this.logs.push(`skipping duplicate action ${action} within ${globalLimit}ms`); } catch (e) { }
                    try { this.scheduleNext(); } catch (e) { }
                    return;
                }
            }
            catch (e) { }
            // perform a simple action
            try {
                if (result.plan && result.plan.action === 'harddrop') {
                    if (typeof this.game.hardDrop === 'function')
                        this.game.hardDrop();
                }
                else if (result.plan && result.plan.action === 'hold') {
                    if (typeof this.game.holdPiece === 'function')
                        this.game.holdPiece(result.plan.slot || 1);
                }
                else if (result.plan && result.plan.action === 'place') {
                    // rotate to desired orientation then move horizontally then harddrop
                    try {
                        const targetRot = Number(result.plan.rotation) || 0;
                        const targetX = Number(result.plan.x);
                        // rotate until matching target rotation (attempt up to 4 times)
                        for (let i = 0; i < 5; i++) {
                            try {
                                const cur = (this.game.getState && this.game.getState().current) ? this.game.getState().current : null;
                                const curRot = cur && typeof cur.rotation === 'number' ? cur.rotation : 0;
                                if (curRot === targetRot)
                                    break;
                                if (typeof this.game.rotateCW === 'function')
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
                        if (typeof this.game.hardDrop === 'function')
                            this.game.hardDrop();
                    }
                    catch (e) { }
                }
            }
            catch (e) { }
            // unlock input after action
            try {
                if (this.disableInputDuringRun)
                    window.input && typeof window.input.setLocked === 'function' && window.input.setLocked(false);
            }
            catch (e) { }
        }
        catch (e) {
            try {
                this.logs.push('handlePlanResult error: ' + String(e));
            }
            catch (er) { }
        }
        // record last applied plan/action timestamp for debounce
        try {
            try {
                const act = result && result.plan && result.plan.action ? result.plan.action : null;
                const sig = result && result.sig ? result.sig : null;
                const now = Date.now();
                if (sig)
                    this.lastAppliedSig = sig;
                if (act)
                    this.lastAppliedAction = act;
                this.lastAppliedAt = now;
                try {
                    const rid = result && result.reqId ? String(result.reqId) : null;
                    if (rid) {
                        this.lastAppliedPerReq.set(rid, { sig: sig, action: act, at: now });
                        try { if (rid && !(result && result.intermediate)) { this.intermediateApplyCounts.delete(rid); } } catch (e) {}
                    }
                }
                catch (e) { }
            }
            catch (e) { }
        }
        catch (e) { }
        // schedule next planning cycle
        try {
            this.scheduleNext();
        }
        catch (e) { }
    }
}
