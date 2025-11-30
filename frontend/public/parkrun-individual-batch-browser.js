/**
 * Parkrun Individual Athlete Batch Scraper - Browser Version
 *
 * Automatically scrapes all athletes' individual parkrun histories
 * by navigating through each athlete's page in sequence.
 *
 * HOW TO USE:
 * 1. Open https://www.parkrun.com.au/parkrunner/ANYID/all/
 * 2. Open browser console (F12)
 * 3. Paste this script and press Enter
 * 4. The script will automatically cycle through all athletes
 *
 * FEATURES:
 * - Fetches list of athletes from API
 * - Automatically navigates to each athlete's page
 * - Scrapes and uploads results
 * - Shows progress
 * - Handles errors gracefully
 */

(async function() {
  console.clear();
  console.log('🏃 Parkrun Individual Batch Scraper (Browser) v1.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ========== CONFIGURATION ==========
  const urlParams = new URLSearchParams(window.location.search);

  const CONFIG = {
    apiEndpoint: urlParams.get('apiEndpoint') || 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import-individual',
    athletesApiEndpoint: urlParams.get('athletesApiEndpoint') || 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape',
    apiKey: urlParams.get('apiKey') || '', // API key for authentication
    mode: urlParams.get('mode') || 'all', // 'new', 'all', or 'single'
    delayBetweenAthletes: parseInt(urlParams.get('delay') || '3000'), // 3 seconds between athletes
    autoNavigate: urlParams.get('autoNavigate') !== 'false', // Auto-navigate to next athlete
    onlyThisAthlete: urlParams.get('onlyThisAthlete') || null, // For single mode
  };

  const modeDescriptions = {
    'new': 'only unscraped athletes',
    'all': 'all athletes',
    'single': 'only this parkrunner'
  };

  console.log('📋 Configuration:');
  console.log(`   API Endpoint: ${CONFIG.apiEndpoint}`);
  console.log(`   Athletes API: ${CONFIG.athletesApiEndpoint}`);
  console.log(`   Mode: ${CONFIG.mode} (${modeDescriptions[CONFIG.mode] || CONFIG.mode})`);
  console.log(`   Delay between athletes: ${CONFIG.delayBetweenAthletes}ms`);
  console.log(`   Auto-navigate: ${CONFIG.autoNavigate ? 'Yes' : 'No'}\n`);

  // Helper to update progress panel if available
  function updateProgress(data) {
    if (window.parkrunScraperProgress) {
      window.parkrunScraperProgress.update(data);
    }
  }

  function logProgress(message, type = 'info') {
    if (window.parkrunScraperProgress) {
      window.parkrunScraperProgress.log(message, type);
    }
  }

  // ========== FETCH ATHLETES TO SCRAPE ==========

  if (!CONFIG.apiKey) {
    console.error('❌ No API key provided!');
    console.log('   Add ?apiKey=YOUR_KEY to the URL');
    return;
  }

  let athletes = [];

  // For single mode, we don't need to fetch the athletes list
  if (CONFIG.mode === 'single') {
    console.log('📊 Single athlete mode - scraping current page only\n');

    // Extract athlete ID from URL
    const urlMatch = window.location.pathname.match(/\/parkrunner\/(\d+)/);
    const currentAthleteId = urlMatch ? urlMatch[1] : null;

    if (!currentAthleteId) {
      console.error('❌ Could not extract athlete ID from URL');
      return;
    }

    // Try to get athlete name from page
    let athleteName = 'Unknown';
    const h2Element = document.querySelector('h2');
    if (h2Element) {
      // Extract name from "FirstName LASTNAME - X parkruns" format
      const nameMatch = h2Element.textContent.match(/^([^-]+)/);
      if (nameMatch) {
        athleteName = nameMatch[1].trim();
      }
    }

    athletes = [{
      parkrun_athlete_id: currentAthleteId,
      athlete_name: athleteName
    }];

    console.log(`✅ Scraping: ${athleteName} (${currentAthleteId})\n`);
    updateProgress({ total: 1, current: 1, athleteName: athleteName });
    logProgress(`Single mode: ${athleteName}`, 'info');
  } else {
    console.log('📊 Fetching athletes to scrape...');

    try {
      const url = new URL(CONFIG.athletesApiEndpoint);
      url.searchParams.set('mode', CONFIG.mode);

      // Add timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      console.log(`   Requesting: ${url.toString()}`);

      const response = await fetch(url.toString(), {
        headers: {
          'X-API-Key': CONFIG.apiKey
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log(`   Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      athletes = data.athletes || [];

      console.log(`✅ Found ${athletes.length} athletes to scrape\n`);
      updateProgress({ total: athletes.length });
      logProgress(`Found ${athletes.length} athletes`, 'success');

      if (athletes.length === 0) {
        console.log('⚠️  No athletes to scrape');
        if (CONFIG.mode === 'new') {
          console.log('   All athletes have already been scraped!');
          console.log('   Use mode=all to re-scrape everyone.');
        }
        return;
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('❌ Request timed out after 30 seconds');
      } else {
        console.error('❌ Failed to fetch athletes:', error.message);
      }
      console.log('\nℹ️  You can manually provide athletes by setting window.athletesToScrape');
      console.log('   Example: window.athletesToScrape = [{parkrun_athlete_id: "123", athlete_name: "John"}]');
      return;
    }
  }

  // ========== GET CURRENT ATHLETE INDEX ==========

  // Extract current athlete ID from URL
  const urlMatch = window.location.pathname.match(/\/parkrunner\/(\d+)/);
  const currentAthleteId = urlMatch ? urlMatch[1] : null;

  // Find current athlete in the list
  let currentIndex = -1;
  if (currentAthleteId) {
    currentIndex = athletes.findIndex(a => a.parkrun_athlete_id === currentAthleteId);
  }

  // Always start from index 0 to ensure we scrape all athletes
  if (currentIndex !== 0) {
    console.log('🔄 Starting from first athlete to ensure complete scrape...\n');

    const firstAthlete = athletes[0];
    const correctUrl = new URL(`https://www.parkrun.com.au/parkrunner/${firstAthlete.parkrun_athlete_id}/all/`);
    correctUrl.searchParams.set('apiKey', CONFIG.apiKey);
    correctUrl.searchParams.set('apiEndpoint', CONFIG.apiEndpoint);
    correctUrl.searchParams.set('athletesApiEndpoint', CONFIG.athletesApiEndpoint);
    correctUrl.searchParams.set('mode', CONFIG.mode);
    correctUrl.searchParams.set('delay', CONFIG.delayBetweenAthletes.toString());
    correctUrl.searchParams.set('autoNavigate', CONFIG.autoNavigate.toString());

    console.log(`🌐 Redirecting to: ${correctUrl.toString()}\n`);
    window.location.href = correctUrl.toString();
    return;
  }

  const currentAthlete = athletes[currentIndex];

  // CRITICAL: Verify we're on the correct athlete's page before scraping
  // This prevents scraping wrong data if URL was manipulated or page redirected
  if (currentAthleteId !== currentAthlete.parkrun_athlete_id) {
    console.error(`❌ Page mismatch! URL has athlete ${currentAthleteId} but expected ${currentAthlete.parkrun_athlete_id}`);
    console.log('   This should not happen. Navigating to correct page...\n');

    const correctUrl = new URL(`https://www.parkrun.com.au/parkrunner/${currentAthlete.parkrun_athlete_id}/all/`);
    correctUrl.searchParams.set('apiKey', CONFIG.apiKey);
    correctUrl.searchParams.set('apiEndpoint', CONFIG.apiEndpoint);
    correctUrl.searchParams.set('athletesApiEndpoint', CONFIG.athletesApiEndpoint);
    correctUrl.searchParams.set('mode', CONFIG.mode);
    correctUrl.searchParams.set('delay', CONFIG.delayBetweenAthletes.toString());
    correctUrl.searchParams.set('autoNavigate', CONFIG.autoNavigate.toString());

    window.location.href = correctUrl.toString();
    return;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 Current Progress: ${currentIndex + 1}/${athletes.length}`);
  console.log(`🏃 Athlete: ${currentAthlete.athlete_name} (${currentAthlete.parkrun_athlete_id})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Update progress panel
  updateProgress({
    current: currentIndex + 1,
    total: athletes.length,
    athleteName: `${currentAthlete.athlete_name} (${currentAthlete.parkrun_athlete_id})`
  });
  logProgress(`Scraping ${currentIndex + 1}/${athletes.length}: ${currentAthlete.athlete_name}`, 'info');

  // Save progress to sessionStorage so it persists across page loads
  const PROGRESS_KEY = 'parkrun_batch_scraper_stats';
  let progressStats = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) || '{"successful":0,"failed":0,"failedAthletes":[]}');
  progressStats.current = currentIndex + 1;
  progressStats.total = athletes.length;
  progressStats.athleteName = `${currentAthlete.athlete_name} (${currentAthlete.parkrun_athlete_id})`;
  sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(progressStats));

  // ========== SCRAPE CURRENT ATHLETE ==========

  console.log('🔍 Looking for results table...\n');

  // Find the "All Results" table
  let resultsTable = null;
  const tables = document.querySelectorAll('table#results');

  for (const table of tables) {
    const caption = table.querySelector('caption');
    if (caption && caption.textContent.includes('All') && caption.textContent.includes('Results')) {
      resultsTable = table;
      break;
    }
  }

  if (!resultsTable) {
    console.error('❌ Could not find the "All Results" table on this page');
    console.log('   Make sure you are on the /all/ page showing all results\n');

    // Move to next athlete anyway
    if (CONFIG.autoNavigate && currentIndex + 1 < athletes.length) {
      await moveToNextAthlete(athletes, currentIndex);
    }
    return;
  }

  console.log('✓ Found results table\n');

  // ========== EXTRACT RESULTS ==========

  const results = [];
  const tbody = resultsTable.querySelector('tbody');

  if (!tbody) {
    console.error('❌ No table body found');
    return;
  }

  const rows = Array.from(tbody.querySelectorAll('tr'));
  console.log(`📊 Found ${rows.length} result rows\n`);

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td'));

    // Expected columns: Event | Run Date | Run Number | Pos | Time | Age Grade | PB?
    if (cells.length < 7) {
      console.warn('⚠️  Skipping row with insufficient columns:', cells.length);
      continue;
    }

    // Extract data from cells
    const eventCell = cells[0];
    const dateCell = cells[1];
    const runNumberCell = cells[2];
    const positionCell = cells[3];
    const timeCell = cells[4];
    const ageGradeCell = cells[5];
    const pbCell = cells[6];

    // Event name (from link text)
    const eventLink = eventCell.querySelector('a');
    let eventName = eventLink ? eventLink.textContent.trim() : eventCell.textContent.trim();

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

    // Date (from span.format-date)
    const dateSpan = dateCell.querySelector('span.format-date');
    const dateText = dateSpan ? dateSpan.textContent.trim() : dateCell.textContent.trim();

    // Parse date from DD/MM/YYYY to YYYY-MM-DD
    let isoDate = '';
    if (dateText) {
      const dateParts = dateText.split('/');
      if (dateParts.length === 3) {
        const [day, month, year] = dateParts;
        isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }

    // Run number (event number)
    const runNumber = runNumberCell.textContent.trim();

    // Position
    const position = positionCell.textContent.trim();

    // Time
    const time = timeCell.textContent.trim();

    // Age Grade (remove % sign)
    let ageGrade = ageGradeCell.textContent.trim();
    if (ageGrade.endsWith('%')) {
      ageGrade = ageGrade.slice(0, -1);
    }

    // PB indicator (check if cell has content besides whitespace)
    const isPB = pbCell.textContent.trim() !== '';

    // Skip if essential data is missing
    if (!eventName || !isoDate || !time) {
      console.warn('⚠️  Skipping row with missing essential data:', {eventName, date: isoDate, time});
      continue;
    }

    // Build result object
    const result = {
      'Parkrun ID': currentAthlete.parkrun_athlete_id,
      'parkrunner': currentAthlete.athlete_name,
      'Event': eventName,
      'Date': isoDate,
      'Run Number': runNumber,
      'Pos': position,
      'Time': time,
      'Age Grade': ageGrade,
      'PB': isPB ? 'Yes' : '',
      'Data Source': 'individual'
    };

    results.push(result);
  }

  console.log(`✅ Extracted ${results.length} results\n`);

  if (results.length === 0) {
    console.log('⚠️  No results found for this athlete');
  }

  // ========== CONVERT TO CSV ==========

  function convertToCSV(data) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];

    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header] || '';
        // Escape commas and quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }

  const csvData = convertToCSV(results);

  // ========== UPLOAD TO API WITH RETRY LOGIC ==========

  async function uploadToAPI(csvData) {
    if (!CONFIG.apiEndpoint) {
      console.log('\n⚠️  No API endpoint configured, skipping upload');
      return { success: false, error: 'No API endpoint' };
    }

    const url = new URL(CONFIG.apiEndpoint);

    console.log(`\n📤 Uploading to ${url.toString()}...`);
    console.log(`   Athlete ID: ${currentAthlete.parkrun_athlete_id}`);
    console.log(`   Results: ${results.length}\n`);

    // Fibonacci backoff: 1s, 1s, 2s, 3s, 5s, 8s, 13s, 21s, 34s, 55s, 89s, 144s, 233s (~5 min total)
    const fibonacciDelays = [1000, 1000, 2000, 3000, 5000, 8000, 13000, 21000, 34000, 55000, 89000, 144000, 233000];
    const maxRetries = fibonacciDelays.length;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Create a File object from CSV data
        const blob = new Blob([csvData], { type: 'text/csv' });
        const file = new File([blob], `parkrun-individual-${currentAthlete.parkrun_athlete_id}.csv`, { type: 'text/csv' });

        // Create FormData
        const formData = new FormData();
        formData.append('file', file);
        formData.append('parkrun_athlete_id', currentAthlete.parkrun_athlete_id);
        formData.append('athlete_name', currentAthlete.athlete_name);

        const response = await fetch(url.toString(), {
          method: 'POST',
          body: formData,
          headers: {
            'X-API-Key': CONFIG.apiKey
          }
        });

        if (!response.ok) {
          let errorDetails = '';
          try {
            const errorData = await response.json();
            errorDetails = errorData.message || errorData.error || JSON.stringify(errorData);
          } catch {
            errorDetails = await response.text();
          }

          // 503 Service Unavailable or 5xx errors - retry
          if (response.status >= 500 && attempt < maxRetries) {
            const delay = fibonacciDelays[attempt];
            console.warn(`⚠️  Upload failed (${response.status}): ${errorDetails}`);
            console.log(`   Retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry
          }

          throw new Error(`Upload failed (${response.status}): ${errorDetails}`);
        }

        const result = await response.json();
        console.log('✅ UPLOAD SUCCESSFUL!');
        console.log('   Response:', result);
        console.log(`   New results added: ${result.new_results_added || 0}`);
        console.log(`   Duplicates skipped: ${result.duplicates_skipped || 0}`);

        if (attempt > 0) {
          console.log(`   (Succeeded after ${attempt} ${attempt === 1 ? 'retry' : 'retries'})`);
        }

        return { success: true, result };

      } catch (error) {
        // Network errors (CORS, connection failed, etc.) - retry
        if (error.message.includes('fetch') || error.message.includes('CORS') || error.message.includes('network')) {
          if (attempt < maxRetries) {
            const delay = fibonacciDelays[attempt];
            console.warn(`⚠️  Network error: ${error.message}`);
            console.log(`   Retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry
          }
        }

        // Final failure after all retries
        console.error(`❌ Upload failed after ${attempt + 1} attempts: ${error.message}`);
        return { success: false, error: error.message, attempts: attempt + 1 };
      }
    }

    // Should never reach here, but just in case
    return { success: false, error: 'Max retries exceeded', attempts: maxRetries + 1 };
  }

  // Upload results
  let uploadResult = { success: true }; // Default success for no results
  if (results.length > 0) {
    uploadResult = await uploadToAPI(csvData);
  } else {
    console.log('ℹ️  No results to upload');
  }

  // Track upload statistics in sessionStorage
  const STATS_KEY = 'parkrun_batch_scraper_stats';
  let stats = JSON.parse(sessionStorage.getItem(STATS_KEY) || '{"successful":0,"failed":0,"failedAthletes":[]}');

  if (uploadResult.success) {
    stats.successful++;
    logProgress(`✓ ${currentAthlete.athlete_name}: ${uploadResult.result?.new_results_added || 0} new`, 'success');
  } else {
    stats.failed++;
    stats.failedAthletes.push({
      name: currentAthlete.athlete_name,
      id: currentAthlete.parkrun_athlete_id,
      error: uploadResult.error,
      attempts: uploadResult.attempts
    });
    logProgress(`✗ ${currentAthlete.athlete_name}: ${uploadResult.error}`, 'error');
  }

  sessionStorage.setItem(STATS_KEY, JSON.stringify(stats));

  // Update progress panel with stats
  updateProgress({
    success: stats.successful,
    errors: stats.failed
  });

  // If upload failed after all retries, stop the scraper
  if (!uploadResult.success) {
    console.error('\n❌❌❌ SCRAPER STOPPED DUE TO UPLOAD FAILURE ❌❌❌\n');
    console.error('📊 FINAL STATISTICS:');
    console.error(`   ✅ Successful uploads: ${stats.successful}`);
    console.error(`   ❌ Failed uploads: ${stats.failed}`);
    console.error(`   📝 Total athletes attempted: ${stats.successful + stats.failed}`);
    console.error(`   📉 Remaining athletes: ${athletes.length - currentIndex - 1}`);

    if (stats.failedAthletes.length > 0) {
      console.error('\n❌ FAILED ATHLETES:');
      stats.failedAthletes.forEach((athlete, i) => {
        console.error(`   ${i + 1}. ${athlete.name} (ID: ${athlete.id})`);
        console.error(`      Error: ${athlete.error}`);
        console.error(`      Attempts: ${athlete.attempts || 'N/A'}`);
      });
    }

    console.error('\n💡 To retry: Clear sessionStorage and restart the scraper.');
    console.error('   Run: sessionStorage.removeItem("parkrun_batch_scraper_config")');
    console.error('        sessionStorage.removeItem("parkrun_batch_scraper_stats")');

    // Stop the scraper by not navigating to next athlete
    return;
  }

  // ========== MOVE TO NEXT ATHLETE ==========

  async function moveToNextAthlete(athletes, currentIndex) {
    const nextIndex = currentIndex + 1;

    if (nextIndex >= athletes.length) {
      // Get final stats
      const finalStats = JSON.parse(sessionStorage.getItem(STATS_KEY) || '{"successful":0,"failed":0,"failedAthletes":[]}');

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎉 ALL ATHLETES COMPLETE!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('📊 FINAL STATISTICS:');
      console.log(`   ✅ Successful uploads: ${finalStats.successful}`);
      console.log(`   ❌ Failed uploads: ${finalStats.failed}`);
      console.log(`   📝 Total athletes: ${athletes.length}`);

      if (finalStats.failedAthletes.length > 0) {
        console.log('\n⚠️  FAILED ATHLETES:');
        finalStats.failedAthletes.forEach((athlete, i) => {
          console.log(`   ${i + 1}. ${athlete.name} (ID: ${athlete.id}) - ${athlete.error}`);
        });
      }

      // Clear stats
      sessionStorage.removeItem(STATS_KEY);
      return;
    }

    const nextAthlete = athletes[nextIndex];

    console.log(`\n⏳ Waiting ${CONFIG.delayBetweenAthletes}ms before next athlete...\n`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenAthletes));

    // Check if scraper was stopped (sessionStorage cleared by tampermonkey button)
    const SCRAPER_CONFIG_KEY = 'parkrun_batch_scraper_config';
    if (!sessionStorage.getItem(SCRAPER_CONFIG_KEY)) {
      console.log('\n🛑 Scraper stopped by user');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      return;
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📍 Moving to athlete ${nextIndex + 1}/${athletes.length}`);
    console.log(`🏃 Next: ${nextAthlete.athlete_name} (${nextAthlete.parkrun_athlete_id})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Build next URL
    const nextUrl = new URL(`https://www.parkrun.com.au/parkrunner/${nextAthlete.parkrun_athlete_id}/all/`);
    nextUrl.searchParams.set('apiKey', CONFIG.apiKey);
    nextUrl.searchParams.set('apiEndpoint', CONFIG.apiEndpoint);
    nextUrl.searchParams.set('athletesApiEndpoint', CONFIG.athletesApiEndpoint);
    nextUrl.searchParams.set('mode', CONFIG.mode);
    nextUrl.searchParams.set('delay', CONFIG.delayBetweenAthletes.toString());
    nextUrl.searchParams.set('autoNavigate', 'true');

    console.log(`🌐 Navigating to: ${nextUrl.toString()}\n`);

    // Navigate to next athlete's page
    window.location.href = nextUrl.toString();
  }

  // Move to next athlete if auto-navigate is enabled
  if (CONFIG.autoNavigate && currentIndex + 1 < athletes.length) {
    await moveToNextAthlete(athletes, currentIndex);
  } else if (currentIndex + 1 >= athletes.length) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ALL ATHLETES COMPLETE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`✅ Scraped ${athletes.length} athletes total`);
  } else {
    console.log('\n✓ Current athlete complete');
    console.log(`\nℹ️  Auto-navigate is disabled. To continue:`);
    console.log(`   1. Manually navigate to next athlete's page`);
    console.log(`   2. Or enable auto-navigate with: ?autoNavigate=true`);
  }

})();
