import { createClient } from '@supabase/supabase-js';

export async function createSupabaseClient(url, anonKey) {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}
