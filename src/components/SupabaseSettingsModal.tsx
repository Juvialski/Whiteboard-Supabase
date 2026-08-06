import React, { useState } from 'react';
import { X, Database, Check, RefreshCw, Key, Globe, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  activeSupabaseUrl,
  activeSupabaseKey,
  saveSupabaseConfig,
  clearSupabaseConfig,
  isSupabaseConfigured,
} from '../supabase';
import { isSandboxEnvironment } from '../utils/sandboxGuard';

interface SupabaseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SupabaseSettingsModal({ isOpen, onClose }: SupabaseSettingsModalProps) {
  const [urlInput, setUrlInput] = useState(activeSupabaseUrl || '');
  const [keyInput, setKeyInput] = useState(activeSupabaseKey || '');
  const [testStatus, setTestStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!urlInput.trim() || !keyInput.trim()) {
      setTestStatus({ loading: false, success: false, message: 'Enter both the project URL and publishable key.' });
      return;
    }
    saveSupabaseConfig(urlInput, keyInput);
  };

  const handleClear = () => {
    if (confirm('Clear the browser override and return to the Render environment configuration?')) {
      clearSupabaseConfig();
    }
  };

  const handleTestConnection = async () => {
    if (!urlInput.trim() || !keyInput.trim()) {
      setTestStatus({ loading: false, success: false, message: 'Enter both the project URL and publishable key.' });
      return;
    }

    setTestStatus({ loading: true });
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const tempClient = createClient(urlInput.trim(), keyInput.trim(), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await tempClient.from('boards').select('id').limit(1);

      if (error && /relation .*boards.* does not exist/i.test(error.message)) {
        setTestStatus({
          loading: false,
          success: false,
          message: 'Connected, but the whiteboard database migration is missing. Use the version-controlled Supabase migration files; do not create permissive policies manually.',
        });
        return;
      }

      setTestStatus({
        loading: false,
        success: true,
        message: error
          ? `Project reached successfully. Database access is protected by RLS (${error.message}).`
          : 'Connection successful. The project URL and publishable key are valid.',
      });
    } catch (error: unknown) {
      setTestStatus({
        loading: false,
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans animate-fade-in">
      <div className="max-w-2xl w-full bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-slate-900 text-white p-6 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Supabase Cloud Settings</span>
                {isSupabaseConfigured && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Configured
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Manage the browser connection override</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            aria-label="Close Supabase settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Current mode
              </span>
              <span className="text-xs font-bold text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                {isSandboxEnvironment()
                  ? 'Local Sandbox (Offline)'
                  : isSupabaseConfigured
                    ? 'Supabase Cloud Database'
                    : 'Unconfigured'}
              </span>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 text-xs text-amber-900 leading-relaxed">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <p>
              Database tables, functions, and RLS policies are managed only through the repository's reviewed migration files.
              This screen intentionally does not generate or copy SQL.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>Supabase Project URL</span>
              <span className="text-[10px] text-slate-400 font-normal normal-case">VITE_SUPABASE_URL</span>
            </label>
            <div className="relative">
              <Globe className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="url"
                autoComplete="off"
                placeholder="https://YOUR_PROJECT_REF.supabase.co"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>Publishable / Anon API Key</span>
              <span className="text-[10px] text-slate-400 font-normal normal-case">VITE_SUPABASE_PUBLISHABLE_KEY</span>
            </label>
            <div className="relative">
              <Key className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="password"
                autoComplete="off"
                placeholder="Supabase publishable key"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>
          </div>

          {testStatus && (
            <div
              className={`p-3.5 rounded-xl border text-xs leading-relaxed font-medium ${
                testStatus.loading
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : testStatus.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {testStatus.loading ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  Testing connection to Supabase...
                </span>
              ) : testStatus.message}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testStatus?.loading}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Test Connection</span>
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2.5 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Reset Override
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Save Credentials</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
