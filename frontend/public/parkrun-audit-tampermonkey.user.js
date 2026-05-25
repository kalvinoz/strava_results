// ==UserScript==
// @name         Parkrun Athlete Data Audit
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Audits athlete run counts against the database and imports missing runs
// @author       Woodstock Results
// @match        https://www.parkrun.com/parkrunner/*/
// @match        https://www.parkrun.com.au/parkrunner/*/
// @match        https://www.parkrun.co.uk/parkrunner/*/
// @match        https://www.parkrun.com/parkrunner/*/all/
// @match        https://www.parkrun.com.au/parkrunner/*/all/
// @match        https://www.parkrun.co.uk/parkrunner/*/all/
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const API_BASE = 'https://strava-club-workers.pedroqueiroz.workers.dev';
    const ATHLETES_API = `${API_BASE}/api/parkrun/athletes`;
    const IMPORT_API = `${API_BASE}/api/parkrun/import-individual`;
    const MARK_AUDITED_API = `${API_BASE}/api/parkrun/mark-audited`;
    const API_KEY_STORAGE = 'parkrun_scraper_api_key';
    const AUDIT_STATE_KEY = 'parkrun_audit_state';

    // ─── Detect page type ───────────────────────────────────────────────────────

    const path = window.location.pathname;
    const summaryMatch = path.match(/^\/parkrunner\/(\d+)\/?$/);
    const allPageMatch = path.match(/^\/parkrunner\/(\d+)\/all\/?/);
    const athleteId = (summaryMatch || allPageMatch)?.[1];

    if (!athleteId) return;

    // ─── Styles ─────────────────────────────────────────────────────────────────

    GM_addStyle(`
        #pr-audit-btn {
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 9999;
            padding: 12px 20px;
            background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
            color: white;
            border: none;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #pr-audit-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(245, 158, 11, 0.6);
        }
        #pr-audit-btn.running {
            background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
            animation: pr-pulse 2s infinite;
        }
        #pr-audit-btn.done-ok {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        }
        #pr-audit-btn.done-err {
            background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
        }
        @keyframes pr-pulse {
            0%, 100% { box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4); }
            50%       { box-shadow: 0 4px 25px rgba(139, 92, 246, 0.8); }
        }

        #pr-audit-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #pr-audit-modal .mc {
            background: white; padding: 24px; border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            max-width: 400px; width: 90%;
        }
        #pr-audit-modal h3 { margin: 0 0 16px; font-size: 18px; color: #333; }
        #pr-audit-modal .opt {
            display: flex; align-items: center;
            padding: 10px 12px; margin: 6px 0;
            border: 2px solid #e0e0e0; border-radius: 8px;
            cursor: pointer; transition: all 0.2s;
        }
        #pr-audit-modal .opt:hover { border-color: #f59e0b; background: #fffbeb; }
        #pr-audit-modal .opt.sel   { border-color: #f59e0b; background: #fef3c7; }
        #pr-audit-modal .opt input { margin-right: 10px; }
        #pr-audit-modal .opt label { cursor: pointer; flex: 1; font-size: 14px; color: #333; }
        #pr-audit-modal .btns { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
        #pr-audit-modal button {
            padding: 10px 20px; border: none; border-radius: 8px;
            font-size: 14px; font-weight: 600; cursor: pointer;
        }
        #pr-audit-modal .btn-cancel { background: #f0f0f0; color: #666; }
        #pr-audit-modal .btn-start  {
            background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
            color: white;
        }

        #pr-audit-panel {
            position: fixed; bottom: 70px; left: 20px;
            z-index: 9998; width: 420px;
            background: white; border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: none; overflow: hidden;
        }
        #pr-audit-panel .ph {
            background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
            color: white; padding: 12px 16px;
            font-weight: 600; font-size: 14px;
            display: flex; justify-content: space-between; align-items: center;
        }
        #pr-audit-panel .ph .btn-stop {
            background: rgba(255,255,255,0.2); border: none; color: white;
            padding: 4px 10px; border-radius: 4px;
            font-size: 12px; font-weight: 600; cursor: pointer;
        }
        #pr-audit-panel .pb { padding: 12px 16px; }
        #pr-audit-panel .stats {
            display: flex; gap: 8px; margin-bottom: 12px;
        }
        #pr-audit-panel .stat {
            flex: 1; text-align: center; padding: 8px;
            background: #f5f5f5; border-radius: 6px;
        }
        #pr-audit-panel .stat-val { font-size: 16px; font-weight: 700; color: #333; }
        #pr-audit-panel .stat-lbl { font-size: 10px; color: #666; text-transform: uppercase; }
        #pr-audit-panel .stat.ok  .stat-val { color: #10b981; }
        #pr-audit-panel .stat.bad .stat-val { color: #ef4444; }
        #pr-audit-panel .stat.warn .stat-val { color: #f59e0b; }
        #pr-audit-panel .cur {
            margin-bottom: 10px; padding: 10px;
            background: #fef3c7; border-radius: 6px; font-size: 13px;
        }
        #pr-audit-panel .cur-lbl { font-size: 10px; color: #666; text-transform: uppercase; margin-bottom: 4px; }
        #pr-audit-panel .cur-val { font-weight: 600; color: #333; word-break: break-word; }
        #pr-audit-panel .log {
            max-height: 120px; overflow-y: auto;
            font-size: 11px; font-family: monospace;
            background: #1e1e1e; color: #d4d4d4;
            padding: 8px; border-radius: 6px;
        }
        #pr-audit-panel .log div { margin-bottom: 3px; line-height: 1.4; }
        #pr-audit-panel .log .ok   { color: #4ade80; }
        #pr-audit-panel .log .err  { color: #f87171; }
        #pr-audit-panel .log .info { color: #60a5fa; }
        #pr-audit-panel .log .warn { color: #fbbf24; }

        #pr-audit-panel .summary { margin-top: 10px; }
        #pr-audit-panel .summary-toggle {
            font-size: 11px; color: #888; cursor: pointer;
            text-align: right; margin-bottom: 6px; user-select: none;
        }
        #pr-audit-panel .summary-toggle:hover { color: #555; }
        #pr-audit-panel .summary-section { margin-bottom: 8px; }
        #pr-audit-panel .summary-section-title {
            font-size: 11px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.05em; margin-bottom: 4px; padding: 4px 8px;
            border-radius: 4px;
        }
        #pr-audit-panel .summary-section-title.fixed { background: #dcfce7; color: #15803d; }
        #pr-audit-panel .summary-section-title.error { background: #fee2e2; color: #b91c1c; }
        #pr-audit-panel .summary-row {
            display: flex; justify-content: space-between; align-items: baseline;
            font-size: 12px; padding: 4px 8px; border-radius: 4px;
        }
        #pr-audit-panel .summary-row:nth-child(even) { background: #f9f9f9; }
        #pr-audit-panel .summary-row .sr-name { font-weight: 600; color: #333; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #pr-audit-panel .summary-row .sr-detail { font-size: 11px; color: #666; white-space: nowrap; margin-left: 8px; }
        #pr-audit-panel .summary-row .sr-detail.fixed { color: #15803d; }
        #pr-audit-panel .summary-row .sr-detail.error { color: #b91c1c; }
        #pr-audit-panel .summary-empty { font-size: 12px; color: #888; padding: 4px 8px; }

        /* Human-check pause banner — shown inside the panel on 405 or CAPTCHA body */
        #pr-audit-captcha {
            display: none;
            margin: 10px 0 0;
            padding: 12px 14px;
            background: #fff7ed;
            border: 2px solid #fb923c;
            border-radius: 8px;
            font-size: 13px;
            color: #9a3412;
        }
        #pr-audit-captcha .cap-title {
            font-weight: 700; font-size: 14px; margin-bottom: 6px;
        }
        #pr-audit-captcha .cap-msg { margin-bottom: 10px; line-height: 1.5; }
        #pr-audit-captcha .cap-btns { display: flex; gap: 8px; align-items: center; }
        #pr-audit-captcha .btn-open-challenge {
            padding: 7px 12px;
            background: #fff;
            color: #9a3412;
            border: 2px solid #fb923c;
            border-radius: 6px;
            font-size: 12px; font-weight: 700;
            cursor: pointer; text-decoration: none;
        }
        #pr-audit-captcha .btn-open-challenge:hover { background: #fff7ed; }
        #pr-audit-captcha .btn-resume {
            padding: 7px 14px;
            background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
            color: white; border: none; border-radius: 6px;
            font-size: 12px; font-weight: 700; cursor: pointer;
            box-shadow: 0 2px 8px rgba(249,115,22,0.35);
        }
        #pr-audit-captcha .btn-resume:hover { opacity: 0.9; }
    `);

    // ─── UI elements ─────────────────────────────────────────────────────────────

    const btn = document.createElement('button');
    btn.id = 'pr-audit-btn';
    btn.textContent = '🔍 Audit Data';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'pr-audit-panel';
    panel.innerHTML = `
        <div class="ph">
            <span>Audit Progress</span>
            <button class="btn-stop">Stop</button>
        </div>
        <div class="pb">
            <div class="stats">
                <div class="stat"><div class="stat-val" id="pa-done">0</div><div class="stat-lbl">Done</div></div>
                <div class="stat"><div class="stat-val" id="pa-total">0</div><div class="stat-lbl">Total</div></div>
                <div class="stat ok"><div class="stat-val" id="pa-ok">0</div><div class="stat-lbl">OK</div></div>
                <div class="stat warn"><div class="stat-val" id="pa-fixed">0</div><div class="stat-lbl">Fixed</div></div>
                <div class="stat bad"><div class="stat-val" id="pa-err">0</div><div class="stat-lbl">Errors</div></div>
            </div>
            <div class="cur">
                <div class="cur-lbl">Current athlete</div>
                <div class="cur-val" id="pa-cur">—</div>
            </div>
            <div class="log" id="pa-log"></div>
            <div id="pr-audit-captcha">
                <div class="cap-title">🤖 Human check required</div>
                <div class="cap-msg"></div>
                <div class="cap-btns">
                    <a class="btn-open-challenge" target="_blank">Open challenge ↗</a>
                    <button class="btn-resume">▶ Resume</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    let stopped = false;

    panel.querySelector('.btn-stop').addEventListener('click', () => {
        stopped = true;
        log('Stopped by user', 'warn');
        setBtn('idle');
        // If we're paused on a human-check, dismiss the banner and reject the promise
        if (_humanCheckResolve) {
            const { reject } = _humanCheckResolve;
            _humanCheckResolve = null;
            document.getElementById('pr-audit-captcha').style.display = 'none';
            reject(new Error('Stopped by user'));
        }
    });

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    function log(msg, type = 'info') {
        const el = document.createElement('div');
        el.className = type;
        el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        const container = document.getElementById('pa-log');
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
        while (container.children.length > 100) container.removeChild(container.firstChild);
    }

    function stat(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function setCur(name) {
        const el = document.getElementById('pa-cur');
        if (el) el.textContent = name;
    }

    function setBtn(state) {
        btn.className = '';
        switch (state) {
            case 'running': btn.textContent = '⏳ Auditing...';    btn.classList.add('running'); break;
            case 'ok':      btn.textContent = '✅ Audit complete'; btn.classList.add('done-ok'); break;
            case 'error':   btn.textContent = '❌ Audit failed';   btn.classList.add('done-err'); break;
            default:        btn.textContent = '🔍 Audit Data';     break;
        }
    }

    function showPanel() { panel.style.display = 'block'; }
    function hidePanel() { panel.style.display = 'none'; }

    // ─── Summary renderer ────────────────────────────────────────────────────────
    // Called after audit completes. Appends a summary below the log showing
    // fixed athletes and error athletes with reasons.
    // auditLog: [{ name, id, status, reason, pageTotal, dbBefore, dbAfter }]

    function showSummary(auditLog) {
        // Remove any previous summary
        const prev = document.getElementById('pa-summary');
        if (prev) prev.remove();

        const fixed  = auditLog.filter(r => r.status === 'fixed');
        const errors = auditLog.filter(r => r.status === 'error');

        // Nothing interesting to show if everything was OK and nothing fixed
        if (fixed.length === 0 && errors.length === 0) return;

        const pb = panel.querySelector('.pb');

        const summary = document.createElement('div');
        summary.id = 'pa-summary';
        summary.className = 'summary';

        // Toggle to show/hide the live log (so summary has breathing room)
        const logEl = document.getElementById('pa-log');
        const toggle = document.createElement('div');
        toggle.className = 'summary-toggle';
        toggle.textContent = '▲ hide log';
        let logVisible = true;
        toggle.addEventListener('click', () => {
            logVisible = !logVisible;
            logEl.style.display = logVisible ? '' : 'none';
            toggle.textContent = logVisible ? '▲ hide log' : '▼ show log';
        });
        summary.appendChild(toggle);

        // Helper to build a section
        function section(titleText, titleClass, rows) {
            if (rows.length === 0) return;
            const sec = document.createElement('div');
            sec.className = 'summary-section';

            const title = document.createElement('div');
            title.className = `summary-section-title ${titleClass}`;
            title.textContent = titleText;
            sec.appendChild(title);

            for (const r of rows) {
                const row = document.createElement('div');
                row.className = 'summary-row';

                const name = document.createElement('span');
                name.className = 'sr-name';
                name.title = r.name; // full name on hover
                name.textContent = r.name;

                const detail = document.createElement('span');
                detail.className = `sr-detail ${titleClass}`;

                if (r.status === 'fixed') {
                    detail.textContent = `${r.dbBefore} → ${r.dbAfter} runs`;
                } else {
                    // Error: show what we know
                    if (r.pageTotal === null) {
                        detail.textContent = r.reason || 'fetch failed';
                    } else if (r.dbAfter !== null) {
                        detail.textContent = `db=${r.dbAfter}, web=${r.pageTotal}`;
                    } else {
                        detail.textContent = r.reason || 'unknown error';
                    }
                }

                row.appendChild(name);
                row.appendChild(detail);
                sec.appendChild(row);
            }
            return sec;
        }

        const fixedSec = section(`✅ Fixed (${fixed.length})`,  'fixed', fixed);
        const errorSec = section(`❌ Errors (${errors.length})`, 'error', errors);
        if (fixedSec) summary.appendChild(fixedSec);
        if (errorSec) summary.appendChild(errorSec);

        pb.appendChild(summary);
    }

    function getApiKey() {
        let key = localStorage.getItem(API_KEY_STORAGE);
        if (!key) {
            key = prompt('Enter your Parkrun API Key:\n(stored in browser for future use)');
            if (!key) { alert('API Key is required.'); return null; }
            localStorage.setItem(API_KEY_STORAGE, key);
        }
        return key;
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ─── CAPTCHA / human-check handling ─────────────────────────────────────────

    // Returns true if the HTML looks like a CAPTCHA / bot-check page.
    function isCaptchaPage(html) {
        const lower = html.toLowerCase();
        return (
            lower.includes("let's confirm you are human") ||
            lower.includes("confirm you are human") ||
            lower.includes("please verify you are human") ||
            lower.includes('cf-challenge') ||
            lower.includes('cf_chl_') ||
            lower.includes('challenge-platform') ||
            lower.includes('captcha')
        );
    }

    // Show the human-check banner and pause the audit until the user clicks Resume.
    // The "Open challenge" link is just an <a href> — clicking it is a direct user
    // gesture so the tab always opens, no popup-blocker issues.
    // Returns a Promise that resolves when the user clicks Resume.
    let _humanCheckResolve = null;

    function waitForHumanCheck(url, reason) {
        return new Promise((resolve, reject) => {
            const banner  = document.getElementById('pr-audit-captcha');
            const openBtn = banner.querySelector('.btn-open-challenge');
            const resumeBtn = banner.querySelector('.btn-resume');

            banner.querySelector('.cap-msg').textContent =
                `parkrun returned an unexpected response (${reason}). Open the challenge tab — log in or solve any verification — then click Resume.`;

            // Set the link href — clicking it is a real user gesture, always works
            openBtn.href = url;

            banner.style.display = 'block';
            btn.textContent = '⏸ Paused — action required';

            _humanCheckResolve = { resolve, reject };

            resumeBtn.onclick = () => {
                banner.style.display = 'none';
                btn.textContent = '⏳ Auditing...';
                _humanCheckResolve = null;
                resolve();
            };
        });
    }

    // ─── Page scraping helpers ───────────────────────────────────────────────────

    // Extract total run count from the current summary page DOM
    function getPageRunCount() {
        // parkrun shows e.g. "98 parkruns total" in a <p> or heading
        const text = document.body.innerText;
        const m = text.match(/(\d+)\s+parkruns?\s+total/i);
        return m ? parseInt(m[1]) : null;
    }

    // Extract athlete name from the summary page
    function getPageAthleteName() {
        // parkrun.com.au shows the name as the first <h1> on the page,
        // e.g. "Meru SHEEL (A703426)" — strip the ID suffix.
        // Avoid grabbing nav/header elements by taking the first h1 inside main content.
        const candidates = [
            document.querySelector('main h1'),
            document.querySelector('article h1'),
            document.querySelector('.ath-header h1'),
            document.querySelector('h1.athlete-name'),
            // parkrun.com.au wraps it in a div with class containing "name"
            document.querySelector('[class*="name"] h1'),
            document.querySelector('[class*="Name"] h1'),
            // Last resort: first h1 on the page
            document.querySelector('h1'),
        ];
        for (const el of candidates) {
            if (!el) continue;
            const text = el.textContent.replace(/[\s ]*\(A\d+\)[\s ]*$/, '').trim();
            // Reject if it looks like a nav item or page title (too short or generic)
            if (text && text.length > 3 && !text.toLowerCase().includes('parkrun')) return text;
        }
        // Fallback: page title is usually "FirstName LASTNAME | parkrun"
        return document.title.split(/[|\-–]/)[0].trim();
    }

    // Fetch DB run count for an athlete directly from parkrun_results by parkrun_athlete_id.
    // Queries the dedicated endpoint which counts rows by parkrun_athlete_id — reliable
    // both before and after import, regardless of name matching.
    async function getDbRunCount(athleteId) {
        const resp = await fetch(`${API_BASE}/api/parkrun/count-by-athlete-id?parkrun_athlete_id=${encodeURIComponent(athleteId)}`);
        if (!resp.ok) throw new Error(`Count API error: ${resp.status}`);
        const data = await resp.json();
        return { count: data.count ?? 0, name: null, found: (data.count ?? 0) > 0 };
    }

    // Record a successful audit timestamp for this athlete in the DB.
    // Fire-and-forget — failure doesn't affect the audit result.
    async function markAudited(athleteId, apiKey) {
        try {
            const resp = await fetch(MARK_AUDITED_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
                body: JSON.stringify({ parkrun_athlete_id: athleteId }),
            });
            if (!resp.ok) log(`  ⚠ markAudited failed: ${resp.status}`, 'warn');
        } catch (e) {
            log(`  ⚠ markAudited error: ${e.message}`, 'warn');
        }
    }

    // Navigate to the /all/ page, scrape the CSV and import it
    async function importAllRuns(athleteId, athleteName, apiKey) {
        const allUrl = `${window.location.origin}/parkrunner/${athleteId}/all/`;
        log(`Fetching /all/ page for ${athleteName} (${athleteId})…`, 'info');

        const html = await fetchParkrunPage(allUrl, `/all/ for ${athleteId}`);

        // Parse the results table out of the HTML
        const csv = parseAllPageToCSV(html, athleteId, athleteName);
        if (!csv) throw new Error('Could not parse results table from /all/ page');

        log(`Parsed ${csv.rowCount} rows from /all/ page, importing…`, 'info');

        // Upload to import API
        const formData = new FormData();
        formData.append('file', new Blob([csv.text], { type: 'text/csv' }), 'results.csv');
        formData.append('parkrun_athlete_id', athleteId);
        formData.append('athlete_name', athleteName);

        const importResp = await fetch(IMPORT_API, {
            method: 'POST',
            headers: { 'X-API-Key': apiKey },
            body: formData,
        });
        if (!importResp.ok) throw new Error(`Import API error: ${importResp.status}`);
        const result = await importResp.json();
        log(`Import done: ${result.new_results_added} added, ${result.duplicates_skipped} skipped`, 'ok');
        return result;
    }

    // Parse the /all/ page HTML into a CSV string matching the expected import format.
    //
    // The /all/ page contains THREE tables all with id="results":
    //   0: stats summary (Fastest/Average/Slowest)
    //   1: best-per-year summary
    //   2: full results (Event | Run Date | Run Number | Pos | Time | AgeGrade | PB?)
    // We want the LAST table (most rows).
    //
    // Date format on page is DD/MM/YYYY — converted to YYYY-MM-DD for the DB.
    function parseAllPageToCSV(html, athleteId, athleteName) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Pick the results table: the one with the most rows, or the last #results table
        const allTables = [...doc.querySelectorAll('table')];
        if (!allTables.length) return null;

        // Find the table whose headers include "Event" and "Time" — that's the results table
        let resultsTable = null;
        for (const tbl of allTables) {
            const ths = [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim().toLowerCase());
            if (ths.some(h => h.includes('event')) && ths.some(h => h.includes('time'))) {
                resultsTable = tbl;
                // Don't break — take the last match in case there are duplicates
            }
        }
        // Fallback: just take the table with the most rows
        if (!resultsTable) {
            resultsTable = allTables.reduce((best, t) =>
                t.querySelectorAll('tbody tr').length > best.querySelectorAll('tbody tr').length ? t : best
            , allTables[0]);
        }

        // Build header index from this specific table
        const headers = [...resultsTable.querySelectorAll('thead th')]
            .map(th => th.textContent.trim().toLowerCase());

        log(`  Table headers: [${headers.join(', ')}]`, 'info');

        // Map column names to indices (flexible matching)
        function colIdx(...names) {
            for (const name of names) {
                const idx = headers.findIndex(h => h.includes(name));
                if (idx >= 0) return idx;
            }
            return -1;
        }

        const iEvent    = colIdx('event');
        const iDate     = colIdx('run date', 'date');
        const iRunNum   = colIdx('run number', 'run #', '#');
        const iPos      = colIdx('pos', 'overall');
        const iTime     = colIdx('time');
        const iAgeGrade = colIdx('agegrade', 'age grade', 'age%', 'ag');
        const iPB       = colIdx('pb');

        log(`  Col indices → event:${iEvent} date:${iDate} runNum:${iRunNum} pos:${iPos} time:${iTime} ageGrade:${iAgeGrade} pb:${iPB}`, 'info');

        // Convert DD/MM/YYYY → YYYY-MM-DD
        function parseDate(raw) {
            const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
            // Already YYYY-MM-DD or other format — return as-is
            return raw;
        }

        const rows = resultsTable.querySelectorAll('tbody tr');
        const lines = ['Parkrun ID,parkrunner,Event,Date,Run Number,Pos,Time,Age Grade,PB,Data Source'];
        let count = 0;

        for (const row of rows) {
            const cells = [...row.querySelectorAll('td')];
            if (cells.length < 5) continue;

            const cell = (idx, fallbackIdx) => {
                if (idx >= 0 && cells[idx]) return cells[idx].textContent.trim();
                if (fallbackIdx >= 0 && cells[fallbackIdx]) return cells[fallbackIdx].textContent.trim();
                return '';
            };

            const event    = cell(iEvent,    0);
            const rawDate  = cell(iDate,     1);
            const runNum   = cell(iRunNum,   2) || '0';
            const pos      = cell(iPos,      3) || '0';
            const time     = cell(iTime,     4);
            const ageGrade = cell(iAgeGrade, 5) || '';
            const pb       = cell(iPB,       6) || '';

            if (!event || !time) continue;

            const date = parseDate(rawDate);

            const esc = v => `"${(v || '').replace(/"/g, '""')}"`;
            lines.push([
                esc(athleteId),
                esc(athleteName),
                esc(event),
                esc(date),
                esc(runNum),
                esc(pos),
                esc(time),
                esc(ageGrade),
                esc(pb),
                '"individual"'
            ].join(','));
            count++;
        }

        if (count === 0) return null;
        return { text: lines.join('\n'), rowCount: count };
    }

    // Fetch a parkrun page URL, pausing for human verification when needed.
    //
    // Two cases both trigger the pause banner:
    //   • HTTP 4xx/5xx (e.g. 405 — session expired / bot-check redirect)
    //   • HTTP 200 but body contains a CAPTCHA / human-check page
    //
    // The banner shows an "Open challenge ↗" link (direct user gesture → always opens)
    // and a "Resume" button. No automatic window.open() — that was always popup-blocked.
    //
    // maxRetries counts genuine network/server errors, not human-check pauses.
    async function fetchParkrunPage(url, label, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            log(`  → fetching ${label} (attempt ${attempt}/${maxRetries})`, 'info');
            try {
                const resp = await fetch(url, { credentials: 'include' });
                log(`  ← ${resp.status} for ${label}`, resp.ok ? 'info' : 'warn');

                const html = await resp.text();

                // Any of these mean parkrun wants a human check:
                //  • non-OK status (4xx/5xx, 202 "accepted but not ready", etc.)
                //  • empty or near-empty body (bot-check redirect with no content)
                //  • body explicitly contains a CAPTCHA / human-check page
                const needsHumanCheck =
                    !resp.ok ||
                    html.length < 500 ||
                    isCaptchaPage(html);

                if (needsHumanCheck) {
                    const reason = !resp.ok ? `HTTP ${resp.status}` : html.length < 500 ? 'empty response' : 'CAPTCHA page';
                    log(`  🤖 Human check needed (${reason}) — pausing…`, 'warn');
                    await waitForHumanCheck(url, reason);
                    log(`  ↺ Resumed — retrying…`, 'info');
                    attempt--; // don't consume a retry slot for a human-check pause
                    continue;
                }

                return html;

            } catch (err) {
                if (attempt === maxRetries) throw err;
                log(`  ⚠ fetch error: ${err.message} — waiting before retry`, 'warn');
                await delay(3000 * attempt);
            }
        }
    }

    // Re-fetch the current summary page and read the run count from fresh HTML
    async function fetchSummaryRunCount(athleteId) {
        const summaryUrl = `${window.location.origin}/parkrunner/${athleteId}/`;
        const html = await fetchParkrunPage(summaryUrl, `summary for ${athleteId}`);
        const m = html.match(/(\d+)\s+parkruns?\s+total/i);
        if (!m) {
            log(`  ⚠ could not find run count in summary page HTML (${html.length} bytes)`, 'warn');
            return null;
        }
        return parseInt(m[1]);
    }

    // ─── Core audit logic for a single athlete ───────────────────────────────────

    async function auditAthlete(athleteId, athleteName, apiKey) {
        log(`── ${athleteName} (${athleteId}) ──`, 'info');

        // 1. Get parkrun.com total from the summary page.
        // Only read from the current DOM if we're actually on THIS athlete's summary page.
        let pageTotal;

        if (summaryMatch && summaryMatch[1] === athleteId) {
            log(`  Using current page DOM for run count`, 'info');
            pageTotal = getPageRunCount();
        } else {
            pageTotal = await fetchSummaryRunCount(athleteId);
        }

        if (pageTotal === null) {
            log(`  ❌ Could not read run count from parkrun.com`, 'err');
            return { status: 'error', reason: 'Could not fetch parkrun.com page', pageTotal: null, dbBefore: null, dbAfter: null };
        }
        log(`  parkrun.com total: ${pageTotal}`, 'info');

        // 2. Get DB count
        const db = await getDbRunCount(athleteId);
        const name = athleteName || `Athlete ${athleteId}`;
        log(`  DB count: ${db.count}`, db.count === pageTotal ? 'ok' : 'warn');

        if (db.count === pageTotal) {
            log(`  ✅ In sync`, 'ok');
            await markAudited(athleteId, apiKey);
            return { status: 'ok', pageTotal, dbBefore: db.count, dbAfter: db.count };
        }

        // 3. Counts differ — import full history from /all/ page
        const missing = pageTotal - db.count;
        log(`  ⚠ Mismatch: ${missing > 0 ? missing + ' missing' : Math.abs(missing) + ' extra in DB'} — importing full history`, 'warn');
        await importAllRuns(athleteId, name, apiKey);

        // 4. Re-check DB count
        await delay(1500); // brief wait for DB write to settle
        const db2 = await getDbRunCount(athleteId);
        log(`  DB after import: ${db2.count} (expected ${pageTotal})`, db2.count === pageTotal ? 'ok' : 'err');

        if (db2.count !== pageTotal) {
            log(`  ❌ Still mismatched after import`, 'err');
            return { status: 'error', reason: `DB has ${db2.count}, parkrun.com has ${pageTotal} after import`, pageTotal, dbBefore: db.count, dbAfter: db2.count };
        }

        log(`  ✅ Fixed`, 'ok');
        await markAudited(athleteId, apiKey);
        return { status: 'fixed', pageTotal, dbBefore: db.count, dbAfter: db2.count };
    }

    // ─── Run audit for all club athletes ─────────────────────────────────────────

    async function auditAll(apiKey) {
        log('Fetching athlete list from DB…', 'info');
        const resp = await fetch(ATHLETES_API);
        if (!resp.ok) throw new Error(`Athletes API error: ${resp.status}`);
        const data = await resp.json();

        const athletes = (data.athletes || [])
            .filter(a => !a.is_hidden && a.parkrun_athlete_id)
            // Never-audited first (null), then oldest audit first
            .sort((a, b) => {
                if (a.last_audited_at == null && b.last_audited_at == null) return 0;
                if (a.last_audited_at == null) return -1;
                if (b.last_audited_at == null) return  1;
                return a.last_audited_at - b.last_audited_at;
            });
        stat('pa-total', athletes.length);
        log(`Found ${athletes.length} athletes to audit (${athletes.filter(a => !a.last_audited_at).length} never audited)`, 'info');

        let done = 0, ok = 0, fixed = 0, errors = 0;
        const auditLog = []; // { name, id, status, reason, pageTotal, dbBefore, dbAfter }

        for (const athlete of athletes) {
            if (stopped) break;

            const id = (athlete.parkrun_athlete_id || '').replace(/^A/, '');
            setCur(`${athlete.athlete_name} (${id})`);

            let result;
            try {
                result = await auditAthlete(id, athlete.athlete_name, apiKey);
            } catch (e) {
                log(`Error auditing ${athlete.athlete_name}: ${e.message}`, 'err');
                result = { status: 'error', reason: e.message, pageTotal: null, dbBefore: null, dbAfter: null };
            }

            auditLog.push({ name: athlete.athlete_name, id, ...result });

            if (result.status === 'ok')    { ok++;     stat('pa-ok',    ok); }
            if (result.status === 'fixed') { fixed++;  stat('pa-fixed', fixed); }
            if (result.status === 'error') { errors++;  stat('pa-err',   errors); }

            done++;
            stat('pa-done', done);

            // Polite delay between athletes
            if (!stopped && done < athletes.length) await delay(2000);
        }

        setCur('Done');
        log(`Audit complete: ${ok} ok, ${fixed} fixed, ${errors} errors`, errors > 0 ? 'err' : 'ok');
        showSummary(auditLog);
        return errors === 0 ? 'ok' : 'error';
    }

    // ─── Modal ───────────────────────────────────────────────────────────────────

    function showModal(apiKey) {
        const modal = document.createElement('div');
        modal.id = 'pr-audit-modal';
        modal.innerHTML = `
            <div class="mc">
                <h3>🔍 Athlete Data Audit</h3>
                <div>
                    <div class="opt sel" data-val="single">
                        <input type="radio" name="audit-mode" id="am-single" value="single" checked>
                        <label for="am-single">Audit current athlete (${athleteId})</label>
                    </div>
                    <div class="opt" data-val="all">
                        <input type="radio" name="audit-mode" id="am-all" value="all">
                        <label for="am-all">Audit all club athletes</label>
                    </div>
                </div>
                <div class="btns">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-start">Start</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.opt').forEach(opt => {
            opt.addEventListener('click', () => {
                modal.querySelectorAll('.opt').forEach(o => o.classList.remove('sel'));
                opt.classList.add('sel');
                opt.querySelector('input').checked = true;
            });
        });

        modal.querySelector('.btn-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

        modal.querySelector('.btn-start').addEventListener('click', async () => {
            const mode = modal.querySelector('input[name="audit-mode"]:checked').value;
            modal.remove();

            stopped = false;
            setBtn('running');
            showPanel();

            // Reset stats and clear any previous summary
            ['pa-done','pa-total','pa-ok','pa-fixed','pa-err'].forEach(id => stat(id, 0));
            document.getElementById('pa-log').innerHTML = '';
            const prevSummary = document.getElementById('pa-summary');
            if (prevSummary) prevSummary.remove();

            let finalResult;
            try {
                if (mode === 'single') {
                    stat('pa-total', 1);
                    const name = getPageAthleteName();
                    setCur(`${name} (${athleteId})`);
                    let result;
                    try {
                        result = await auditAthlete(athleteId, name, apiKey);
                    } catch (e) {
                        result = { status: 'error', reason: e.message, pageTotal: null, dbBefore: null, dbAfter: null };
                    }
                    stat('pa-done', 1);
                    if (result.status === 'ok')    { stat('pa-ok',    1); }
                    if (result.status === 'fixed') { stat('pa-fixed', 1); }
                    if (result.status === 'error') { stat('pa-err',   1); }
                    showSummary([{ name, id: athleteId, ...result }]);
                    finalResult = result.status === 'error' ? 'error' : 'ok';
                } else {
                    finalResult = await auditAll(apiKey);
                }
            } catch (e) {
                log(`Fatal error: ${e.message}`, 'err');
                finalResult = 'error';
            }

            setBtn(finalResult === 'ok' ? 'ok' : 'error');
            btn.onclick = openModal;
        });
    }

    function openModal() {
        const apiKey = getApiKey();
        if (!apiKey) return;
        showModal(apiKey);
    }

    btn.onclick = openModal;

})();
