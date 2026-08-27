import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** True only when both env vars are present — the app falls back to mock data otherwise. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Shared Supabase client, or `null` when the project has not been configured
 * yet. Callers must null-check (see `src/services/api.ts`).
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/** Thrown by the API layer when Supabase is unavailable so the store can fall back. */
export class SupabaseUnavailableError extends Error {
  constructor(message = 'Supabase is not configured') {
    super(message);
    this.name = 'SupabaseUnavailableError';
  }
}
