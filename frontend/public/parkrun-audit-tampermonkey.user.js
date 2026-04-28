// ==UserScript==
// @name         Parkrun Athlete Data Audit
// @namespace    http://tampermonkey.net/
// @version      1.1
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
            right: 20px;
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
            position: fixed; bottom: 70px; right: 20px;
            z-index: 9998; width: 340px;
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
        </div>
    `;
    document.body.appendChild(panel);

    let stopped = false;

    panel.querySelector('.btn-stop').addEventListener('click', () => {
        stopped = true;
        log('Stopped by user', 'warn');
        setBtn('idle');
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
        // The heading is e.g. "Meru SHEEL (A703426)" — strip the ID suffix
        const h1 = document.querySelector('h1, .athletics-ath-name, [class*="athleteName"]');
        if (h1) return h1.textContent.replace(/\s*\(A\d+\)\s*$/, '').trim();
        // Fallback: grab from title
        return document.title.replace(/\s*[-|].*$/, '').trim();
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

    // Navigate to the /all/ page, scrape the CSV and import it
    async function importAllRuns(athleteId, athleteName, apiKey) {
        const allUrl = `${window.location.origin}/parkrunner/${athleteId}/all/`;
        log(`Navigating to /all/ page to fetch full history…`, 'info');

        // Fetch the /all/ page HTML
        const resp = await fetch(allUrl, { credentials: 'include' });
        if (!resp.ok) throw new Error(`Failed to fetch /all/ page: ${resp.status}`);
        const html = await resp.text();

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

    // Parse the /all/ page HTML into a CSV string matching the expected import format
    function parseAllPageToCSV(html, athleteId, athleteName) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr, #results tbody tr, .Results-table tbody tr');
        if (!rows.length) return null;

        const lines = ['Parkrun ID,parkrunner,Event,Date,Run Number,Pos,Time,Age Grade,PB,Data Source'];
        let count = 0;

        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) continue;

            // parkrun /all/ table columns: Event | Run Number | Pos | Time | Age Grade | PB
            // (column order varies slightly by region — try to find by header)
            const headers = [...doc.querySelectorAll('table thead th, .Results-table thead th')]
                .map(th => th.textContent.trim().toLowerCase());

            const get = (names) => {
                for (const name of names) {
                    const idx = headers.findIndex(h => h.includes(name));
                    if (idx >= 0 && cells[idx]) return cells[idx].textContent.trim();
                }
                // Fallback positional
                return '';
            };

            const event    = get(['event'])      || cells[0]?.textContent.trim();
            const date     = get(['date'])        || cells[1]?.textContent.trim();
            const runNum   = get(['run', '#'])    || cells[2]?.textContent.trim() || '0';
            const pos      = get(['pos', 'overall']) || cells[3]?.textContent.trim() || '0';
            const time     = get(['time'])        || cells[4]?.textContent.trim();
            const ageGrade = get(['age grade', 'age%']) || cells[5]?.textContent.trim() || '';
            const pb       = get(['pb'])          || cells[6]?.textContent.trim() || '';

            if (!event || !time) continue;

            // Escape CSV fields
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

    // Re-fetch the current summary page and read the run count from fresh HTML
    async function fetchSummaryRunCount(athleteId) {
        const summaryUrl = `${window.location.origin}/parkrunner/${athleteId}/`;
        const resp = await fetch(summaryUrl, { credentials: 'include' });
        if (!resp.ok) throw new Error(`Failed to re-fetch summary: ${resp.status}`);
        const html = await resp.text();
        const m = html.match(/(\d+)\s+parkruns?\s+total/i);
        return m ? parseInt(m[1]) : null;
    }

    // ─── Core audit logic for a single athlete ───────────────────────────────────

    async function auditAthlete(athleteId, athleteName, apiKey) {
        // 1. Get parkrun.com total from the summary page
        const summaryUrl = `${window.location.origin}/parkrunner/${athleteId}/`;
        let pageTotal;

        if (summaryMatch) {
            // We're already on the summary page
            pageTotal = getPageRunCount();
        } else {
            pageTotal = await fetchSummaryRunCount(athleteId);
        }

        if (pageTotal === null) {
            log(`⚠ Could not read run count from parkrun.com for ${athleteId}`, 'warn');
            return 'error';
        }

        // 2. Get DB count
        const db = await getDbRunCount(athleteId);
        const name = athleteName || db.name || `Athlete ${athleteId}`;

        log(`${name}: parkrun.com=${pageTotal}, db=${db.count}`, db.count === pageTotal ? 'ok' : 'warn');

        if (db.count === pageTotal) {
            return 'ok';
        }

        // 3. Counts differ — import full history from /all/ page
        log(`Mismatch (${pageTotal - db.count} missing) — importing full history`, 'warn');
        await importAllRuns(athleteId, name, apiKey);

        // 4. Re-check DB count
        await delay(1500); // brief wait for DB write to settle
        const db2 = await getDbRunCount(athleteId);
        log(`After import: db=${db2.count}, parkrun.com=${pageTotal}`, db2.count === pageTotal ? 'ok' : 'err');

        if (db2.count !== pageTotal) {
            log(`ERROR: counts still don't match after import (db=${db2.count}, expected=${pageTotal})`, 'err');
            return 'error';
        }

        return 'fixed';
    }

    // ─── Run audit for all club athletes ─────────────────────────────────────────

    async function auditAll(apiKey) {
        log('Fetching athlete list from DB…', 'info');
        const resp = await fetch(ATHLETES_API);
        if (!resp.ok) throw new Error(`Athletes API error: ${resp.status}`);
        const data = await resp.json();

        const athletes = (data.athletes || []).filter(a => !a.is_hidden && a.parkrun_athlete);
        stat('pa-total', athletes.length);
        log(`Found ${athletes.length} athletes to audit`, 'info');

        let done = 0, ok = 0, fixed = 0, errors = 0;

        for (const athlete of athletes) {
            if (stopped) break;

            const id = (athlete.parkrun_athlete || '').replace(/^A/, '');
            setCur(`${athlete.athlete_name} (${id})`);

            try {
                const result = await auditAthlete(id, athlete.athlete_name, apiKey);
                if (result === 'ok')    { ok++;     stat('pa-ok',    ok); }
                if (result === 'fixed') { fixed++;  stat('pa-fixed', fixed); }
                if (result === 'error') { errors++;  stat('pa-err',   errors); }
            } catch (e) {
                log(`Error auditing ${athlete.athlete_name}: ${e.message}`, 'err');
                errors++;
                stat('pa-err', errors);
            }

            done++;
            stat('pa-done', done);

            // Polite delay between athletes
            if (!stopped && done < athletes.length) await delay(2000);
        }

        setCur('Done');
        log(`Audit complete: ${ok} ok, ${fixed} fixed, ${errors} errors`, errors > 0 ? 'err' : 'ok');
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

            // Reset stats
            ['pa-done','pa-total','pa-ok','pa-fixed','pa-err'].forEach(id => stat(id, 0));
            document.getElementById('pa-log').innerHTML = '';

            let finalResult;
            try {
                if (mode === 'single') {
                    stat('pa-total', 1);
                    const name = getPageAthleteName();
                    setCur(`${name} (${athleteId})`);
                    const result = await auditAthlete(athleteId, name, apiKey);
                    stat('pa-done', 1);
                    if (result === 'ok')    { stat('pa-ok',    1); }
                    if (result === 'fixed') { stat('pa-fixed', 1); }
                    if (result === 'error') { stat('pa-err',   1); }
                    finalResult = result === 'error' ? 'error' : 'ok';
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
