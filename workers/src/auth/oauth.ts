// OAuth authentication handlers

import { Env } from '../types';
import { buildAuthorizationUrl, exchangeCodeForToken, getAthleteClubs } from '../utils/strava';
import { upsertAthlete, getAthleteByStravaId } from '../utils/db';

/**
 * Handle GET /auth/authorize - redirect to Strava OAuth
 */
export async function handleAuthorize(env: Env): Promise<Response> {
  const authUrl = buildAuthorizationUrl(env);

  return Response.redirect(authUrl, 302);
}

/**
 * Handle GET /auth/callback - OAuth callback from Strava
 */
export async function handleCallback(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Handle authorization denial
  if (error) {
    return new Response(
      JSON.stringify({ error: 'Authorization denied', details: error }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Validate code parameter
  if (!code) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization code' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Exchange code for tokens
    const tokenData = await exchangeCodeForToken(code, env);

    // Check club membership
    const clubs = await getAthleteClubs(tokenData.access_token);
    console.log(`Athlete ${tokenData.athlete.id} clubs:`, JSON.stringify(clubs.map((c: any) => ({ id: c.id, name: c.name }))));
    console.log(`Looking for club ID: ${env.STRAVA_CLUB_ID}`);

    const isWoodstockMember = clubs.some(
      (club: any) => club.id.toString() === env.STRAVA_CLUB_ID
    );

    if (!isWoodstockMember) {
      console.log(`Athlete ${tokenData.athlete.id} is not a Woodstock Runners member`);
      console.log(`Club IDs found:`, clubs.map((c: any) => c.id));

      // Return error page for non-members
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <title>Club Members Only</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .error-box {
      background: white;
      padding: 3rem;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      text-align: center;
      max-width: 450px;
    }
    .error-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 1rem 0;
      color: #333;
      font-size: 1.5rem;
    }
    p {
      color: #666;
      line-height: 1.6;
      margin: 0 0 1.5rem 0;
    }
    .club-link {
      display: inline-block;
      padding: 0.75rem 2rem;
      background: #FC4C02;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin-top: 1rem;
    }
    .club-link:hover {
      background: #e04402;
    }
  </style>
</head>
<body>
  <div class="error-box">
    <div class="error-icon">&#x1F3C3;</div>
    <h1>Club Members Only</h1>
    <p>This application is exclusively for active members of <strong>Woodstock Runners</strong>.</p>
    <p>If you're already a member, please make sure you've joined our Strava club first.</p>
    <a href="https://www.strava.com/clubs/woodstock-runners" class="club-link" target="_blank">
      Join Woodstock Runners on Strava
    </a>
  </div>
</body>
</html>`,
        {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    // Check if this is a new user (first time sign-up)
    const existingAthlete = await getAthleteByStravaId(tokenData.athlete.id, env);
    const isNewUser = !existingAthlete;

    // Store athlete and tokens in database
    await upsertAthlete(
      tokenData.athlete.id,
      tokenData.athlete.firstname,
      tokenData.athlete.lastname,
      tokenData.athlete.profile_medium,
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_at,
      env
    );

    console.log(`Successfully connected Woodstock Runners member: ${tokenData.athlete.id} (new user: ${isNewUser})`);

    // For new users, trigger an immediate sync
    if (isNewUser) {
      try {
        const { syncAthlete } = await import('../sync/rotation-sync');
        const athlete = await getAthleteByStravaId(tokenData.athlete.id, env);
        if (athlete) {
          console.log(`Triggering initial sync for new athlete ${athlete.id}`);
          // Trigger sync without blocking the OAuth response
          // The rotation queue will automatically include this new athlete going forward
          ctx.waitUntil(syncAthlete(env, athlete, 'auto'));
        }
      } catch (syncError) {
        console.error(`Failed to trigger initial sync for new athlete:`, syncError);
        // Don't fail the OAuth flow if sync fails
      }
    }

    // Return success HTML page that closes the popup or redirects
    return new Response(
      `<!DOCTYPE html>
<html>
<head>
  <title>Connected!</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .success-box {
      background: white;
      padding: 3rem;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      text-align: center;
      max-width: 400px;
    }
    .checkmark {
      font-size: 4rem;
      color: #4CAF50;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 1rem 0;
      color: #333;
    }
    p {
      color: #666;
      margin: 0 0 1.5rem 0;
    }
    .button {
      display: inline-block;
      padding: 0.75rem 2rem;
      background: #FC4C02;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="success-box">
    <div class="checkmark">&#x2713;</div>
    <h1>Connected Successfully!</h1>
    <p>Your Strava account has been linked. Your race results are being synced and will appear on the dashboard within a few hours.</p>
    <p style="font-size: 14px; color: #999;">Note: Initial sync may take 1-2 days during busy periods.</p>
    <p id="redirect-msg">Redirecting to dashboard...</p>
  </div>
  <script>
    // Redirect to frontend dashboard with athlete ID in URL
    // The frontend will store it in its own localStorage
    setTimeout(() => {
      window.location.href = 'https://woodstock-results.pages.dev/?athlete_id=${tokenData.athlete.id}';
    }, 2000);

    // If opened in a popup, close it after 3 seconds
    if (window.opener) {
      setTimeout(() => {
        window.opener.postMessage({ type: 'strava-connected' }, '*');
        window.close();
      }, 3000);
    }
  </script>
</body>
</html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error) {
    console.error('OAuth callback error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to connect Strava account',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle DELETE /auth/disconnect - remove athlete data (GDPR)
 */
export async function handleDisconnect(
  request: Request,
  env: Env
): Promise<Response> {
  // In a real implementation, you'd authenticate this request
  // For now, expect strava_id in the request body

  try {
    const body = await request.json() as { strava_id: number };

    if (!body.strava_id) {
      return new Response(
        JSON.stringify({ error: 'Missing strava_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { deleteAthleteData } = await import('../utils/db');
    await deleteAthleteData(body.strava_id, env);

    return new Response(
      JSON.stringify({ message: 'Account disconnected successfully' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Disconnect error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to disconnect account' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
