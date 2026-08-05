import { auth, googleProvider, supabase, toCompatAuthUser, type CompatAuthUser } from '../supabase';
import { migrateLegacyBoardCachesToIndexedDb } from '../utils/boardRecoveryCache';

export type Unsubscribe = () => void;

const OAUTH_INTENT_KEY = 'lucid_spark_oauth_intent_started_at';
const OAUTH_INTENT_MAX_AGE_MS = 2 * 60 * 1000;

let anonymousSignInPromise: Promise<{ user: CompatAuthUser }> | null = null;

function defer(callback: () => void): void {
  if (typeof window !== 'undefined') {
    window.setTimeout(callback, 0);
    return;
  }
  queueMicrotask(callback);
}

function markOAuthIntent(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(OAUTH_INTENT_KEY, String(Date.now()));
  }
}

export function clearOAuthIntent(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(OAUTH_INTENT_KEY);
  }
}

export function isOAuthFlowInProgress(): boolean {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  if (params.has('error') || params.has('error_code') || params.has('error_description')) {
    clearOAuthIntent();
    return false;
  }

  if (params.has('code') || window.location.hash.includes('access_token=')) {
    return true;
  }

  const startedAt = Number(sessionStorage.getItem(OAUTH_INTENT_KEY) || 0);
  if (!startedAt || Date.now() - startedAt > OAUTH_INTENT_MAX_AGE_MS) {
    clearOAuthIntent();
    return false;
  }

  return true;
}

export function getAuthErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: String(error || 'Unknown authentication error') };
  }

  const value = error as Record<string, unknown>;
  return {
    name: value.name || 'AuthError',
    message: value.message || String(error),
    code: value.code,
    status: value.status,
    cause: value.cause,
  };
}

export function onAuthStateChanged(
  _auth: typeof auth,
  callback: (user: CompatAuthUser | null) => void
): Unsubscribe {
  let active = true;
  let lastDeliveredIdentity: string | null | undefined;
  let oauthResolutionTimer: ReturnType<typeof setTimeout> | null = null;

  const deliver = (compatUser: CompatAuthUser | null, event: string) => {
    // Token refreshes should update the cached session without rerunning profile
    // setup and administrator database reads.
    if (event === 'TOKEN_REFRESHED') return;

    const identity = compatUser ? `${compatUser.uid}:${compatUser.isAnonymous ? 'guest' : 'permanent'}` : null;
    if (identity === lastDeliveredIdentity && event !== 'USER_UPDATED') return;
    lastDeliveredIdentity = identity;

    // Supabase recommends keeping the auth callback synchronous. Defer all React
    // work so any database queries triggered by the app run outside the auth lock.
    defer(() => {
      if (active) callback(compatUser);
    });
  };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const compatUser = toCompatAuthUser(session?.user || null);
    auth.setCurrentUser(session?.user || null);

    if (compatUser && !compatUser.isAnonymous) {
      clearOAuthIntent();
    }

    if (compatUser && oauthResolutionTimer) {
      clearTimeout(oauthResolutionTimer);
      oauthResolutionTimer = null;
    }

    // During a Google redirect Supabase can briefly emit an empty initial session
    // before finishing the PKCE code exchange. Do not expose that temporary null
    // state to React, because it previously triggered anonymous sign-up requests.
    if (!compatUser && isOAuthFlowInProgress()) {
      if (!oauthResolutionTimer) {
        oauthResolutionTimer = setTimeout(() => {
          void supabase.auth.getSession().then(({ data: sessionData, error }) => {
            if (!active) return;
            if (error) {
              console.error('Unable to finish Google OAuth session restoration.', getAuthErrorDetails(error));
            }

            const restoredUser = toCompatAuthUser(sessionData.session?.user || null);
            auth.setCurrentUser(sessionData.session?.user || null);
            if (restoredUser && !restoredUser.isAnonymous) clearOAuthIntent();
            else clearOAuthIntent();
            deliver(restoredUser, restoredUser ? 'SIGNED_IN' : 'INITIAL_SESSION');
          });
        }, 8000);
      }
      return;
    }

    deliver(compatUser, event);
  });

  return () => {
    active = false;
    if (oauthResolutionTimer) clearTimeout(oauthResolutionTimer);
    data.subscription.unsubscribe();
  };
}

function cleanRedirectUrl(): string {
  const redirectUrl = new URL(window.location.href);
  ['code', 'error', 'error_code', 'error_description'].forEach((key) => {
    redirectUrl.searchParams.delete(key);
  });
  redirectUrl.hash = '';
  return redirectUrl.toString();
}

export async function signInWithPopup(
  _auth: typeof auth,
  _provider: typeof googleProvider
): Promise<void> {
  // Free legacy full-board localStorage snapshots before Supabase PKCE stores
  // its temporary code verifier. The data is moved to IndexedDB first.
  await migrateLegacyBoardCachesToIndexedDb();
  markOAuthIntent();

  try {
    // Do not carry a temporary anonymous session into a Google login. This avoids
    // the guest session winning a race against the OAuth callback on return.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    if (sessionData.session?.user?.is_anonymous) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      auth.setCurrentUser(null);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: cleanRedirectUrl(),
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
  } catch (error) {
    clearOAuthIntent();
    throw error;
  }
}

export async function signOut(_auth: typeof auth): Promise<void> {
  clearOAuthIntent();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  auth.setCurrentUser(null);
}

export async function signInAnonymously(_auth: typeof auth): Promise<{ user: CompatAuthUser }> {
  await auth.authStateReady();

  if (auth.currentUser) {
    return { user: auth.currentUser };
  }

  if (isOAuthFlowInProgress()) {
    throw Object.assign(
      new Error('Google sign-in is still being completed. Guest sign-in was not started.'),
      { code: 'oauth_in_progress' }
    );
  }

  if (anonymousSignInPromise) return anonymousSignInPromise;

  anonymousSignInPromise = (async () => {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;

    const user = toCompatAuthUser(data.user);
    if (!user) throw new Error('Supabase anonymous sign-in returned no user.');

    auth.setCurrentUser(data.user);
    return { user };
  })();

  try {
    return await anonymousSignInPromise;
  } finally {
    anonymousSignInPromise = null;
  }
}
