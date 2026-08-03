import React, { useState } from 'react';
import { X, Database, Check, Copy, RefreshCw, Key, Globe, ShieldCheck, Sparkles } from 'lucide-react';
import { activeSupabaseUrl, activeSupabaseKey, saveSupabaseConfig, clearSupabaseConfig, isSupabaseConfigured, supabase } from '../supabase';
import { isSandboxEnvironment } from '../utils/sandboxGuard';

interface SupabaseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SupabaseSettingsModal({ isOpen, onClose }: SupabaseSettingsModalProps) {
  const [urlInput, setUrlInput] = useState(activeSupabaseUrl || '');
  const [keyInput, setKeyInput] = useState(activeSupabaseKey || '');
  const [testStatus, setTestStatus] = useState<{ loading: boolean; success?: boolean; message?: string } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'schema'>('config');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveSupabaseConfig(urlInput, keyInput);
  };

  const handleClear = () => {
    if (confirm('Clear saved Supabase configuration from local browser storage?')) {
      clearSupabaseConfig();
    }
  };

  const handleTestConnection = async () => {
    if (!urlInput.trim() || !keyInput.trim()) {
      setTestStatus({ loading: false, success: false, message: 'Please enter both URL and Publishable Key.' });
      return;
    }

    setTestStatus({ loading: true });
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const tempClient = createClient(urlInput.trim(), keyInput.trim());
      const { error } = await tempClient.from('boards').select('id').limit(1);

      if (error && error.code !== 'PGRST116') {
        // RLS error or table missing error is informative
        if (error.message.includes('relation "public.boards" does not exist') || error.message.includes('relation "boards" does not exist')) {
          setTestStatus({
            loading: false,
            success: false,
            message: 'Connected to Supabase project, but the "boards" table was not found. Please run supabase-schema.sql in SQL Editor.'
          });
        } else {
          setTestStatus({
            loading: false,
            success: true,
            message: `Connected successfully! (${error.message || 'RLS enforced'})`
          });
        }
      } else {
        setTestStatus({
          loading: false,
          success: true,
          message: 'Connection successful! Project URL and API Key are valid.'
        });
      }
    } catch (err: any) {
      setTestStatus({
        loading: false,
        success: false,
        message: 'Connection failed: ' + (err.message || String(err))
      });
    }
  };

  const handleCopySql = () => {
    const sqlSchema = `-- Supabase Schema for Collaborative Whiteboard
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.boards (
  id text primary key,
  name text not null,
  description text default '',
  created_at bigint default extract(epoch from now()) * 1000,
  updated_at bigint default extract(epoch from now()) * 1000,
  created_by text default 'Unknown',
  owner_uid text,
  access_mode text default 'private',
  editor_uids text[] default '{}',
  viewer_uids text[] default '{}',
  status text default 'ready',
  student_id text default '',
  student_name text default '',
  students_can_write boolean default true,
  schema_version integer default 4,
  shard_layout_version integer default 3,
  shard_count integer default 16,
  current_revision integer default 0,
  changed_shard_ids text[] default '{}',
  deleted_shard_ids text[] default '{}',
  total_elements integer default 0,
  data jsonb default '{}'::jsonb
);

create table if not exists public.board_shards (
  board_id text references public.boards(id) on delete cascade,
  shard_id text not null,
  revision integer default 0,
  elements jsonb default '{}'::jsonb,
  tombstones jsonb default '{}'::jsonb,
  updated_at bigint default extract(epoch from now()) * 1000,
  primary key (board_id, shard_id)
);

create table if not exists public.board_assets (
  board_id text references public.boards(id) on delete cascade,
  asset_id text not null,
  mime_type text not null,
  object_path text not null,
  encoded_byte_size bigint default 0,
  original_byte_size bigint,
  width integer,
  height integer,
  content_hash text,
  created_at bigint default extract(epoch from now()) * 1000,
  created_by text,
  primary key (board_id, asset_id)
);

create table if not exists public.presence (
  id text primary key,
  profile_id text,
  name text,
  email text,
  last_active bigint default extract(epoch from now()) * 1000,
  is_online boolean default true,
  role text default 'student',
  current_board_id text,
  current_board_name text,
  data jsonb default '{}'::jsonb
);

create table if not exists public.admin_settings (
  id text primary key,
  app_enabled boolean default true,
  updated_at bigint default extract(epoch from now()) * 1000,
  updated_by text,
  data jsonb default '{}'::jsonb
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_shards enable row level security;
alter table public.board_assets enable row level security;
alter table public.presence enable row level security;
alter table public.admin_settings enable row level security;

-- Permissive RLS for authenticated and anon users
create policy "Allow all operations for public.profiles" on public.profiles for all using (true) with check (true);
create policy "Allow all operations for public.boards" on public.boards for all using (true) with check (true);
create policy "Allow all operations for public.board_shards" on public.board_shards for all using (true) with check (true);
create policy "Allow all operations for public.board_assets" on public.board_assets for all using (true) with check (true);
create policy "Allow all operations for public.presence" on public.presence for all using (true) with check (true);
create policy "Allow all operations for public.admin_settings" on public.admin_settings for all using (true) with check (true);
`;
    navigator.clipboard.writeText(sqlSchema);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans animate-fade-in">
      <div className="max-w-2xl w-full bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
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
              <p className="text-xs text-slate-400 mt-0.5">
                Manage your database URL, API keys, and SQL schema
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 shrink-0">
          <button
            onClick={() => setActiveTab('config')}
            className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center space-x-2 ${
              activeTab === 'config'
                ? 'border-emerald-600 text-emerald-700 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>API Credentials</span>
          </button>
          <button
            onClick={() => setActiveTab('schema')}
            className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center space-x-2 ${
              activeTab === 'schema'
                ? 'border-emerald-600 text-emerald-700 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>SQL Schema Script</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'config' ? (
            <form onSubmit={handleSave} className="space-y-5">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Current Mode:
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider flex items-center justify-between">
                  <span>Supabase Project URL</span>
                  <span className="text-[10px] text-slate-400 font-normal normal-case">VITE_SUPABASE_URL</span>
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="url"
                    placeholder="https://YOUR_PROJECT_REF.supabase.co"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
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
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
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
                  ) : (
                    testStatus.message
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testStatus?.loading}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 transition-colors flex items-center space-x-1.5 cursor-pointer"
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
                    Reset
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
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-600">
                  Run this SQL in your <strong>Supabase SQL Editor</strong> to create tables, indexes, and security policies:
                </p>
                <button
                  onClick={handleCopySql}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-2xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Full SQL Schema</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="bg-slate-950 text-slate-100 text-[11px] font-mono rounded-2xl p-4 overflow-x-auto max-h-80 border border-slate-800 leading-relaxed select-all">
                {`create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.boards (
  id text primary key,
  name text not null,
  description text default '',
  created_at bigint,
  updated_at bigint,
  created_by text,
  owner_uid text,
  access_mode text default 'private',
  status text default 'ready',
  student_id text default '',
  student_name text default '',
  students_can_write boolean default true,
  data jsonb default '{}'::jsonb
);`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
