-- 1) 숨김은 상영 포함도 해제한다. 요약을 고친 뒤 다시 공개해도
--    담당자가 상영 포함을 다시 확인하기 전에는 플레이어에 나오지 않는다.
-- 2) 만료된 빈도 제한 버킷(48시간 경과)을 지우는 운영용 함수. 스케줄 등록은 운영 단계에서 한다.
begin;

create or replace function public.admin_opinion_action(p_id uuid,p_expected_version integer,p_action text,p_summary text default null,p_include_in_player boolean default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.opinions%rowtype;
begin
  if not exists(select 1 from public.operator_memberships where user_id=(select auth.uid()) and active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into o from public.opinions where id=p_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_expected_version is null or p_expected_version<>o.version then raise exception 'VERSION_CONFLICT'; end if;
  case p_action
   when 'save_summary' then
    if o.status='published' then raise exception 'HIDE_BEFORE_EDIT'; end if;
    if p_summary is null or char_length(normalize(p_summary,NFC))>250 or private.nonspace_count(p_summary)=0 then raise exception 'INVALID_SUMMARY'; end if;
    update public.opinions set summary=normalize(p_summary,NFC) where id=p_id returning * into o;
   when 'publish' then
    if not o.allow_map or o.summary is null then raise exception 'PUBLICATION_NOT_ALLOWED'; end if;
    update public.opinions set status='published' where id=p_id returning * into o;
   when 'hide' then
    update public.opinions set status='hidden',include_in_player=false where id=p_id returning * into o;
   when 'set_player' then
    if p_include_in_player is null or (p_include_in_player and not(o.allow_map and o.allow_player)) then raise exception 'PLAYER_NOT_ALLOWED'; end if;
    update public.opinions set include_in_player=p_include_in_player where id=p_id returning * into o;
   when 'delete' then update public.opinions set deleted_at=now() where id=p_id returning * into o;
   else raise exception 'INVALID_ACTION';
  end case;
  return jsonb_build_object('id',o.id,'status',o.status,'version',o.version,'deleted',o.deleted_at is not null);
end;
$$;
revoke all on function public.admin_opinion_action(uuid,integer,text,text,boolean) from public,anon,service_role;
grant execute on function public.admin_opinion_action(uuid,integer,text,text,boolean) to authenticated;

create function public.cleanup_expired_rate_buckets() returns integer
language sql security invoker set search_path='' as $$
  with d as (delete from public.rate_buckets where window_start < now() - interval '48 hours' returning 1)
  select count(*)::integer from d
$$;
revoke all on function public.cleanup_expired_rate_buckets() from public,anon,authenticated;
grant execute on function public.cleanup_expired_rate_buckets() to service_role;
commit;
