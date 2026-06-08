import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './dbTypes';

export type SupabaseServerClient = SupabaseClient<Database>;

export interface SupabaseClientState {
  configured: boolean;
  client: SupabaseServerClient | null;
}

let cachedClient: SupabaseServerClient | null | undefined;

export function getSupabaseConfigState(): SupabaseClientState {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { configured: false, client: null };
  }

  if (cachedClient === undefined) {
    cachedClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return { configured: true, client: cachedClient };
}

export function getSupabaseServerClient(): SupabaseServerClient | null {
  return getSupabaseConfigState().client;
}
