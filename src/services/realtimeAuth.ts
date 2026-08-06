import { supabase } from '../supabase';

const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Returns a verified, current Supabase access token for the same-origin
 * WebSocket relay. The token is sent in the first WebSocket message, never in
 * the URL, so it does not leak into browser history or proxy access logs.
 */
export async function getRealtimeAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Unable to read the Supabase session: ${error.message}`);

  let session = data.session;
  if (!session) throw new Error('No authenticated Supabase session is available.');

  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (expiresAtMs > 0 && expiresAtMs - Date.now() <= TOKEN_REFRESH_MARGIN_MS) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw new Error(`Unable to refresh the Supabase session: ${refreshError.message}`);
    session = refreshed.session;
  }

  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('The Supabase session did not provide an access token.');
  return accessToken;
}
