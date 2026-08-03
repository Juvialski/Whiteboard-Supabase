import { createClient, type User } from '@supabase/supabase-js';

const getStoredUrl = (): string => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('VITE_SUPABASE_URL') || '';
};

const getStoredKey = (): string => {
  if (typeof window === 'undefined') return '';
  return (
    localStorage.getItem('VITE_SUPABASE_PUBLISHABLE_KEY') ||
    localStorage.getItem('VITE_SUPABASE_ANON_KEY') ||
    ''
  );
};

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || getStoredUrl())?.trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  getStoredKey() ||
  ''
).trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const activeSupabaseUrl = supabaseUrl;
export const activeSupabaseKey = supabasePublishableKey;

export function saveSupabaseConfig(url: string, key: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('VITE_SUPABASE_URL', url.trim());
    localStorage.setItem('VITE_SUPABASE_PUBLISHABLE_KEY', key.trim());
    window.location.reload();
  }
}

export function clearSupabaseConfig(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('VITE_SUPABASE_URL');
    localStorage.removeItem('VITE_SUPABASE_PUBLISHABLE_KEY');
    localStorage.removeItem('VITE_SUPABASE_ANON_KEY');
    window.location.reload();
  }
}

const fallbackUrl = 'http://127.0.0.1:54321';
const fallbackKey = 'supabase-not-configured';

export const supabase = createClient(
  supabaseUrl || fallbackUrl,
  supabasePublishableKey || fallbackKey
);

export interface CompatAuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
  raw: User;
  getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }>;
}

export function toCompatAuthUser(user: User | null): CompatAuthUser | null {
  if (!user) return null;
  const metadata = user.user_metadata || {};
  const appMetadata = user.app_metadata || {};
  const provider = String(appMetadata.provider || '');
  const isAnonymous = Boolean((user as User & { is_anonymous?: boolean }).is_anonymous || provider === 'anonymous');
  return {
    uid: user.id,
    displayName: metadata.full_name || metadata.name || metadata.user_name || (user.email ? user.email.split('@')[0] : null),
    email: user.email || null,
    photoURL: metadata.avatar_url || metadata.picture || null,
    isAnonymous,
    raw: user,
    getIdTokenResult: async () => {
      let profileIsAdmin = false;
      try {
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();
        profileIsAdmin = Boolean((data as any)?.is_admin);
      } catch {
        // RLS or an offline connection should not block normal authentication.
      }
      return {
        claims: {
          ...appMetadata,
          admin: Boolean(appMetadata.admin || appMetadata.is_admin || profileIsAdmin),
          is_anonymous: isAnonymous,
        },
      };
    },
  };
}

class AuthCompat {
  private cachedUser: CompatAuthUser | null = null;
  get currentUser(): CompatAuthUser | null { return this.cachedUser; }
  setCurrentUser(user: User | null): void { this.cachedUser = toCompatAuthUser(user); }
  async authStateReady(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    this.cachedUser = toCompatAuthUser(data.session?.user || null);
  }
}

export const auth = new AuthCompat();
export const googleProvider = { provider: 'google' as const };
export const db = supabase;

export const authPersistenceReady = (async () => {
  if (!isSupabaseConfigured) return;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  auth.setCurrentUser(data.session?.user || null);
})();
