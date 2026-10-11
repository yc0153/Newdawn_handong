-- 담당자 변경은 admin_opinion_action RPC로만 한다.
-- 직접 UPDATE 권한을 회수해 버전 충돌 검사·숨김 시 상영 해제·조치별 이력을 우회할 수 없게 한다.
-- RPC는 SECURITY DEFINER로 실행하되, 함수 안과 트리거에서 활성 담당자 명단을 다시 검사한다.
begin;
revoke update on public.opinions from authenticated;
drop policy if exists operator_update on public.opinions;
alter function public.admin_opinion_action(uuid,integer,text,text,boolean) security definer;
revoke all on function public.admin_opinion_action(uuid,integer,text,text,boolean) from public,anon,service_role;
grant execute on function public.admin_opinion_action(uuid,integer,text,text,boolean) to authenticated;

-- 트리거에서도 한 번의 변경에 하나의 조치만 허용하고, 숨김이면 상영 포함을 해제한다.
create or replace function private.enforce_opinion_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_action text;
begin
  if not exists(select 1 from public.operator_memberships m where m.user_id=v_actor and m.active)
    then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if old.deleted_at is not null then raise exception 'OPINION_DELETED'; end if;
  if (new.id,new.public_id,new.cell_x,new.cell_y,new.category,new.language,new.original_text,
      new.allow_map,new.allow_player,new.notice_version,new.created_at)
     is distinct from
     (old.id,old.public_id,old.cell_x,old.cell_y,old.category,old.language,old.original_text,
      old.allow_map,old.allow_player,old.notice_version,old.created_at)
    then raise exception 'IMMUTABLE_SUBMISSION'; end if;
  if new.deleted_at is not null then
    v_action:='delete'; new.deleted_at:=now();new.original_text:=null;new.summary:=null;
    new.status:='hidden';new.include_in_player:=false;
  else
    if (new.summary is distinct from old.summary)::int + (new.status is distinct from old.status)::int
       + (new.include_in_player is distinct from old.include_in_player and new.status is not distinct from old.status)::int > 1
      then raise exception 'ONE_ACTION_PER_CHANGE'; end if;
    if old.status='published' and new.summary is distinct from old.summary then
      raise exception 'HIDE_BEFORE_EDIT';
    elsif new.status is distinct from old.status then
      v_action:=case new.status when 'published' then 'publish' when 'hidden' then 'hide' else null end;
      if v_action is null then raise exception 'INVALID_TRANSITION'; end if;
      if new.status='hidden' then new.include_in_player:=false; end if;
    elsif new.summary is distinct from old.summary then v_action:='save_summary';
    elsif new.include_in_player is distinct from old.include_in_player then v_action:='set_player';
    else return old;
    end if;
  end if;
  new.version:=old.version+1;
  insert into public.admin_audit_logs(opinion_id,actor_id,action,version) values(old.id,v_actor,v_action,new.version);
  return new;
end;
$$;
revoke all on function private.enforce_opinion_change() from public,anon,authenticated;
commit;
