import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabasePublicEnv } from './env';
export async function createClient() {
  const store=await cookies();const {url,key}=supabasePublicEnv();
  return createServerClient(url,key,{cookies:{
    getAll:()=>store.getAll(),
    setAll(values) {
      try {values.forEach(({name,value,options})=>store.set(name,value,options));}
      catch { /* Server Components cannot write cookies; proxy refreshes sessions. */ }
    },
  }});
}
