import { auth, googleProvider, supabase, toCompatAuthUser, type CompatAuthUser } from '../supabase';

export type Unsubscribe = () => void;

export function onAuthStateChanged(
  _auth: typeof auth,
  callback: (user: CompatAuthUser | null) => void
): Unsubscribe {
  let active = true;


  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!active) return;
    auth.setCurrentUser(session?.user || null);
    callback(toCompatAuthUser(session?.user || null));
  });

  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
}

export async function signInWithPopup(
  _auth: typeof auth,
  _provider: typeof googleProvider
): Promise<void> {
  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(_auth: typeof auth): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  auth.setCurrentUser(null);
}

export async function signInAnonymously(_auth: typeof auth): Promise<{ user: CompatAuthUser }> {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  const user = toCompatAuthUser(data.user);
  if (!user) throw new Error('Supabase anonymous sign-in returned no user.');
  auth.setCurrentUser(data.user);
  return { user };
}
