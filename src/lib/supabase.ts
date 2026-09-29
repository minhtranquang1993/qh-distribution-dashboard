import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Lazy client: build không require env nên bản offline vẫn chạy CSV fallback. */
export function supabaseClient(): SupabaseClient | null {
  const url = envOf('VITE_SUPABASE_URL', 'SUPABASE_URL');
  const key = envOf('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  if (!client) client = createClient(url, key);
  return client;
}

function envOf(viteKey: string, nodeKey: string): string | undefined {
  try {
    // Vite browser build
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[viteKey];
    if (v) return v;
  } catch {
    /* import.meta không tồn tại trong tsx script — dùng process.env */
  }
  if (typeof process !== 'undefined') return process.env[nodeKey] ?? process.env[viteKey];
  return undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(envOf('VITE_SUPABASE_URL', 'SUPABASE_URL') && envOf('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'));
}
