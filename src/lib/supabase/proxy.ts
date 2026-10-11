import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabasePublicEnv } from './env';
export async function updateSession(request:NextRequest) {
  let response=NextResponse.next({request});const {url,key}=supabasePublicEnv();
  const supabase=createServerClient(url,key,{cookies:{
    getAll:()=>request.cookies.getAll(),
    setAll(values,headers) {
      values.forEach(({name,value})=>request.cookies.set(name,value));
      response=NextResponse.next({request});
      values.forEach(({name,value,options})=>response.cookies.set(name,value,options));
      Object.entries(headers).forEach(([key,value])=>response.headers.set(key,value));
    },
  }});
  await supabase.auth.getClaims();
  return response;
}
