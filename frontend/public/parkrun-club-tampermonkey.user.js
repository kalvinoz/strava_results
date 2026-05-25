// ==UserScript==
// @name         Parkrun Club Results Scraper
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Scrapes Woodstock Runners parkrun club results - auto-starts on weekends, or click the floating button
// @author       Woodstock Results
// @match        https://www.parkrun.com/results/consolidatedclub/*
// @match        https://www.parkrun.com.au/results/consolidatedclub/*
// @match        https://www.parkrun.co.uk/results/consolidatedclub/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const CLUB_NUM = 19959; // Woodstock Runners
    const STORAGE_KEY = 'parkrun_club_scraper_config';
    const API_KEY_STORAGE = 'parkrun_scraper_api_key';
    const SCRIPT_URL = 'https://woodstock-results.pages.dev/parkrun-smart-scraper.js';
    const SPECIAL_DATES_URL = 'https://woodstock-results.pages.dev/parkrun-special-dates.json';
    const SPECIAL_DATES_CACHE_KEY = 'parkrun_special_dates_cache';

    // ─── Styles ─────────────────────────────────────────────────────────────────

    GM_addStyle(`
        #parkrun-club-scraper-button {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            padding: 12px 20px;
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
            color: white;
            border: none;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(17, 153, 142, 0.4);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #parkrun-club-scraper-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(17, 153, 142, 0.6);
        }
        #parkrun-club-scraper-button.active {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            animation: pr-club-pulse 2s infinite;
        }
        #parkrun-club-scraper-button.completed {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }
        #parkrun-club-scraper-button.error {
            background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
        }
        @keyframes pr-club-pulse {
            0%, 100% { box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4); }
            50% { box-shadow: 0 4px 25px rgba(245, 87, 108, 0.8); }
        }

        /* Progress panel */
        #pr-club-panel {
            position: fixed;
            bottom: 70px;
            right: 20px;
            z-index: 9998;
            width: 420px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: none;
            overflow: hidden;
        }
        #pr-club-panel .ph {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
            color: white;
            padding: 12px 16px;
            font-weight: 600;
            font-size: 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #pr-club-panel .ph .btn-stop {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }
        #pr-club-panel .pb { padding: 12px 16px; }
        #pr-club-panel .stats {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }
        #pr-club-panel .stat {
            flex: 1;
            text-align: center;
            padding: 8px;
            background: #f5f5f5;
            border-radius: 6px;
        }
        #pr-club-panel .stat-val { font-size: 16px; font-weight: 700; color: #333; }
        #pr-club-panel .stat-lbl { font-size: 10px; color: #666; text-transform: uppercase; }
        #pr-club-panel .stat.ok   .stat-val { color: #10b981; }
        #pr-club-panel .stat.warn .stat-val { color: #f59e0b; }
        #pr-club-panel .stat.bad  .stat-val { color: #ef4444; }
        #pr-club-panel .cur {
            margin-bottom: 10px;
            padding: 10px;
            background: #ecfdf5;
            border-radius: 6px;
            font-size: 13px;
        }
        #pr-club-panel .cur-lbl { font-size: 10px; color: #666; text-transform: uppercase; margin-bottom: 4px; }
        #pr-club-panel .cur-val { font-weight: 600; color: #333; word-break: break-word; }
        #pr-club-panel .log {
            max-height: 160px;
            overflow-y: auto;
            font-size: 11px;
            font-family: monospace;
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 8px;
            border-radius: 6px;
        }
        #pr-club-panel .log div { margin-bottom: 3px; line-height: 1.4; }
        #pr-club-panel .log .ok   { color: #4ade80; }
        #pr-club-panel .log .err  { color: #f87171; }
        #pr-club-panel .log .info { color: #60a5fa; }
        #pr-club-panel .log .warn { color: #fbbf24; }

        /* New runners notice — shown after scraping completes */
        #pc-new-runners {
            display: none;
            margin-top: 10px;
            padding: 10px 12px;
            background: #fffbeb;
            border: 2px solid #f59e0b;
            border-radius: 8px;
            font-size: 12px;
            color: #78350f;
        }
        #pc-new-runners .nr-title {
            font-weight: 700; font-size: 13px; margin-bottom: 6px;
        }
        #pc-new-runners .nr-list {
            list-style: none; margin: 0; padding: 0;
        }
        #pc-new-runners .nr-list li {
            padding: 3px 0; border-bottom: 1px solid #fde68a;
            display: flex; justify-content: space-between; align-items: center;
        }
        #pc-new-runners .nr-list li:last-child { border-bottom: none; }
        #pc-new-runners .nr-list a {
            color: #d97706; font-size: 11px; white-space: nowrap; margin-left: 8px;
        }

        /* Modal styles */
        #parkrun-club-modal {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #parkrun-club-modal .modal-content {
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            max-width: 400px;
            width: 90%;
        }
        #parkrun-club-modal h3 { margin: 0 0 16px; font-size: 18px; color: #333; }
        #parkrun-club-modal .date-inputs { margin-bottom: 16px; }
        #parkrun-club-modal .date-field { margin-bottom: 12px; }
        #parkrun-club-modal .date-field label {
            display: block; margin-bottom: 6px;
            font-size: 14px; color: #555;
        }
        #parkrun-club-modal .date-hint {
            font-size: 11px; color: #10b981; margin-top: 4px; font-style: italic;
        }
        #parkrun-club-modal .date-field input {
            width: 100%; padding: 10px 12px;
            border: 2px solid #e0e0e0; border-radius: 8px;
            font-size: 14px; box-sizing: border-box;
        }
        #parkrun-club-modal .date-field input:focus {
            outline: none; border-color: #11998e;
        }
        #parkrun-club-modal .radio-group { margin-bottom: 16px; }
        #parkrun-club-modal .radio-group-label {
            display: block; margin-bottom: 8px;
            font-size: 14px; color: #555; font-weight: 500;
        }
        #parkrun-club-modal .radio-option {
            display: flex; align-items: center;
            padding: 10px 12px; margin: 6px 0;
            border: 2px solid #e0e0e0; border-radius: 8px;
            cursor: pointer; transition: all 0.2s;
        }
        #parkrun-club-modal .radio-option:hover { border-color: #11998e; background: #f0fdf4; }
        #parkrun-club-modal .radio-option.selected { border-color: #11998e; background: #ecfdf5; }
        #parkrun-club-modal .radio-option input { margin-right: 10px; }
        #parkrun-club-modal .radio-option label { cursor: pointer; flex: 1; font-size: 14px; color: #333; }
        #parkrun-club-modal .button-group {
            display: flex; gap: 10px; justify-content: flex-end;
        }
        #parkrun-club-modal button {
            padding: 10px 20px; border: none; border-radius: 8px;
            font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        #parkrun-club-modal .btn-cancel { background: #f0f0f0; color: #666; }
        #parkrun-club-modal .btn-cancel:hover { background: #e0e0e0; }
        #parkrun-club-modal .btn-start {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
            color: white;
        }
        #parkrun-club-modal .btn-start:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(17, 153, 142, 0.4);
        }
    `);

    // ─── UI: floating button ────────────────────────────────────────────────────

    const button = document.createElement('button');
    button.id = 'parkrun-club-scraper-button';
    button.textContent = '🏃 Scrape Club Results';
    document.body.appendChild(button);

    // ─── UI: progress panel ─────────────────────────────────────────────────────

    const panel = document.createElement('div');
    panel.id = 'pr-club-panel';
    panel.innerHTML = `
        <div class="ph">
            <span>Scraper Progress</span>
            <button class="btn-stop">Stop</button>
        </div>
        <div class="pb">
            <div class="stats">
                <div class="stat"><div class="stat-val" id="pc-done">0</div><div class="stat-lbl">Done</div></div>
                <div class="stat"><div class="stat-val" id="pc-total">0</div><div class="stat-lbl">Total</div></div>
                <div class="stat ok"><div class="stat-val" id="pc-results">0</div><div class="stat-lbl">Results</div></div>
                <div class="stat warn"><div class="stat-val" id="pc-uploaded">0</div><div class="stat-lbl">Uploaded</div></div>
                <div class="stat bad"><div class="stat-val" id="pc-failed">0</div><div class="stat-lbl">Failed</div></div>
            </div>
            <div class="cur">
                <div class="cur-lbl">Current date</div>
                <div class="cur-val" id="pc-cur">—</div>
            </div>
            <div class="log" id="pc-log"></div>
            <div id="pc-new-runners">
                <div class="nr-title">🆕 New runners — full history needed</div>
                <ul class="nr-list" id="pc-new-runners-list"></ul>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.btn-stop').addEventListener('click', () => {
        window.stopParkrunScraper = true;
        panelLog('Stop requested by user', 'warn');
    });

    // ─── Panel helpers ──────────────────────────────────────────────────────────

    function panelLog(msg, type = 'info') {
        const container = document.getElementById('pc-log');
        if (!container) return;
        const el = document.createElement('div');
        el.className = type;
        // Strip ANSI-like markup the scraper uses (emojis are fine, keep them)
        el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
        while (container.children.length > 200) container.removeChild(container.firstChild);
    }

    function setStat(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function setCur(text) {
        const el = document.getElementById('pc-cur');
        if (el) el.textContent = text;
    }

    function showPanel() { panel.style.display = 'block'; }
    function hidePanel() { panel.style.display = 'none'; }

    function resetPanel() {
        ['pc-done','pc-total','pc-results','pc-uploaded','pc-failed'].forEach(id => setStat(id, 0));
        const log = document.getElementById('pc-log');
        if (log) log.innerHTML = '';
        setCur('—');
        const nr = document.getElementById('pc-new-runners');
        if (nr) nr.style.display = 'none';
        const nrList = document.getElementById('pc-new-runners-list');
        if (nrList) nrList.innerHTML = '';
    }

    // ─── New-runner check ────────────────────────────────────────────────────────
    // Called after scraping completes. Queries athletes-to-scrape?mode=new to find
    // any athletes whose full history hasn't been fetched yet (appeared for the first
    // time in this scrape, or previously failed). Shows them in the panel.
    async function checkNewRunners(apiKey) {
        try {
            const resp = await fetch(
                'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape?mode=new',
                { headers: { 'X-API-Key': apiKey } }
            );
            if (!resp.ok) {
                panelLog(`⚠ Could not check for new runners (${resp.status})`, 'warn');
                return;
            }
            const data = await resp.json();
            const athletes = data.athletes || [];
            if (athletes.length === 0) return;

            panelLog(`🆕 ${athletes.length} runner(s) need their full history fetched`, 'warn');

            const nr = document.getElementById('pc-new-runners');
            const list = document.getElementById('pc-new-runners-list');
            list.innerHTML = '';
            for (const a of athletes) {
                const id = (a.parkrun_athlete_id || '').replace(/^A/i, '');
                const li = document.createElement('li');
                const name = document.createTextNode(a.athlete_name);
                li.appendChild(name);
                if (id) {
                    const link = document.createElement('a');
                    link.href = `https://www.parkrun.com.au/parkrunner/${id}/all/`;
                    link.target = '_blank';
                    link.textContent = 'open /all/ ↗';
                    li.appendChild(link);
                }
                list.appendChild(li);
            }
            nr.style.display = 'block';
        } catch (e) {
            panelLog(`⚠ Error checking new runners: ${e.message}`, 'warn');
        }
    }

    // ─── Console interceptor ────────────────────────────────────────────────────
    // After the scraper loads we redirect its console output to the panel.
    // We watch for key patterns to update the stats widgets too.

    let consolePatched = false;
    const origLog   = console.log.bind(console);
    const origWarn  = console.warn.bind(console);
    const origError = console.error.bind(console);

    // State tracked from log lines
    let totalDates = 0;
    let doneCount  = 0;
    let resultsCount = 0;
    let uploadedCount = 0;
    let failedCount = 0;

    function patchConsole() {
        if (consolePatched) return;
        consolePatched = true;

        function intercept(origFn, defaultType) {
            return function(...args) {
                origFn(...args); // still log to real console
                const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
                processScraperLog(msg, defaultType);
            };
        }

        console.log   = intercept(origLog,   'info');
        console.warn  = intercept(origWarn,  'warn');
        console.error = intercept(origError, 'err');
    }

    function unpatchConsole() {
        if (!consolePatched) return;
        console.log   = origLog;
        console.warn  = origWarn;
        console.error = origError;
        consolePatched = false;
    }

    function processScraperLog(msg, defaultType) {
        // Skip noise lines
        if (msg.includes('━━━') || msg.trim() === '') return;

        // Determine display type from message content
        let type = defaultType;
        if (msg.includes('✅') || msg.includes('🎉') || msg.includes('COMPLETE')) type = 'ok';
        else if (msg.includes('❌') || msg.includes('STOPPED') || msg.includes('Error') || msg.includes('failed')) type = 'err';
        else if (msg.includes('⚠️') || msg.includes('⚠') || msg.includes('0 results') || msg.includes('No results')) type = 'warn';

        // Parse key progress lines
        // "[3/12] 25% - 2024-11-02"
        const progressMatch = msg.match(/\[(\d+)\/(\d+)\]\s*\d+%\s*[-–]\s*(\S+)/);
        if (progressMatch) {
            doneCount  = parseInt(progressMatch[1]);
            totalDates = parseInt(progressMatch[2]);
            const dateStr = progressMatch[3];
            setStat('pc-done',  doneCount);
            setStat('pc-total', totalDates);
            setCur(dateStr);
            type = 'info';
        }

        // "📅 Dates to scrape: 12 days"
        const datesMatch = msg.match(/Dates to scrape:\s*(\d+)/);
        if (datesMatch) {
            totalDates = parseInt(datesMatch[1]);
            setStat('pc-total', totalDates);
        }

        // "✓ Found N results" / "Extracted N results"
        const foundMatch = msg.match(/(?:Found|Extracted)\s+(\d+)\s+(?:Woodstock|results)/i);
        if (foundMatch) {
            resultsCount += parseInt(foundMatch[1]);
            setStat('pc-results', resultsCount);
        }

        // "✅ Batch N uploaded! Total uploaded so far: N results"
        const uploadMatch = msg.match(/Total uploaded so far:\s*(\d+)/);
        if (uploadMatch) {
            uploadedCount = parseInt(uploadMatch[1]);
            setStat('pc-uploaded', uploadedCount);
            type = 'ok';
        }

        // "Total: N results" (final upload)
        const finalUploadMatch = msg.match(/Total:\s*(\d+)\s+results/);
        if (finalUploadMatch) {
            uploadedCount = parseInt(finalUploadMatch[1]);
            setStat('pc-uploaded', uploadedCount);
        }

        // "Failed: N"
        const failMatch = msg.match(/Failed:\s*(\d+)/);
        if (failMatch) {
            failedCount = parseInt(failMatch[1]);
            setStat('pc-failed', failedCount);
        }

        panelLog(msg, type);
    }

    // ─── Special dates loader ────────────────────────────────────────────────────
    // All special-event date logic is driven by parkrun-special-dates.json.
    // To add/update special dates: edit that JSON file only — no script changes needed.

    async function loadSpecialDatesData() {
        try {
            const cached = sessionStorage.getItem(SPECIAL_DATES_CACHE_KEY);
            if (cached) return JSON.parse(cached);
        } catch (_) {}
        try {
            const resp = await fetch(SPECIAL_DATES_URL);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            try { sessionStorage.setItem(SPECIAL_DATES_CACHE_KEY, JSON.stringify(data)); } catch (_) {}
            return data;
        } catch (err) {
            console.warn('⚠️  Could not load special dates:', err.message, '— using Saturday/Christmas/NYD fallback');
            return null;
        }
    }

    // Build a flat sorted Set of all active special-event date strings from the JSON.
    function buildSpecialDateSet(data) {
        const set = new Set();
        if (!data) return set;
        for (const event of Object.values(data.global || {})) {
            for (const d of (event.dates || [])) set.add(d);
        }
        for (const country of Object.values(data.countries || {})) {
            for (const event of (country.special_events || [])) {
                if (!event.active) continue;
                for (const d of (event.dates || [])) set.add(d);
            }
        }
        return set;
    }

    // ─── Date helpers ───────────────────────────────────────────────────────────

    // Format a Date object as YYYY-MM-DD (UTC)
    function fmtDate(d) {
        return d.getUTCFullYear() + '-' +
            String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
            String(d.getUTCDate()).padStart(2, '0');
    }

    // Walk backwards from today (UTC) to find the most recent Saturday
    function lastSaturday() {
        const now = new Date();
        const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const dow = new Date(todayUTC).getUTCDay(); // 0=Sun … 6=Sat
        const daysBack = dow === 6 ? 0 : (dow + 1); // Sat=0, Sun=1, Mon=2 … Fri=6
        return new Date(todayUTC - daysBack * 86400000);
    }

    // Returns today's date string (UTC) as YYYY-MM-DD
    function todayUTCStr() {
        return fmtDate(new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate()
        )));
    }

    // Returns yesterday's date string (UTC)
    function yesterdayUTCStr() {
        const d = new Date();
        return fmtDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1)));
    }

    // Returns the most recent parkrun date relative to today.
    // Checks: today or yesterday in the special dates set, then falls back to last Saturday.
    // specialDateSet may be null — falls back to Christmas + NYD check only.
    function getMostRecentParkrunDate(specialDateSet) {
        const today = todayUTCStr();
        const yesterday = yesterdayUTCStr();

        if (specialDateSet) {
            // If today or yesterday is a special event day, that's the most recent date
            if (specialDateSet.has(today))     return today;
            if (specialDateSet.has(yesterday)) return yesterday;
        } else {
            // Fallback: hardcoded Christmas and New Year's
            const [y, m, d] = today.split('-').map(Number);
            if (m === 12 && (d === 25 || d === 26)) return `${y}-12-25`;
            if (m ===  1 && (d ===  1 || d ===  2)) return `${y}-01-01`;
            const [py, pm, pd] = yesterday.split('-').map(Number);
            if (pm === 12 && pd === 25) return `${py}-12-25`;
            if (pm ===  1 && pd ===  1) return `${py}-01-01`;
        }

        // Default: most recent Saturday
        return fmtDate(lastSaturday());
    }

    // Whether today (or yesterday) is a parkrun special event day — used for auto-start.
    // Always auto-starts on Saturday (regular day) and Sunday (day after Saturday).
    function isAutoStartDay(specialDateSet) {
        const dow = new Date().getUTCDay();
        if (dow === 6 || dow === 0) return true; // Saturday or Sunday

        const today = todayUTCStr();
        const yesterday = yesterdayUTCStr();

        if (specialDateSet) {
            return specialDateSet.has(today) || specialDateSet.has(yesterday);
        }
        // Fallback
        const [y, m, d] = today.split('-').map(Number);
        if (m === 12 && (d === 25 || d === 26)) return true;
        if (m ===  1 && (d ===  1 || d ===  2)) return true;
        return false;
    }

    // ─── API key helper ─────────────────────────────────────────────────────────

    function getApiKey() {
        let apiKey = localStorage.getItem(API_KEY_STORAGE);
        if (!apiKey) {
            apiKey = prompt('Enter your Parkrun API Key:\n\n(This will be stored in your browser for future use)');
            if (!apiKey) {
                alert('❌ API Key is required to use the scraper');
                return null;
            }
            localStorage.setItem(API_KEY_STORAGE, apiKey);
        }
        return apiKey;
    }

    // ─── Config modal ───────────────────────────────────────────────────────────

    function showConfigModal(apiKey, specialDateSet) {
        const defaultDate = getMostRecentParkrunDate(specialDateSet);
        const isDefaultParkrunDay = isAutoStartDay(specialDateSet);

        const modal = document.createElement('div');
        modal.id = 'parkrun-club-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>🏃 Club Results Scraper</h3>
                <div class="date-inputs">
                    <div class="date-field">
                        <label for="start-date">Start Date</label>
                        <input type="date" id="start-date" value="${defaultDate}">
                        ${isDefaultParkrunDay ? `<div class="date-hint">✓ Most recent parkrun: ${defaultDate}</div>` : ''}
                    </div>
                    <div class="date-field">
                        <label for="end-date">End Date</label>
                        <input type="date" id="end-date" value="${defaultDate}">
                    </div>
                </div>
                <div class="radio-group">
                    <span class="radio-group-label">Import Mode</span>
                    <div class="radio-option selected" data-value="new">
                        <input type="radio" name="import-mode" id="mode-new" value="new" checked>
                        <label for="mode-new">Add new data only</label>
                    </div>
                    <div class="radio-option" data-value="replace">
                        <input type="radio" name="import-mode" id="mode-replace" value="replace">
                        <label for="mode-replace">Replace all existing data</label>
                    </div>
                </div>
                <div class="button-group">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-start">Start</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('.radio-option').forEach(option => {
            option.addEventListener('click', () => {
                modal.querySelectorAll('.radio-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                option.querySelector('input').checked = true;
            });
        });

        modal.querySelector('.btn-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

        modal.querySelector('.btn-start').addEventListener('click', () => {
            const startDateInput = modal.querySelector('#start-date').value;
            const endDateInput   = modal.querySelector('#end-date').value;
            const selectedMode   = modal.querySelector('input[name="import-mode"]:checked').value;

            if (!startDateInput || !endDateInput) {
                alert('❌ Both dates are required');
                return;
            }
            if (new Date(startDateInput) > new Date(endDateInput)) {
                alert('❌ Start date must be before end date');
                return;
            }

            const config = {
                startDate: startDateInput,
                endDate:   endDateInput,
                replaceMode: selectedMode === 'replace',
                apiEndpoint: 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import',
                apiKey,
                clubNum: CLUB_NUM,
                active: true
            };

            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
            modal.remove();
            startScraper(config);
        });
    }

    // ─── Scraper runner ─────────────────────────────────────────────────────────

    function startScraper(config) {
        resetPanel();
        showPanel();

        button.textContent = '🔄 Scraper Running...';
        button.className = '';
        button.classList.add('active');
        button.onclick = function() {
            if (confirm('Stop the club scraper?')) {
                window.stopParkrunScraper = true;
                panelLog('Stop requested…', 'warn');
            }
        };

        panelLog(`Starting scraper: ${config.startDate} → ${config.endDate}`, 'info');

        // Build URL with query params (scraper reads these)
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('clubNum',     config.clubNum.toString());
        currentUrl.searchParams.set('startDate',   config.startDate);
        currentUrl.searchParams.set('endDate',     config.endDate);
        currentUrl.searchParams.set('apiEndpoint', config.apiEndpoint);
        currentUrl.searchParams.set('apiKey',      config.apiKey);
        currentUrl.searchParams.set('autoUpload',  'true');
        currentUrl.searchParams.set('replaceMode', config.replaceMode.toString());
        window.history.replaceState({}, '', currentUrl.toString());

        // Patch console BEFORE loading the scraper script so we capture its output
        patchConsole();

        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.onload = function() {
            panelLog('Scraper script loaded ✓', 'ok');

            // Poll for completion / stop
            const checkInterval = setInterval(() => {
                if (window.stopParkrunScraper) {
                    clearInterval(checkInterval);
                    unpatchConsole();
                    button.textContent = '🛑 Scraper Stopped';
                    button.className = '';
                    sessionStorage.removeItem(STORAGE_KEY);
                    resetButton(3000);
                    return;
                }

                if (sessionStorage.getItem('parkrun_scraper_completed')) {
                    clearInterval(checkInterval);
                    unpatchConsole();
                    button.textContent = '✅ Scraping Complete!';
                    button.className = 'completed';
                    sessionStorage.removeItem(STORAGE_KEY);
                    sessionStorage.removeItem('parkrun_scraper_completed');
                    checkNewRunners(config.apiKey);
                    resetButton(5000);
                }
            }, 1000);
        };
        script.onerror = function() {
            unpatchConsole();
            panelLog('❌ Failed to load scraper script from: ' + SCRIPT_URL, 'err');
            button.textContent = '❌ Error - Try Again';
            button.className = 'error';
            sessionStorage.removeItem(STORAGE_KEY);
            resetButton(5000);
        };
        document.head.appendChild(script);
    }

    function resetButton(delayMs) {
        setTimeout(() => {
            button.textContent = '🏃 Scrape Club Results';
            button.className = '';
            button.onclick = openModal; // openModal loads special dates lazily
            hidePanel();
        }, delayMs);
    }

    async function openModal() {
        const apiKey = getApiKey();
        if (!apiKey) return;
        const data = await loadSpecialDatesData();
        const specialDateSet = buildSpecialDateSet(data);
        showConfigModal(apiKey, specialDateSet);
    }

    // ─── Initial state ──────────────────────────────────────────────────────────

    // Resuming a scrape already in progress (page reload mid-scrape) — no async needed
    const storedConfig = sessionStorage.getItem(STORAGE_KEY);
    if (storedConfig) {
        const config = JSON.parse(storedConfig);
        button.textContent = '🔄 Scraper Running...';
        button.classList.add('active');
        button.onclick = function() {
            if (confirm('Stop the club scraper?')) {
                window.stopParkrunScraper = true;
            }
        };
        startScraper(config);
        // (no return — let async init run in background, it won't interfere)
    } else {
        // Load special dates then decide: auto-start or wait for button click
        (async () => {
            const data = await loadSpecialDatesData();
            const specialDateSet = buildSpecialDateSet(data);

            const savedApiKey = localStorage.getItem(API_KEY_STORAGE);
            if (savedApiKey && isAutoStartDay(specialDateSet)) {
                const parkrunDate = getMostRecentParkrunDate(specialDateSet);
                const config = {
                    startDate:   parkrunDate,
                    endDate:     parkrunDate,
                    replaceMode: false,
                    apiEndpoint: 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import',
                    apiKey:      savedApiKey,
                    clubNum:     CLUB_NUM,
                    active:      true
                };

                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
                button.textContent = '🔄 Auto-scraping...';
                button.classList.add('active');
                button.onclick = function() {
                    if (confirm('Stop the auto-scraper?')) {
                        window.stopParkrunScraper = true;
                    }
                };

                panelLog(`Auto-starting for parkrun date: ${parkrunDate}`, 'info');
                startScraper(config);
            } else {
                // Wire up button with special dates already loaded (fast modal open)
                button.onclick = () => {
                    const apiKey = getApiKey();
                    if (!apiKey) return;
                    showConfigModal(apiKey, specialDateSet);
                };
            }
        })();
    }

})();
