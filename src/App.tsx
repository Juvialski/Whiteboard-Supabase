import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc, onSnapshot } from './lib/supabaseDb';
import { db, auth, googleProvider, isSupabaseConfigured, supabase } from './supabase';
import { onAuthStateChanged, signInWithPopup, signOut } from './lib/supabaseAuth';
import { UserProfile } from './types';
import Dashboard from './components/Dashboard';
import WhiteboardCanvas from './components/WhiteboardCanvas';
import { Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';
import TurnstileWidget from './components/TurnstileWidget';
import { isSandboxEnvironment, getSandboxLocalBoards } from './utils/sandboxGuard';
import { trackOperation } from './utils/databaseInstrumentation';

const COLLABORATOR_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', 
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', 
  '#ec4899', '#f43f5e'
];

const PENDING_SHARE_TOKEN_KEY = 'lucid_spark_pending_share_token';

export default function App() {
  const [boardId, setBoardId] = useState<string | null>(null);
  const [boardName, setBoardName] = useState<string>('Whiteboard Canvas');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [appEnabled, setAppEnabled] = useState<boolean>(true);
  const [adminClaim, setAdminClaim] = useState(false);

  // Quick link join variables
  const [linkBoardId, setLinkBoardId] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const shareRedemptionPromiseRef = useRef<{ token: string; promise: Promise<{ boardId: string; name: string }> } | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');
  const [colorInput, setColorInput] = useState(COLLABORATOR_COLORS[Math.floor(Math.random() * COLLABORATOR_COLORS.length)]);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [isJoiningGuest, setIsJoiningGuest] = useState(false);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();


  const redeemShareAndJoin = async (
    token: string,
    activeProfile: UserProfile
  ): Promise<{ boardId: string; name: string }> => {
    const normalizedToken = token.trim();
    if (normalizedToken.length < 32 || normalizedToken.length > 256) {
      throw new Error('This sharing link is invalid or incomplete.');
    }

    if (!shareRedemptionPromiseRef.current || shareRedemptionPromiseRef.current.token !== normalizedToken) {
      const promise = (async () => {
        const { data, error } = await supabase.rpc('redeem_board_share_link', {
          p_raw_token: normalizedToken,
        });
        if (error) throw new Error(error.message);

        const payload = data as any;
        const redeemedBoardId = String(payload?.boardId || payload?.board_id || '');
        const redeemedBoardName = String(payload?.name || 'Collaborative Whiteboard');
        if (!redeemedBoardId) throw new Error('The sharing link did not return a board.');

        return { boardId: redeemedBoardId, name: redeemedBoardName };
      })();
      shareRedemptionPromiseRef.current = { token: normalizedToken, promise };
    }

    const activeRedemption = shareRedemptionPromiseRef.current;
    try {
      const result = await activeRedemption.promise;
      setProfile(activeProfile);
      setBoardId(result.boardId);
      setBoardName(result.name);
      setShareToken(null);
      setLinkBoardId(null);
      sessionStorage.removeItem(PENDING_SHARE_TOKEN_KEY);

      // The secret is needed only once. The persisted Supabase session and
      // board_members row are enough for later reloads in the same browser.
      const cleanUrl = `${window.location.origin}/?board=${encodeURIComponent(result.boardId)}`;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
      return result;
    } finally {
      if (shareRedemptionPromiseRef.current === activeRedemption) {
        shareRedemptionPromiseRef.current = null;
      }
    }
  };

  useEffect(() => {
    // Check if joining via shareable link parameter
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const urlBoardId = params.get('board');
    // Prefer a URL fragment so the one-time share secret is not sent in HTTP
    // requests or access logs. Query-string links remain supported for older links.
    const urlShareToken = hashParams.get('share') || params.get('share');
    const storedShareToken = sessionStorage.getItem(PENDING_SHARE_TOKEN_KEY);
    const rawShareToken = urlShareToken || storedShareToken;
    if (urlShareToken) sessionStorage.setItem(PENDING_SHARE_TOKEN_KEY, urlShareToken);

    // Subscribe to Supabase authentication changes
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      let activeProfile: UserProfile | null = null;

      setAuthUserId(user?.uid || null);

      if (user) {
        // Preserve a chosen guest nickname across reloads, but never treat an
        // anonymous Supabase session as a teacher or permanent Google account.
        const savedName = localStorage.getItem('lucid_spark_user_name');
        const resolvedName = user.isAnonymous
          ? (savedName || 'Guest User')
          : (user.displayName || user.email?.split('@')[0] || savedName || 'Google User');
        const savedColor = localStorage.getItem('lucid_spark_user_color') || colorInput;
        const savedRole = user.isAnonymous
          ? 'student'
          : (localStorage.getItem('lucid_spark_user_role') || 'student') as 'student' | 'teacher';

        localStorage.setItem('lucid_spark_user_id', user.uid);
        if (!savedName || !user.isAnonymous) {
          localStorage.setItem('lucid_spark_user_name', resolvedName);
        }

        activeProfile = {
          id: user.uid,
          name: resolvedName,
          color: savedColor,
          role: savedRole,
          photoURL: user.photoURL || undefined,
          email: user.email || undefined
        };
        setProfile(activeProfile);

        // Run the administrator lookup outside Supabase's auth callback lock.
        void user.getIdTokenResult()
          .then((idTokenResult) => {
            setAdminClaim(Boolean(idTokenResult.claims.admin));
          })
          .catch((err) => {
            console.error('Error fetching admin claim:', err);
            setAdminClaim(false);
          });

        if (rawShareToken) {
          if (user.isAnonymous && !savedName) {
            setShareToken(rawShareToken);
          } else {
            void redeemShareAndJoin(rawShareToken, activeProfile).catch((error) => {
              console.error('Unable to redeem shared board link:', error);
              alert(`Unable to open this sharing link: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
        } else if (urlBoardId) {
          joinBoardDirectly(urlBoardId, activeProfile);
        }
      } else {
        setAdminClaim(false);
        // Not logged in (guest / anonymous mode)
        const savedName = localStorage.getItem('lucid_spark_user_name');
        
        if (rawShareToken) {
          // A secure share token is redeemed only after an authenticated Google
          // or anonymous Supabase session exists. Ask for the guest nickname first.
          setShareToken(rawShareToken);
          if (savedName) setNicknameInput(savedName);
        } else if (urlBoardId) {
          // A plain board ID is not an invitation. Without an existing Supabase
          // session, require Google sign-in instead of creating a new anonymous
          // account that cannot possibly have membership for this board.
          setLinkBoardId(urlBoardId);
          if (savedName) setNicknameInput(savedName);
        } else if (savedName) {
          const savedId = localStorage.getItem('lucid_spark_user_id') || 'u-' + Math.floor(Math.random() * 1000000);
          const savedColor = localStorage.getItem('lucid_spark_user_color') || colorInput;
          const savedRole = (localStorage.getItem('lucid_spark_user_role') || 'student') as 'student' | 'teacher';

          if (!localStorage.getItem('lucid_spark_user_id')) {
            localStorage.setItem('lucid_spark_user_id', savedId);
          }

          activeProfile = {
            id: savedId,
            name: savedName,
            color: savedColor,
            role: savedRole
          };
          setProfile(activeProfile);
        }
      }

      setIsLoading(false);
      setAuthInitialized(true);
    });

    return () => unsubscribe();
  }, []);

  // Read the global app status only when a real Supabase session exists.
  // Postgres Changes provides immediate updates when Realtime is enabled for
  // the table; a low-frequency poll is retained as a reliable free-tier fallback.
  useEffect(() => {
    if (isSandboxEnvironment() || !authInitialized || !authUserId) {
      setAppEnabled(true);
      return;
    }

    let active = true;
    const loadSetting = async () => {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('app_enabled,data')
        .eq('id', 'global')
        .maybeSingle();
      if (!active) return;
      if (error) {
        console.error('Error loading global Supabase settings:', error);
        return;
      }
      const nested = data?.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : {};
      setAppEnabled(data?.app_enabled !== false && nested.appEnabled !== false);
    };

    void loadSetting();
    const channel = supabase
      .channel(`app-settings-${authUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'admin_settings', filter: 'id=eq.global' },
        () => void loadSetting()
      )
      .subscribe();
    const poll = window.setInterval(() => void loadSetting(), 60_000);
    const handleFocus = () => void loadSetting();
    window.addEventListener('focus', handleFocus);

    return () => {
      active = false;
      window.clearInterval(poll);
      window.removeEventListener('focus', handleFocus);
      void supabase.removeChannel(channel);
    };
  }, [authInitialized, authUserId]);

  // Track presence with low-frequency heartbeats only while the page is visible
  const lastPresenceUpdateRef = React.useRef<number>(0);
  const lastPresenceStateRef = React.useRef<{ isOnline: boolean; boardId: string | null } | null>(null);
  const boardIdRef = React.useRef<string | null>(boardId);
  const boardNameRef = React.useRef<string>(boardName);

  useEffect(() => {
    boardIdRef.current = boardId;
    boardNameRef.current = boardName;
  }, [boardId, boardName]);

  useEffect(() => {
    if (!authInitialized || !profile) return;

    const updatePresence = async (isOnline: boolean, forceWrite: boolean = false) => {
      if (isSandboxEnvironment()) return;

      const now = Date.now();
      const prevState = lastPresenceStateRef.current;
      const currentBoardId = boardIdRef.current;
      const currentBoardName = boardNameRef.current;

      if (
        !forceWrite &&
        prevState &&
        prevState.isOnline === isOnline &&
        prevState.boardId === (currentBoardId || null)
      ) {
        return;
      }

      lastPresenceUpdateRef.current = now;
      lastPresenceStateRef.current = { isOnline, boardId: currentBoardId || null };

      try {
        const presenceUid = auth.currentUser?.uid;
        if (!presenceUid) return;
        const presenceRef = doc(db, 'presence', presenceUid);
        await setDoc(presenceRef, {
          id: presenceUid,
          profileId: profile.id,
          name: profile.name,
          email: profile.email || 'Guest User',
          lastActive: now,
          isOnline: isOnline,
          role: profile.role || 'student',
          currentBoardId: currentBoardId || null,
          currentBoardName: currentBoardId ? currentBoardName : null
        }, { merge: true });
        trackOperation('write', 'presence-write', 1);
      } catch (err) {
        console.error('Error updating user presence:', err);
      }
    };

    // Initial check-in plus a low-frequency heartbeat while the page is visible.
    // This keeps the admin panel accurate without writing on cursor movement or
    // every interaction. Stale rows are still treated as offline client-side.
    void updatePresence(true, true);
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void updatePresence(true, true);
      }
    }, 90_000);
    const handleVisibility = () => {
      void updatePresence(document.visibilityState === 'visible', true);
    };
    const handleOnline = () => void updatePresence(true, true);
    const handleOffline = () => void updatePresence(false, true);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      void updatePresence(false, true);
    };
  }, [profile, authInitialized]);

  // Update presence when user switches board
  useEffect(() => {
    if (!authInitialized || !profile || isSandboxEnvironment()) return;
    const now = Date.now();
    if (now - lastPresenceUpdateRef.current < 5000) return;
    
    const presenceUid = auth.currentUser?.uid;
    if (!presenceUid) return;
    const presenceRef = doc(db, 'presence', presenceUid);
    setDoc(presenceRef, {
      currentBoardId: boardId || null,
      currentBoardName: boardId ? boardName : null,
      lastActive: now,
      isOnline: true
    }, { merge: true })
      .then(() => {
        trackOperation('write', 'presence-write', 1);
      })
      .catch(err => console.error('Error updating board presence:', err));
    
    lastPresenceUpdateRef.current = now;
    lastPresenceStateRef.current = { isOnline: true, boardId: boardId || null };
  }, [profile, boardId, authInitialized]);

  const handleSignInGoogle = async () => {
    try {
      if (shareToken) sessionStorage.setItem(PENDING_SHARE_TOKEN_KEY, shareToken);
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Google Sign-In Error:', err);
      alert('Failed to sign in with Google: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('lucid_spark_user_name');
      localStorage.removeItem('lucid_spark_user_id');
      setProfile(null);
    } catch (err) {
      console.error('Sign-Out Error:', err);
      alert('Could not sign out: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const joinBoardDirectly = async (targetId: string, _userProfile: UserProfile) => {
    setBoardId(targetId);
    if (isSandboxEnvironment()) {
      const localBoards = getSandboxLocalBoards();
      const found = localBoards.find((board: any) => board.id === targetId);
      setBoardName(found?.name || 'Collaborative Whiteboard');
      return;
    }
    // The board persistence subscription loads the manifest and shards together.
    setBoardName('Collaborative Whiteboard');
  };

  const handleSelectBoard = async (
    targetId: string,
    selectedProfile: UserProfile,
    selectedBoardName?: string
  ) => {
    setProfile(selectedProfile);
    setBoardId(targetId);
    setBoardName(selectedBoardName || 'Collaborative Whiteboard');

    const newUrl = `${window.location.origin}/?board=${targetId}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  };

  const handleBackToDashboard = () => {
    setBoardId(null);
    // Clear URL parameters
    const cleanUrl = window.location.origin;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
  };

  const handleLinkJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareToken) {
      alert('This board-ID link is not an invitation. Sign in with a Google account that already has access, or ask the owner for a new secure link.');
      return;
    }
    if (!nicknameInput.trim()) return;

    const savedId = localStorage.getItem('lucid_spark_user_id') || 'u-' + Math.floor(Math.random() * 1000000);
    const savedRole: 'student' = 'student';
    localStorage.setItem('lucid_spark_user_name', nicknameInput.trim());
    localStorage.setItem('lucid_spark_user_color', colorInput);
    localStorage.setItem('lucid_spark_user_role', savedRole); // preserve role or default to student

    const userProfile: UserProfile = {
      id: savedId,
      name: nicknameInput.trim(),
      color: colorInput,
      role: savedRole
    };

    if (turnstileSiteKey && !authUserId && !captchaToken) {
      alert('Complete the anti-bot verification before joining as a guest.');
      return;
    }

    setIsJoiningGuest(true);
    try {
      if (!isSandboxEnvironment()) {
        const { ensureAuthUser } = await import('./services/boardPersistence');
        const authenticated = await ensureAuthUser(captchaToken || undefined);
        if (!authenticated) {
          alert('Authentication is still being prepared. Finish Google sign-in or try guest access again.');
          return;
        }
        userProfile.id = authenticated.uid;
        localStorage.setItem('lucid_spark_user_id', authenticated.uid);
      }
      setProfile(userProfile);
      await redeemShareAndJoin(shareToken, userProfile);
    } catch (error) {
      console.error('Unable to join shared board:', error);
      if (turnstileSiteKey) {
        setCaptchaToken(null);
        setCaptchaResetKey((value) => value + 1);
      }
      alert(`Unable to join this board: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsJoiningGuest(false);
    }
  };

  if (!isSupabaseConfigured && !isSandboxEnvironment()) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
        <div className="max-w-xl w-full bg-white border border-slate-200 rounded-3xl shadow-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <span className="text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1 rounded-full">
              Supabase Configuration Required
            </span>
          </div>

          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Configure Supabase Database</h1>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              To connect your real cloud database, enter your Supabase credentials below or click <strong>Continue in Sandbox Mode</strong> to test locally.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const url = (form.elements.namedItem('url') as HTMLInputElement)?.value;
              const key = (form.elements.namedItem('key') as HTMLInputElement)?.value;
              if (url && key) {
                localStorage.setItem('VITE_SUPABASE_URL', url.trim());
                localStorage.setItem('VITE_SUPABASE_PUBLISHABLE_KEY', key.trim());
                window.location.reload();
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Supabase Project URL
              </label>
              <input
                name="url"
                type="url"
                required
                placeholder="https://YOUR_PROJECT.supabase.co"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Publishable / Anon API Key
              </label>
              <input
                name="key"
                type="password"
                required
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('WHITEBOARD_LOCAL_SANDBOX', 'true');
                  window.location.reload();
                }}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-colors cursor-pointer"
              >
                Continue in Local Sandbox Mode
              </button>

              <button
                type="submit"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
              >
                Save & Connect Cloud DB
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans">
        <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center animate-bounce shadow-lg shadow-blue-600/20">
          <div className="w-6 h-6 bg-white rotate-45"></div>
        </div>
        <p className="mt-4 text-sm text-slate-600 font-semibold font-mono animate-pulse">
          Loading Whiteboard Canvas...
        </p>
      </div>
    );
  }

  // If joining via link directly but needs to set their profile details
  if (linkBoardId || shareToken) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-8 space-y-6 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-600" />
          
          <div className="mx-auto w-12 h-12 bg-blue-600 rounded flex items-center justify-center shadow-lg shadow-blue-600/10">
            <div className="w-6 h-6 bg-white rotate-45"></div>
          </div>

          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {shareToken ? "You're Invited to Collaborate!" : 'Sign In Required'}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {shareToken
                ? 'Set your nickname and color to redeem this secure whiteboard invitation.'
                : 'This board-ID link works only for an account that already has permission.'}
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col items-center justify-center space-y-3">
            <p className="text-[11px] text-slate-500 text-center">
              {shareToken
                ? 'Use your Google profile instead of creating a temporary guest session.'
                : 'Sign in with the Google account that was explicitly granted access.'}
            </p>
            <button
              onClick={handleSignInGoogle}
              className="flex items-center space-x-2 bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200 shadow-sm text-slate-700 hover:text-slate-900 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12 5.04c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.6 15 0 12 0 7.3 0 3.3 2.7 1.4 6.6l3.9 3C6.2 6.8 8.9 5.04 12 5.04z"/>
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
                <path fill="#FBBC05" d="M5.3 14.4c-.2-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.4 5.4l3.9-3z"/>
                <path fill="#34A853" d="M12 24c3.2 0 6-1 8-2.9l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-1.8-6.7-4.6l-3.9 3C3.3 21.3 7.3 24 12 24z"/>
              </svg>
              <span>Sign in with Google</span>
            </button>
          </div>

          {shareToken ? (
            <>
              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-100"></div>
                <span className="mx-4 flex-shrink text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  or join as guest
                </span>
                <div className="flex-grow border-t border-slate-100"></div>
              </div>

              <form onSubmit={handleLinkJoinSubmit} className="space-y-5 text-left">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Your Guest Nickname
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Clara Oswald"
                    value={nicknameInput}
                    onChange={(e) => setNicknameInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Select Your Cursor Color
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2.5">
                    {COLLABORATOR_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColorInput(c)}
                        className={`flex h-8 w-8 transform cursor-pointer items-center justify-center rounded-full border transition-all hover:scale-110 ${
                          colorInput === c
                            ? 'scale-105 border-white ring-2 ring-blue-600'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      >
                        {colorInput === c && (
                          <div className="h-1.5 w-1.5 rounded-full bg-white shadow-xs" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {turnstileSiteKey && !authUserId && (
                  <TurnstileWidget
                    siteKey={turnstileSiteKey}
                    onToken={setCaptchaToken}
                    resetKey={captchaResetKey}
                  />
                )}

                <button
                  type="submit"
                  disabled={isJoiningGuest || Boolean(turnstileSiteKey && !authUserId && !captchaToken)}
                  className="flex w-full cursor-pointer items-center justify-center space-x-2 rounded-xl bg-blue-600 py-3.5 text-xs font-bold text-white shadow-md shadow-blue-600/10 transition-all hover:bg-blue-700 hover:shadow-lg active:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <span>{isJoiningGuest ? 'Joining securely…' : 'Join Whiteboard Workspace'}</span>
                  {!isJoiningGuest && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>
            </>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
              <p className="text-xs font-semibold text-amber-900">No invitation token is present.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                Ask the board owner to create a new secure Share link. Do not use an old URL that contains only <code>?board=</code> in a new browser.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isAdminUser = adminClaim;

  if (!appEnabled && !isAdminUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-sans text-center">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-8 space-y-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500" />
          
          <div className="mx-auto w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center shadow-sm">
            <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0-6v2m0-5a7 7 0 110 14 7 7 0 010-14z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">Workspace Suspended</h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              The administrator has temporarily disabled access to this whiteboard application for maintenance or review.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col items-center justify-center space-y-2 text-xs text-slate-600">
            <p className="font-semibold">Need Access?</p>
            <p className="text-slate-500 text-center">Please contact the system administrator if you believe this is an error.</p>
          </div>

          {/* Let the admin sign in from this screen in case they are logged out or logged in with a guest profile */}
          <div className="pt-2 border-t border-slate-100">
            {!profile?.email ? (
              <button
                onClick={handleSignInGoogle}
                className="mx-auto flex items-center space-x-2 bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200 shadow-sm text-slate-700 hover:text-slate-900 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 5.04c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.6 15 0 12 0 7.3 0 3.3 2.7 1.4 6.6l3.9 3C6.2 6.8 8.9 5.04 12 5.04z"/>
                  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
                  <path fill="#FBBC05" d="M5.3 14.4c-.2-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.4 5.4l3.9-3z"/>
                  <path fill="#34A853" d="M12 24c3.2 0 6-1 8-2.9l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-1.8-6.7-4.6l-3.9 3C3.3 21.3 7.3 24 12 24z"/>
                </svg>
                <span>Admin Log In</span>
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400">Currently logged in as: <strong className="text-slate-600">{profile.email}</strong></p>
                <button
                  onClick={handleSignOut}
                  className="text-xs text-rose-500 hover:text-rose-600 font-semibold underline cursor-pointer"
                >
                  Log Out / Switch Account
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 flex flex-col">
      {boardId && profile ? (
        <WhiteboardCanvas
          boardId={boardId}
          boardName={boardName}
          currentUser={profile}
          onBackToDashboard={handleBackToDashboard}
          adminClaim={adminClaim}
        />
      ) : (
        <Dashboard
          onSelectBoard={handleSelectBoard}
          currentUserProfile={profile}
          onSignInGoogle={handleSignInGoogle}
          onSignOut={handleSignOut}
          adminClaim={adminClaim}
        />
      )}
    </div>
  );
}

