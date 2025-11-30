/**
 * Parkrun Smart Scraper - Automated Multi-Date Collection
 *
 * This script intelligently collects data across multiple dates by:
 * 1. Running entirely in the browser (bypassing parkrun's server-side blocking)
 * 2. Using fetch() with proper browser context to avoid detection
 * 3. Parsing responses without page reloads for speed
 * 4. Adding realistic delays to mimic human behavior
 *
 * HOW TO USE:
 * 1. Open https://www.parkrun.com/results/consolidatedclub/?clubNum=19959
 * 2. Open browser console (F12)
 * 3. Paste this script and press Enter
 * 4. Wait for completion (progress shown in console)
 * 5. Copy the CSV output
 *
 * ADVANTAGES over page-reload approach:
 * - Much faster (no page reloads)
 * - More reliable (stays in one tab)
 * - Better for parkrun's servers (fewer full page loads)
 * - Handles errors gracefully
 */

(async function() {
  console.clear();
  console.log('🏃 Parkrun Smart Scraper v4.2');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Global stop flag
  window.stopParkrunScraper = false;

  // Clear completion flag from previous runs
  sessionStorage.removeItem('parkrun_scraper_completed');

  // ========== CONFIGURATION ==========
  // Get config from URL params or use defaults
  const urlParams = new URLSearchParams(window.location.search);

  const CONFIG = {
    clubNum: parseInt(urlParams.get('clubNum') || '19959'), // Woodstock Runners
    startDate: urlParams.get('startDate') || '2022-01-01', // Default: Start of 2022
    endDate: urlParams.get('endDate') || new Date().toISOString().split('T')[0], // Today
    delayBetweenRequests: 2000, // 2 seconds (be respectful)
    clubName: 'Woodstock Runners', // Exact club name to filter
    maxFibonacciWait: 34, // Maximum fibonacci backoff in seconds (matches server-side)
    batchSize: 3, // Upload to API every 3 dates (reduced to avoid D1 query limits)
    apiEndpoint: urlParams.get('apiEndpoint') || 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import', // API endpoint to POST results
    apiKey: urlParams.get('apiKey') || '', // API key for authentication
    autoUpload: urlParams.get('autoUpload') !== 'false', // Auto-upload by default (disable with autoUpload=false)
    replaceMode: urlParams.get('replaceMode') === 'true', // Replace all existing data on first upload
  };

  // ========== HELPER FUNCTIONS ==========

  /**
   * Generate Fibonacci sequence up to max value
   * Used for progressive backoff when pages return no results
   */
  function getFibonacciSequence(maxValue) {
    const fib = [1, 1];
    while (true) {
      const next = fib[fib.length - 1] + fib[fib.length - 2];
      if (next > maxValue) break;
      fib.push(next);
    }
    return fib;
  }

  function getSaturdaysInRange(startDate, endDate) {
    const saturdays = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current.getDay() !== 6) {
      current.setDate(current.getDate() + 1);
    }

    while (current <= end) {
      saturdays.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 7);
    }

    return saturdays;
  }

  /**
   * Get special parkrun dates (Christmas Day and New Year's Day) within range
   * Parkrun often runs on these days even though they're not Saturdays
   */
  function getSpecialParkrunDates(startDate, endDate) {
    const specialDates = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    // Generate Christmas (Dec 25) and New Year (Jan 1) for each year in range
    for (let year = startYear; year <= endYear; year++) {
      // Christmas Day
      const christmas = new Date(`${year}-12-25`);
      if (christmas >= start && christmas <= end) {
        specialDates.push(christmas.toISOString().split('T')[0]);
      }

      // New Year's Day
      const newYear = new Date(`${year}-01-01`);
      if (newYear >= start && newYear <= end) {
        specialDates.push(newYear.toISOString().split('T')[0]);
      }
    }

    return specialDates;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function parseHTMLString(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  /**
   * Extract results from consolidated club HTML
   * This page contains MULTIPLE events, each with:
   * - <h2>Event Name parkrun</h2>
   * - <p>Description with event link</p>
   * - <table> with results (Position | Gender Position | parkrunner | Club | Time)
   *
   * Important: First male and first female are marked with <strong> tags
   * and may be from other clubs. We ONLY want Woodstock Runners results.
   */
  function extractResultsFromHTML(html, eventDate) {
    const doc = parseHTMLString(html);
    const allResults = [];

    // Find all H2 headers (each represents an event)
    const eventHeaders = doc.querySelectorAll('h2');

    console.log(`  Found ${eventHeaders.length} event headers`);

    for (const h2 of eventHeaders) {
      // Get event name and clean it
      // Remove " parkrun" from the name (handles both "Name parkrun" and "Name parkrun, Location")
      let eventName = h2.textContent.trim();
      eventName = eventName.replace(/\s+parkrun,/i, ','); // "Name parkrun, Location" → "Name, Location"
      eventName = eventName.replace(/\s+parkrun$/i, '');  // "Name parkrun" → "Name"
      eventName = eventName.trim();

      // Remove language-specific prefixes FIRST (e.g., "parkrun de/du Montsouris" → "Montsouris")
      // Must check these BEFORE "parkrun " to avoid leaving language prefix
      if (eventName.startsWith('parkrun de ')) {
        eventName = eventName.substring(11); // Remove "parkrun de " (11 characters)
      } else if (eventName.startsWith('parkrun du ')) {
        eventName = eventName.substring(11); // Remove "parkrun du " (11 characters)
      }
      // Remove "parkrun " prefix (e.g., "parkrun Ogród Saski, Lublin" → "Ogród Saski, Lublin")
      else if (eventName.startsWith('parkrun ')) {
        eventName = eventName.substring(8); // Remove "parkrun " (8 characters)
      }

      eventName = eventName.trim();

      // Note: Event name mappings are handled by the backend database table
      // (parkrun_event_name_mappings) - no need to duplicate here

      // Skip if not an event name (like "Consolidated club report")
      if (!eventName || eventName.toLowerCase().includes('consolidated') || eventName.toLowerCase().includes('report')) {
        continue;
      }

      // Find the next table after this h2
      let currentElement = h2.nextElementSibling;
      let resultsTable = null;

      while (currentElement) {
        if (currentElement.tagName === 'TABLE') {
          resultsTable = currentElement;
          break;
        }
        if (currentElement.tagName === 'H2') {
          // Reached next event, stop looking
          break;
        }
        currentElement = currentElement.nextElementSibling;
      }

      if (!resultsTable) {
        console.log(`  ⚠️  No table found for ${eventName}`);
        continue;
      }

      console.log(`  Processing event: ${eventName}`);

      // Get all rows from the table body
      const tbody = resultsTable.querySelector('tbody') || resultsTable;
      const rows = Array.from(tbody.querySelectorAll(':scope > tr')).slice(1); // Skip header row

      let clubMembersFound = 0;

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        if (cells.length < 5) continue; // Need exactly 5 columns: Pos | Gender Pos | Name | Club | Time

        // Column structure: [0] Overall Position | [1] Gender Position | [2] Name | [3] Club | [4] Time
        const position = cells[0]?.textContent.trim() || '';
        const genderPosition = cells[1]?.textContent.trim() || '';
        const runnerName = cells[2]?.textContent.trim() || '';
        const club = cells[3]?.textContent.trim() || '';
        const time = cells[4]?.textContent.trim() || '';

        // Extract parkrun ID from the runner name link (e.g., https://www.parkrun.com.au/lakeview/parkrunner/6125390)
        // Note: Link might be wrapped in <strong> or other tags, so we search within the cell
        let parkrunId = '';
        const nameLink = cells[2]?.querySelector('a');
        if (nameLink) {
          const href = nameLink.getAttribute('href') || '';
          // Extract ID from URL - it's the last part after /parkrunner/
          const match = href.match(/\/parkrunner\/(\d+)/);
          if (match) {
            parkrunId = match[1];
          }
        }

        // Skip if we don't have essential data
        if (!runnerName || !time) continue;

        // CRITICAL: Only include Woodstock Runners members
        if (!club.includes(CONFIG.clubName)) {
          continue;
        }

        clubMembersFound++;

        // Build result object
        const result = {
          Date: eventDate,
          Event: eventName,
          Pos: position,
          parkrunner: runnerName,
          'Parkrun ID': parkrunId,
          Time: time,
          'Gender Pos': genderPosition,
        };

        allResults.push(result);
      }

      if (clubMembersFound > 0) {
        console.log(`    ✓ Found ${clubMembersFound} Woodstock Runners results`);
      }
    }

    return allResults;
  }

  /**
   * Fetch results for a specific date with Fibonacci backoff
   * If no results found, retries with progressively longer delays: 1s, 1s, 2s, 3s, 5s, 8s, 13s, 21s, 34s
   * This matches the server-side implementation for consistency
   */
  async function fetchDateResults(eventDate, fibonacciWaits, consecutiveEmptyResults = 0) {
    const url = `https://www.parkrun.com/results/consolidatedclub/?clubNum=${CONFIG.clubNum}&eventdate=${eventDate}`;

    try {
      console.log(`  🌐 Fetching URL: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include', // Important: includes cookies
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      console.log(`  📄 Received HTML: ${html.length} bytes`);

      // Check for explicit "no results" message (e.g., during COVID lockdown periods)
      // This message appears when parkrun explicitly states no events ran on this date
      if (html.includes('We do not appear to have any results for this club/date combination')) {
        console.log(`  ℹ️  Parkrun explicitly states no results for this date (likely no events ran)`);
        return { success: true, results: [], date: eventDate };
      }

      // Check if we got valid parkrun HTML
      if (!html.includes('parkrun') && !html.includes('consolidatedclub')) {
        console.warn(`  ⚠️  Response doesn't look like parkrun HTML (might be error page)`);
        console.log(`  📝 First 500 chars: ${html.substring(0, 500)}`);
      }

      const results = extractResultsFromHTML(html, eventDate);
      console.log(`  📊 Extracted ${results.length} results from HTML`);

      if (results.length === 0) {
        consecutiveEmptyResults++;

        // Log some diagnostic info
        const hasTable = html.includes('<table');
        const hasRows = html.includes('<tr');
        const hasClubName = html.includes(CONFIG.clubName);
        console.log(`  🔍 Diagnostics: table=${hasTable}, rows=${hasRows}, club="${CONFIG.clubName}"=${hasClubName}`);

        // On 4th attempt, open a new tab to help bypass anti-scraping measures
        if (consecutiveEmptyResults === 4) {
          console.log(`  🆕 Opening new tab to refresh session (attempt 4/${fibonacciWaits.length})`);
          try {
            window.open(url, '_blank');
            console.log(`  💡 New tab opened - this can help bypass parkrun's anti-scraping measures`);
          } catch (err) {
            console.warn(`  ⚠️  Could not open new tab (popups may be blocked): ${err.message}`);
          }
        }

        // Check if we've exhausted all Fibonacci waits
        if (consecutiveEmptyResults > fibonacciWaits.length) {
          console.log(`  ℹ️  No results after ${fibonacciWaits.length} retries, moving on`);
          console.log(`  💡 This might mean: no parkruns on ${eventDate}, or club members didn't register their club`);
          return { success: true, results: [], date: eventDate };
        }

        // Apply Fibonacci backoff
        const waitSeconds = fibonacciWaits[consecutiveEmptyResults - 1];
        console.log(`  ⏳ 0 results, waiting ${waitSeconds}s before fetching fresh HTML (attempt ${consecutiveEmptyResults}/${fibonacciWaits.length})`);
        await sleep(waitSeconds * 1000);

        // Retry with a fresh fetch (new request to server)
        console.log(`  🔄 Retrying with fresh fetch...`);
        return fetchDateResults(eventDate, fibonacciWaits, consecutiveEmptyResults);
      }

      // Success - found results
      console.log(`  ✅ Successfully extracted ${results.length} ${CONFIG.clubName} results`);
      return { success: true, results, date: eventDate };

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      return { success: false, results: [], date: eventDate, error: error.message };
    }
  }

  function convertToCSV(allResults) {
    if (allResults.length === 0) {
      return 'No results found';
    }

    const headers = Object.keys(allResults[0]);
    const csvRows = [headers.join(',')];

    for (const result of allResults) {
      const row = headers.map(h => {
        const value = result[h] || '';
        // Escape commas and quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  async function uploadToAPI(csvData, shouldReplace = false) {
    if (!CONFIG.apiEndpoint) {
      console.log('\n⚠️  No API endpoint configured, skipping upload');
      return false;
    }

    // Properly construct URL with query parameters
    const url = new URL(CONFIG.apiEndpoint);
    // Always remove any existing 'replace' parameter first
    url.searchParams.delete('replace');
    // Only add it if we want to replace
    if (shouldReplace) {
      url.searchParams.set('replace', 'true');
    }
    const uploadUrl = url.toString();

    console.log(`\n📤 Uploading to ${uploadUrl}...`);

    try {
      // Create a File object from CSV data
      const blob = new Blob([csvData], { type: 'text/csv' });
      const file = new File([blob], 'parkrun-results.csv', { type: 'text/csv' });

      // Create FormData
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'X-API-Key': CONFIG.apiKey
        }
      });

      if (!response.ok) {
        // Try to get error details from response body
        let errorDetails = '';
        try {
          const errorData = await response.json();
          errorDetails = errorData.message || errorData.error || JSON.stringify(errorData);
        } catch {
          errorDetails = await response.text();
        }
        throw new Error(`Upload failed (${response.status}): ${errorDetails}`);
      }

      const result = await response.json();
      console.log('✅ UPLOAD SUCCESSFUL!');
      console.log('   Response:', result);
      return true;

    } catch (error) {
      console.error('❌ Upload failed:', error.message);
      console.log('   CSV data is still available in console (see above)');
      return false;
    }
  }

  // ========== MAIN EXECUTION ==========

  console.log('Configuration:');
  console.log(`  Club: ${CONFIG.clubName} (#${CONFIG.clubNum})`);
  console.log(`  Date range: ${CONFIG.startDate} to ${CONFIG.endDate}`);
  console.log(`  Delay: ${CONFIG.delayBetweenRequests}ms between requests`);
  console.log(`  Fibonacci backoff: up to ${CONFIG.maxFibonacciWait}s`);
  console.log(`  Batch upload: every ${CONFIG.batchSize} dates`);
  console.log(`  API endpoint: ${CONFIG.apiEndpoint || 'None (manual copy)'}`);
  console.log(`  Auto-upload: ${CONFIG.autoUpload ? 'Yes' : 'No'}`);
  console.log(`  Replace mode: ${CONFIG.replaceMode ? 'Yes (delete all data before scraping)' : 'No (append to existing data)'}`);
  console.log('');
  console.log('💡 To stop the scraper at any time, run: window.stopParkrunScraper = true');
  console.log('');

  // Get all dates to scrape (Saturdays + special dates like Christmas/New Year)
  const saturdays = getSaturdaysInRange(CONFIG.startDate, CONFIG.endDate);
  const specialDates = getSpecialParkrunDates(CONFIG.startDate, CONFIG.endDate);

  const allDates = [...new Set([...saturdays, ...specialDates])].sort();

  console.log(`📅 Dates to scrape: ${allDates.length} days`);
  console.log(`   - Saturdays: ${saturdays.length}`);
  if (specialDates.length > 0) {
    console.log(`   - Special dates (Christmas/New Year): ${specialDates.length}`);
  }
  console.log('');

  // Generate Fibonacci sequence for backoff
  const fibonacciWaits = getFibonacciSequence(CONFIG.maxFibonacciWait);
  console.log(`🔄 Fibonacci backoff sequence: ${fibonacciWaits.join(', ')}s`);
  console.log('');

  // If replace mode is enabled, delete existing data within the date range FIRST before scraping
  if (CONFIG.replaceMode && CONFIG.autoUpload && CONFIG.apiEndpoint) {
    console.log(`🗑️  Replace mode: Deleting parkrun data from ${CONFIG.startDate} to ${CONFIG.endDate}...`);
    try {
      // Send an empty upload with replace=true and date range to trigger the delete
      const emptyBlob = new Blob(['Date,Event,Pos,parkrunner,Time'], { type: 'text/csv' });
      const emptyFile = new File([emptyBlob], 'empty.csv', { type: 'text/csv' });
      const formData = new FormData();
      formData.append('file', emptyFile);

      // Include date range parameters to limit deletion
      const deleteUrl = new URL(CONFIG.apiEndpoint);
      deleteUrl.searchParams.set('replace', 'true');
      deleteUrl.searchParams.set('date_from', CONFIG.startDate);
      deleteUrl.searchParams.set('date_to', CONFIG.endDate);

      const response = await fetch(deleteUrl.toString(), {
        method: 'POST',
        body: formData,
        headers: {
          'X-API-Key': CONFIG.apiKey
        }
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`✅ Deleted ${result.deleted || 0} existing records within date range`);
      } else {
        console.warn('⚠️  Failed to delete existing data, will try with first batch');
      }
    } catch (error) {
      console.warn('⚠️  Error deleting existing data:', error.message);
      console.log('   Will try to delete with first batch instead');
    }
    console.log('');
  }

  // Fetch all dates with batched uploads
  const allResults = [];
  let successCount = 0;
  let failCount = 0;
  let totalUploaded = 0;
  let datesProcessed = 0;

  for (let i = 0; i < allDates.length; i++) {
    // Check if user requested to stop
    if (window.stopParkrunScraper) {
      console.log('\n🛑 Scraper stopped by user');
      console.log(`   Processed ${datesProcessed}/${allDates.length} dates`);
      console.log(`   Collected ${allResults.length} results`);
      break;
    }

    const date = allDates[i];
    const progress = Math.round((i / allDates.length) * 100);

    console.log(`[${i + 1}/${allDates.length}] ${progress}% - ${date}`);

    const { success, results } = await fetchDateResults(date, fibonacciWaits);

    if (success) {
      successCount++;
      allResults.push(...results);
      console.log(`  ✓ Found ${results.length} results`);
    } else {
      failCount++;
    }

    datesProcessed++;

    // Upload batch every BATCH_SIZE dates (if auto-upload enabled and API configured)
    if (CONFIG.autoUpload && CONFIG.apiEndpoint && datesProcessed % CONFIG.batchSize === 0 && allResults.length > totalUploaded) {
      const batchResults = allResults.slice(totalUploaded);
      const batchNum = Math.ceil(datesProcessed / CONFIG.batchSize);
      console.log(`\n📤 Uploading batch ${batchNum} of ${batchResults.length} results (dates ${datesProcessed - CONFIG.batchSize + 1}-${datesProcessed})...`);

      const csvData = convertToCSV(batchResults);
      // Never use replace mode for batch uploads (we already deleted at the start if needed)
      const uploadSuccess = await uploadToAPI(csvData, false);

      if (uploadSuccess) {
        totalUploaded = allResults.length;
        console.log(`✅ Batch ${batchNum} uploaded! Total uploaded so far: ${totalUploaded} results\n`);
      } else {
        console.log(`❌ Batch ${batchNum} upload failed - stopping scraper`);
        console.log(`   To continue scraping without uploads, disable autoUpload`);
        console.log(`   Collected ${allResults.length} results before stopping\n`);
        // Stop the scraper on upload failure
        window.stopParkrunScraper = true;
        break;
      }
    }

    // Add delay between requests (except on last one)
    if (i < allDates.length - 1) {
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  // ========== RESULTS ==========

  const wasStoppedEarly = window.stopParkrunScraper;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (wasStoppedEarly) {
    console.log('🛑 SCRAPING STOPPED');
  } else {
    console.log('✅ SCRAPING COMPLETE');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`📊 Statistics:`);
  console.log(`   Dates processed: ${datesProcessed}/${allDates.length}`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Failed: ${failCount}`);
  console.log(`   Total results: ${allResults.length}`);
  if (CONFIG.autoUpload && CONFIG.apiEndpoint) {
    console.log(`   Uploaded: ${totalUploaded} results`);
    console.log(`   Remaining: ${allResults.length - totalUploaded} results`);
  }
  console.log('');

  if (allResults.length === 0) {
    console.log('⚠️  No results found. Check:');
    console.log('   - Club number is correct (19959 for Woodstock Runners)');
    console.log('   - Date range includes Saturdays');
    console.log('   - Members have registered their club with parkrun');
    // Signal completion for automation (only if not stopped early)
    if (!wasStoppedEarly) {
      window.scraperComplete = true;
      window.scraperResults = { success: false, totalResults: 0, error: 'No results found' };
      sessionStorage.setItem('parkrun_scraper_completed', 'true');
    }
    return;
  }

  // If stopped early, don't mark as complete
  if (wasStoppedEarly) {
    console.log('\n💡 Scraper was stopped. To resume:');
    console.log('   1. Adjust date range if needed');
    console.log('   2. Run the script again');
    console.log('   3. Results collected so far are shown below\n');
    // Don't set completion flags when stopped early
    return;
  }

  // Convert to CSV
  const csvData = convertToCSV(allResults);

  // Upload any remaining results (final batch)
  if (CONFIG.autoUpload && CONFIG.apiEndpoint && allResults.length > totalUploaded) {
    const remainingResults = allResults.slice(totalUploaded);
    console.log(`\n📤 Uploading final batch of ${remainingResults.length} results...`);

    const remainingCSV = convertToCSV(remainingResults);
    // Never use replace mode for batch uploads (we already deleted at the start if needed)
    const uploadSuccess = await uploadToAPI(remainingCSV, false);

    if (uploadSuccess) {
      totalUploaded = allResults.length;
      console.log(`✅ Final batch uploaded! Total: ${totalUploaded} results`);
      console.log('\n🎉 All done! All data uploaded successfully.');
      sessionStorage.setItem('parkrun_scraper_completed', 'true');
      return;
    }
    console.log('\n⚠️  Final upload failed, showing full CSV for manual copy...\n');
  } else if (CONFIG.autoUpload && CONFIG.apiEndpoint && totalUploaded === allResults.length) {
    // All results were uploaded in batches
    console.log('\n🎉 All done! All data uploaded successfully in batches.');
    console.log(`   Total uploaded: ${totalUploaded} results across ${Math.ceil(datesProcessed / CONFIG.batchSize)} batches`);
    sessionStorage.setItem('parkrun_scraper_completed', 'true');
    return;
  }

  // Show CSV for manual copy
  console.log('📋 CSV OUTPUT:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(csvData);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n💡 TIP: Click anywhere in the CSV above, press Ctrl+A (or Cmd+A), then Ctrl+C (or Cmd+C) to copy');

  // Also copy to clipboard if possible
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(csvData);
      console.log('✅ CSV copied to clipboard!');
    } catch (e) {
      console.log('⚠️  Could not auto-copy to clipboard (please copy manually)');
    }
  }

})();
