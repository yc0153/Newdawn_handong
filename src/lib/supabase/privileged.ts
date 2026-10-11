import 'server-only';
import { createClient } from '@supabase/supabase-js';
export function createPublicRpcClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key) throw new Error('Server Supabase environment is not configured.');
  // This client bypasses RLS. Only call read_public_opinions/submit_opinion/config.
  // Admin mutations must use the verified operator JWT client.
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
