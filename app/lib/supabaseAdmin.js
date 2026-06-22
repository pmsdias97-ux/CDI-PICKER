import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY Supabase client using the service_role key. It bypasses Row Level
// Security, so it must NEVER be imported into client components — only from API
// routes. The key is read from a non-public env var.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _admin = null;

export function getSupabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin não configurado: define SUPABASE_SERVICE_ROLE_KEY (e NEXT_PUBLIC_SUPABASE_URL)."
    );
  }
  if (!_admin) {
    _admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}
