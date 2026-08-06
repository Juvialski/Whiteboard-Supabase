import { useEffect, useRef, useState } from 'react';

interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetKey?: number;
}

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'cloudflare-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Turnstile requires a browser.'));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      window.clearInterval(probe);
      window.clearTimeout(timeout);
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
      if (error) {
        scriptPromise = null;
        reject(error);
      } else {
        resolve();
      }
    };
    const handleLoad = () => window.turnstile
      ? finish()
      : undefined;
    const handleError = () => finish(new Error('Cloudflare Turnstile could not be loaded.'));
    const probe = window.setInterval(() => {
      if (window.turnstile) finish();
    }, 50);
    const timeout = window.setTimeout(() => {
      finish(new Error('Cloudflare Turnstile did not become ready.'));
    }, 10_000);

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

export default function TurnstileWidget({ siteKey, onToken, resetKey = 0 }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    onTokenRef.current(null);

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => {
            onTokenRef.current(null);
            return true;
          },
        });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      onTokenRef.current(null);
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // The widget may already have removed itself after a navigation.
        }
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (!widgetIdRef.current || !window.turnstile) return;
    onTokenRef.current(null);
    window.turnstile.reset(widgetIdRef.current);
  }, [resetKey]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="min-h-[65px] flex justify-center" />
      {loadError && (
        <p className="text-[11px] text-rose-600 text-center" role="alert">
          {loadError} Refresh the page before joining as a guest.
        </p>
      )}
    </div>
  );
}
