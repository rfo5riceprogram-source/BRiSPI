import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use Supabase.');
    }

    client ??= createClient(url, anonKey);
    return client;
}