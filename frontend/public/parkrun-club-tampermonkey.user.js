// ==UserScript==
// @name         Parkrun Club Results Scraper
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Scrapes Woodstock Runners parkrun club results - click the floating button to start (requires API key)
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

    // Add CSS for the floating button and modal
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
            animation: pulse 2s infinite;
        }
        #parkrun-club-scraper-button.completed {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }
        @keyframes pulse {
            0%, 100% { box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4); }
            50% { box-shadow: 0 4px 25px rgba(245, 87, 108, 0.8); }
        }
        #parkrun-club-scraper-status {
            position: fixed;
            bottom: 70px;
            right: 20px;
            z-index: 9998;
            padding: 10px 16px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            border-radius: 8px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: none;
            max-width: 300px;
        }

        /* Modal styles */
        #parkrun-club-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
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
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            max-width: 400px;
            width: 90%;
        }
        #parkrun-club-modal h3 {
            margin: 0 0 16px 0;
            font-size: 18px;
            color: #333;
        }
        #parkrun-club-modal .date-inputs {
            margin-bottom: 16px;
        }
        #parkrun-club-modal .date-field {
            margin-bottom: 12px;
        }
        #parkrun-club-modal .date-field label {
            display: block;
            margin-bottom: 6px;
            font-size: 14px;
            color: #555;
        }
        #parkrun-club-modal .date-field input {
            width: 100%;
            padding: 10px 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            box-sizing: border-box;
        }
        #parkrun-club-modal .date-field input:focus {
            outline: none;
            border-color: #11998e;
        }
        #parkrun-club-modal .radio-group {
            margin-bottom: 16px;
        }
        #parkrun-club-modal .radio-group-label {
            display: block;
            margin-bottom: 8px;
            font-size: 14px;
            color: #555;
            font-weight: 500;
        }
        #parkrun-club-modal .radio-option {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            margin: 6px 0;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        #parkrun-club-modal .radio-option:hover {
            border-color: #11998e;
            background: #f0fdf4;
        }
        #parkrun-club-modal .radio-option.selected {
            border-color: #11998e;
            background: #ecfdf5;
        }
        #parkrun-club-modal .radio-option input {
            margin-right: 10px;
        }
        #parkrun-club-modal .radio-option label {
            cursor: pointer;
            flex: 1;
            font-size: 14px;
            color: #333;
        }
        #parkrun-club-modal .button-group {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        #parkrun-club-modal button {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        #parkrun-club-modal .btn-cancel {
            background: #f0f0f0;
            color: #666;
        }
        #parkrun-club-modal .btn-cancel:hover {
            background: #e0e0e0;
        }
        #parkrun-club-modal .btn-start {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
            color: white;
        }
        #parkrun-club-modal .btn-start:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(17, 153, 142, 0.4);
        }
    `);

    // Create floating button
    const button = document.createElement('button');
    button.id = 'parkrun-club-scraper-button';
    button.textContent = '🏃 Scrape Club Results';
    document.body.appendChild(button);

    // Create status display
    const statusDiv = document.createElement('div');
    statusDiv.id = 'parkrun-club-scraper-status';
    document.body.appendChild(statusDiv);

    // Check if scraper is already running
    const storedConfig = sessionStorage.getItem(STORAGE_KEY);

    if (storedConfig) {
        button.textContent = '🔄 Scraper Running...';
        button.classList.add('active');
        button.onclick = function() {
            if (confirm('Stop the club scraper?')) {
                // Set the stop flag that the scraper checks
                window.stopParkrunScraper = true;
                sessionStorage.removeItem(STORAGE_KEY);
                button.textContent = '🏃 Scrape Club Results';
                button.classList.remove('active');
                statusDiv.style.display = 'none';
                console.log('✅ Parkrun Club Scraper stopped');
            }
        };

        // Auto-run scraper
        runScraper();
        return;
    }

    // Get API key from localStorage or prompt user
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

    // Show modal dialog for scraper configuration
    function showConfigModal(apiKey) {
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'parkrun-club-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Club Results Scraper</h3>
                <div class="date-inputs">
                    <div class="date-field">
                        <label for="start-date">Start Date</label>
                        <input type="date" id="start-date" value="${getDefaultStartDate()}">
                    </div>
                    <div class="date-field">
                        <label for="end-date">End Date</label>
                        <input type="date" id="end-date" value="${getDefaultEndDate()}">
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

        // Handle radio option clicks
        const radioOptions = modal.querySelectorAll('.radio-option');
        radioOptions.forEach(option => {
            option.addEventListener('click', () => {
                radioOptions.forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                option.querySelector('input').checked = true;
            });
        });

        // Handle cancel
        modal.querySelector('.btn-cancel').addEventListener('click', () => {
            modal.remove();
            console.log('❌ Scraper cancelled');
        });

        // Handle start
        modal.querySelector('.btn-start').addEventListener('click', () => {
            const startDateInput = modal.querySelector('#start-date').value;
            const endDateInput = modal.querySelector('#end-date').value;
            const selectedMode = modal.querySelector('input[name="import-mode"]:checked').value;

            if (!startDateInput || !endDateInput) {
                alert('❌ Both dates are required');
                return;
            }

            // Validate dates
            const startDate = new Date(startDateInput);
            const endDate = new Date(endDateInput);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                alert('❌ Invalid date format');
                return;
            }

            if (startDate > endDate) {
                alert('❌ Start date must be before end date');
                return;
            }

            const replaceMode = selectedMode === 'replace';

            const config = {
                startDate: startDateInput,
                endDate: endDateInput,
                replaceMode,
                apiEndpoint: 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import',
                apiKey: apiKey,
                clubNum: CLUB_NUM,
                active: true
            };

            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));

            console.log('✅ Parkrun Club Scraper activated!');
            console.log('Configuration:', config);

            button.textContent = '🔄 Scraper Running...';
            button.classList.add('active');
            button.onclick = function() {
                if (confirm('Stop the club scraper?')) {
                    // Set the stop flag that the scraper checks
                    window.stopParkrunScraper = true;
                    sessionStorage.removeItem(STORAGE_KEY);
                    button.textContent = '🏃 Scrape Club Results';
                    button.classList.remove('active');
                    statusDiv.style.display = 'none';
                    console.log('✅ Parkrun Club Scraper stopped');
                }
            };

            modal.remove();

            // Start scraping immediately
            runScraper();
        });

        // Close modal on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                console.log('❌ Scraper cancelled');
            }
        });
    }

    // Button click handler - start scraper
    button.onclick = function() {
        const apiKey = getApiKey();
        if (!apiKey) return;

        showConfigModal(apiKey);
    };

    function getDefaultStartDate() {
        const date = new Date();
        date.setDate(date.getDate() - 14); // 2 weeks ago
        return date.toISOString().split('T')[0];
    }

    function getDefaultEndDate() {
        return new Date().toISOString().split('T')[0]; // Today
    }

    function showStatus(message) {
        statusDiv.textContent = message;
        statusDiv.style.display = 'block';
        console.log(message);
    }

    function runScraper() {
        const storedConfig = sessionStorage.getItem(STORAGE_KEY);
        if (!storedConfig) return;

        const config = JSON.parse(storedConfig);

        showStatus(`📅 Scraping: ${config.startDate} to ${config.endDate}`);

        // Build URL with query parameters
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('clubNum', config.clubNum.toString());
        currentUrl.searchParams.set('startDate', config.startDate);
        currentUrl.searchParams.set('endDate', config.endDate);
        currentUrl.searchParams.set('apiEndpoint', config.apiEndpoint);
        currentUrl.searchParams.set('apiKey', config.apiKey);
        currentUrl.searchParams.set('autoUpload', 'true');
        currentUrl.searchParams.set('replaceMode', config.replaceMode.toString());

        // Update browser URL without reload
        window.history.replaceState({}, '', currentUrl.toString());

        // Inject and execute the scraper script
        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.onload = function() {
            console.log('✅ Club scraper script loaded and executing...');
            showStatus('🔄 Scraper running... Check console for progress');

            // Monitor for completion or stop
            const checkInterval = setInterval(() => {
                // Check if scraper was stopped
                if (window.stopParkrunScraper) {
                    clearInterval(checkInterval);
                    button.textContent = '🛑 Scraper Stopped';
                    button.classList.remove('active');
                    showStatus('🛑 Scraper stopped by user');
                    sessionStorage.removeItem(STORAGE_KEY);

                    setTimeout(() => {
                        button.textContent = '🏃 Scrape Club Results';
                        button.onclick = function() {
                            const apiKey = getApiKey();
                            if (!apiKey) return;
                            showConfigModal(apiKey);
                        };
                        statusDiv.style.display = 'none';
                    }, 3000);
                    return;
                }

                // Check if scraper completed successfully
                if (sessionStorage.getItem('parkrun_scraper_completed')) {
                    clearInterval(checkInterval);
                    button.textContent = '✅ Scraping Complete!';
                    button.classList.remove('active');
                    button.classList.add('completed');
                    showStatus('✅ Scraping completed successfully!');
                    sessionStorage.removeItem(STORAGE_KEY);
                    sessionStorage.removeItem('parkrun_scraper_completed');

                    setTimeout(() => {
                        button.textContent = '🏃 Scrape Club Results';
                        button.classList.remove('completed');
                        button.onclick = function() {
                            const apiKey = getApiKey();
                            if (!apiKey) return;
                            showConfigModal(apiKey);
                        };
                        statusDiv.style.display = 'none';
                    }, 5000);
                }
            }, 1000);
        };
        script.onerror = function() {
            console.error('❌ Failed to load scraper script from:', SCRIPT_URL);
            showStatus('❌ Failed to load scraper script');
            button.textContent = '❌ Error - Try Again';
            button.classList.remove('active');
            sessionStorage.removeItem(STORAGE_KEY);
        };
        document.head.appendChild(script);
    }

})();
