import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { representative } from '../src/lib/domain/grid';
import { NOTICE_VERSION, textLengths } from '../src/lib/domain/validation';
const operator='11111111-1111-4111-8111-111111111111';
const outsider='22222222-2222-4222-8222-222222222222';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function boot(){
  const db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    insert into auth.users(id) values('${operator}'),('${outsider}');
  `);
  const path=new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(path)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,path),'utf8'));
  await db.query('insert into public.operator_memberships(user_id) values($1)',[operator]);
  await db.exec('insert into public.allowed_cells values(41,28),(42,28);');
  return db;
}
async function role(db:PGlite,r:string,id=''){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec(`set role ${r}`);
}
async function submit(db:PGlite,key=randomUUID(),text='1234567890',consent:[boolean,boolean]=[true,true],fingerprint=hash(text),rate=hash(key),pin?:unknown){
  await role(db,'service_role');
  const r=await db.query<{result:{reference:string;created:boolean;published?:boolean}}>(
    pin===undefined?'select public.submit_opinion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result'
      :'select public.submit_opinion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) as result',
    [key,fingerprint,rate,'pohang-v1',41,28,'transport','ko',text,...consent,NOTICE_VERSION,...(pin===undefined?[]:[JSON.stringify(pin)])]);
  return r.rows[0].result;
}
async function action(db:PGlite,id:string,version:number,act:string,summary:string|null=null,player:boolean|null=null){
  await role(db,'authenticated',operator);
  return (await db.query<{result:{id:string;status:string;version:number;deleted:boolean}}>(
    'select public.admin_opinion_action($1,$2,$3,$4,$5) as result',[id,version,act,summary,player])).rows[0].result;
}
async function raw(db:PGlite){await role(db,'postgres');return (await db.query<{id:string;public_id:string;version:number;public_lat:number;public_lon:number;original_text:string|null;summary:string|null}>('select * from public.opinions order by created_at,id')).rows;}
async function publicData(db:PGlite,mode='browse'){await role(db,'service_role');return (await db.query<{result:{data:Record<string,unknown>[]}}>('select public.read_public_opinions($1) as result',[mode])).rows[0].result.data;}
test('migration, anonymous/private grants and disabled submission',async()=>{
  const db=await boot();try{
    await assert.rejects(()=>submit(db),/SUBMISSIONS_DISABLED/);
    await db.exec('delete from public.service_settings');
    await assert.rejects(()=>submit(db),/SUBMISSIONS_DISABLED/);
    await role(db,'anon');
    await assert.rejects(()=>db.query('select * from public.opinions'),/permission denied/);
    await assert.rejects(()=>db.query('select public.read_public_opinions()'),/permission denied/);
    await role(db,'authenticated',outsider);
    assert.equal((await db.query('select * from public.opinions')).rows.length,0);
    await assert.rejects(()=>db.query('select public.admin_opinion_action($1,1,$2)',[randomUUID(),'publish']),/FORBIDDEN/);
    const r=await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','private.enforce_opinion_change()','execute') as allowed");
    assert.equal(r.rows[0].allowed,false);
  }finally{await db.close();}
});
test('input constraints, grid parity and public publication/withdrawal lifecycle',async()=>{
  const db=await boot();try{
    await db.exec('update public.service_settings set submissions_enabled=true');
    await assert.rejects(()=>submit(db,randomUUID(),'123456789\u00a0'),/TEXT_TOO_SHORT/);
    await assert.rejects(()=>submit(db,randomUUID(),'x'.repeat(501)),/TEXT_TOO_LONG/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[false,true]),/INVALID_CONSENT/);
    await submit(db);const [row]=await raw(db);
    const point=representative({grid_version:'pohang-v1',cell_x:41,cell_y:28});
    assert.ok(Math.abs(row.public_lat-point.lat)<1e-10);assert.ok(Math.abs(row.public_lon-point.lon)<1e-10);
    assert.notEqual(row.id,row.public_id);assert.equal((await publicData(db)).length,0);
    let current=await action(db,row.id,1,'save_summary','담당자가 확인한 의견');
    current=await action(db,row.id,current.version,'publish');
    const data=await publicData(db);assert.equal(data.length,1);
    assert.deepEqual(Object.keys(data[0]).sort(),['category','location','public_id','summary']);
    assert.equal((await publicData(db,'player')).length,0);
    current=await action(db,row.id,current.version,'set_player',null,true);
    assert.equal((await publicData(db,'player')).length,1);
    await assert.rejects(()=>action(db,row.id,current.version,'save_summary','수정 요약'),/HIDE_BEFORE_EDIT/);
    current=await action(db,row.id,current.version,'hide');assert.equal((await publicData(db)).length,0);
    current=await action(db,row.id,current.version,'save_summary','수정한 담당자 요약');
    current=await action(db,row.id,current.version,'publish');assert.equal((await publicData(db)).length,1);
    await action(db,row.id,current.version,'delete');assert.equal((await publicData(db)).length,0);
    const [deleted]=await raw(db);assert.equal(deleted.original_text,null);assert.equal(deleted.summary,null);
    await role(db,'authenticated',operator);
    const audit=await db.query<Record<string,unknown>>('select * from public.admin_audit_logs');assert.equal(audit.rows.length,7);
    assert.ok(!Object.keys(audit.rows[0]).includes('original_text'));
    await role(db,'postgres');await db.exec('update public.operator_memberships set active=false');
    await role(db,'authenticated',operator);assert.equal((await db.query('select * from public.opinions')).rows.length,0);
  }finally{await db.close();}
});
test('idempotency, conflicting body, replay after deletion and version conflict',async()=>{
  const db=await boot();try{
    await db.exec('update public.service_settings set submissions_enabled=true');
    const key=randomUUID();const first=await submit(db,key);const retry=await submit(db,key);
    assert.equal(first.created,true);assert.equal(retry.created,false);assert.equal(first.reference,retry.reference);
    assert.equal((await raw(db)).length,1);
    await assert.rejects(()=>submit(db,key,'12345678901'),/IDEMPOTENCY_CONFLICT/);
    const [row]=await raw(db);const change=await action(db,row.id,1,'save_summary','검토한 요약');
    await assert.rejects(()=>action(db,row.id,1,'publish'),/VERSION_CONFLICT/);
    await action(db,row.id,change.version,'delete');
    assert.equal((await submit(db,key)).reference,first.reference);assert.equal((await raw(db)).length,1);
    await role(db,'service_role');assert.equal((await db.query('select count(*)::integer as count from public.rate_buckets')).rows.length,1);
    const counts=await db.query<{count:number}>('select count from public.rate_buckets');assert.ok(counts.rows.every(r=>r.count===1));
  }finally{await db.close();}
});
test('rate limits roll back, non-consented publication denied and SQL Unicode parity',async()=>{
  const db=await boot();try{
    await db.exec('update public.service_settings set submissions_enabled=true');
    const rate=hash('same-limited-network');
    for(let i=0;i<5;i++)await submit(db,randomUUID(),'1234567890',[false,false],undefined,rate);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[false,false],undefined,rate),/RATE_LIMITED/);
    assert.equal((await raw(db)).length,5);
    await role(db,'service_role');
    const dailyHash=hash('daily-capped-network');
    await db.query("insert into public.rate_buckets values($1,'day',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',20)",[dailyHash]);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[false,false],undefined,dailyHash),/RATE_LIMITED/);
    assert.equal((await raw(db)).length,5);
    const [row]=await raw(db);const changed=await action(db,row.id,1,'save_summary','검토한 요약');
    await assert.rejects(()=>action(db,row.id,changed.version,'publish'),/PUBLICATION_NOT_ALLOWED/);
    await assert.rejects(()=>action(db,row.id,changed.version,'set_player',null,true),/PLAYER_NOT_ALLOWED/);
    await role(db,'service_role');
    for(const text of ['123456789\u00a0','e\u0301🙂\u3000a','\u0009\u000A\u000B\u000C\u000D\u0085\u1680\u202f\u205f','한글10개12345678']){
      const r=await db.query<{n:number}>("select private.nonspace_count($1) as n",[text]);
      assert.equal(r.rows[0].n,textLengths(text).nonspace);
    }
    await assert.rejects(()=>db.query('insert into public.opinions(cell_x,cell_y,category,language,original_text,notice_version) values(999,999,$1,$2,$3,$4)',['transport','ko','1234567890',NOTICE_VERSION]),/foreign key/);
  }finally{await db.close();}
});
test('public truth table for browse/player matches the specification for every state (X08)',async()=>{
  const db=await boot();try{
    await role(db,'postgres');
    const expected:{browse:Set<string>;player:Set<string>}={browse:new Set(),player:new Set()};
    let n=0;
    for(const [map,player] of [[false,false],[true,false],[true,true]] as const)
    for(const status of ['pending','published','hidden'] as const)
    for(const include of [false,true])
    for(const summary of [null,'담당자 요약'])
    for(const deleted of [false,true]){
      if(include&&!(map&&player))continue;
      if(status==='published'&&(!map||summary===null||deleted))continue;
      if(deleted&&(status!=='hidden'||include||summary!==null))continue;
      n++;
      const r=await db.query<{public_id:string}>(`insert into public.opinions(cell_x,cell_y,category,language,original_text,allow_map,allow_player,notice_version,summary,status,include_in_player,deleted_at)
        values(41,28,'other','ko',$1,$2,$3,$8,$4,$5,$6,$7) returning public_id`,
        [deleted?null:'1234567890',map,player,summary,status,include,deleted?new Date().toISOString():null,NOTICE_VERSION]);
      const visible=map&&status==='published'&&!deleted&&summary!==null;
      if(visible)expected.browse.add(r.rows[0].public_id);
      if(visible&&player&&include)expected.player.add(r.rows[0].public_id);
    }
    assert.ok(n>10);
    const browse=new Set((await publicData(db)).map(x=>x.public_id as string));
    const player=new Set((await publicData(db,'player')).map(x=>x.public_id as string));
    assert.deepEqual([...browse].sort(),[...expected.browse].sort());
    assert.deepEqual([...player].sort(),[...expected.player].sort());
  }finally{await db.close();}
});
test('hide clears player inclusion so a republished summary needs re-confirmation; rate bucket cleanup',async()=>{
  const db=await boot();try{
    await db.exec('update public.service_settings set submissions_enabled=true');
    await submit(db);const [row]=await raw(db);
    let c=await action(db,row.id,1,'save_summary','요약');
    c=await action(db,row.id,c.version,'publish');
    c=await action(db,row.id,c.version,'set_player',null,true);
    assert.equal((await publicData(db,'player')).length,1);
    c=await action(db,row.id,c.version,'hide');
    c=await action(db,row.id,c.version,'publish');
    assert.equal((await publicData(db,'player')).length,0);
    assert.equal((await publicData(db)).length,1);
    // no-op action keeps the version and writes no audit entry
    const before=c.version;const same=await action(db,row.id,before,'publish');
    assert.equal(same.version,before);
    await role(db,'postgres');
    await db.query("insert into public.rate_buckets values($1,'day',now()-interval '3 days',1),($2,'day',now(),1)",[hash('old'),hash('new')]);
    await role(db,'service_role');
    assert.equal((await db.query<{n:number}>('select public.cleanup_expired_rate_buckets() as n')).rows[0].n,1);
    await role(db,'anon');
    await assert.rejects(()=>db.query('select public.cleanup_expired_rate_buckets()'),/permission denied/);
  }finally{await db.close();}
});
test('operators cannot bypass the RPC with direct updates; RPC still enforces membership (X09, X11)',async()=>{
  const db=await boot();try{
    await db.exec('update public.service_settings set submissions_enabled=true');
    await submit(db);const [row]=await raw(db);
    await role(db,'authenticated',operator);
    await assert.rejects(()=>db.query("update public.opinions set status='hidden' where id=$1",[row.id]),/permission denied/);
    await role(db,'authenticated',outsider);
    await assert.rejects(()=>db.query('select public.admin_opinion_action($1,1,$2,$3)',[row.id,'save_summary','x']),/FORBIDDEN/);
    let c=await action(db,row.id,1,'save_summary','요약');
    c=await action(db,row.id,c.version,'publish');
    c=await action(db,row.id,c.version,'set_player',null,true);
    await action(db,row.id,c.version,'hide');
    await role(db,'postgres');
    const r=await db.query<{include_in_player:boolean}>('select include_in_player from public.opinions where id=$1',[row.id]);
    assert.equal(r.rows[0].include_in_player,false);
    const a=await db.query<{action:string}>('select action from public.admin_audit_logs where opinion_id=$1 order by version',[row.id]);
    assert.deepEqual(a.rows.map(x=>x.action),['save_summary','publish','set_player','hide']);
  }finally{await db.close();}
});
test('test mode auto-publish: off by default, respects consent, truncates, operator-only switch',async()=>{
  const db=await boot();try{
    await db.exec('update public.service_settings set submissions_enabled=true');
    await role(db,'service_role');
    const config=(await db.query<{c:{test_auto_publish:boolean}}>('select public.read_public_config() as c')).rows[0].c;
    assert.equal(config.test_auto_publish,false);
    const off=await submit(db);
    assert.equal(off.published,false);assert.equal((await publicData(db)).length,0);
    // only an active operator can switch it
    await role(db,'anon');
    await assert.rejects(()=>db.query('select public.admin_set_test_auto_publish(true)'),/permission denied/);
    await role(db,'service_role');
    await assert.rejects(()=>db.query('select public.admin_set_test_auto_publish(true)'),/permission denied/);
    await role(db,'authenticated',outsider);
    await assert.rejects(()=>db.query('select public.admin_set_test_auto_publish(true)'),/FORBIDDEN/);
    await role(db,'authenticated',operator);
    await assert.rejects(()=>db.query('select public.admin_set_test_auto_publish(true,0)'),/INVALID_REQUEST/);
    await assert.rejects(()=>db.query('select public.admin_set_test_auto_publish(true,73)'),/INVALID_REQUEST/);
    await db.query('select public.admin_set_test_auto_publish(true)');
    await role(db,'postgres');
    const hours=(await db.query<{h:number}>("select extract(epoch from (test_auto_publish_until-now()))/3600 as h from public.service_settings")).rows[0].h;
    assert.ok(hours>11.9&&hours<=12);
    await role(db,'authenticated',operator);
    // map+player consent → published and in the player; map only → map; none → stays pending
    const both=await submit(db,randomUUID(),'  플레이어까지 공개하는 의견입니다  ',[true,true]);
    const mapOnly=await submit(db,randomUUID(),'지도에만 공개하는 의견입니다',[true,false]);
    const none=await submit(db,randomUUID(),'공개하지 않는 의견입니다 비공개',[false,false]);
    assert.deepEqual([both.published,mapOnly.published,none.published],[true,true,false]);
    const browse=await publicData(db);const player=await publicData(db,'player');
    assert.deepEqual(browse.map(x=>x.summary),['플레이어까지 공개하는 의견입니다','지도에만 공개하는 의견입니다']);
    assert.deepEqual(player.map(x=>x.summary),['플레이어까지 공개하는 의견입니다']);
    const long='가'.repeat(400);
    await submit(db,randomUUID(),long,[true,true]);
    const last=(await publicData(db,'player')).at(-1)!.summary as string;
    assert.equal([...last].length,250);assert.ok(last.endsWith('…'));
    // auto-published opinions still go through the normal operator flow afterwards
    const rows=await raw(db);const auto=rows.find(r=>r.summary==='지도에만 공개하는 의견입니다')!;
    const hidden=await action(db,auto.id,auto.version,'hide');assert.equal(hidden.status,'hidden');
    assert.equal((await publicData(db)).length,2);
    // 자동 공개 이력은 켠 담당자 이름으로 남고, 켜고 끈 기록도 남는다
    await role(db,'authenticated',operator);
    const autoAudit=await db.query<{action:string;actor_id:string}>("select action,actor_id from public.admin_audit_logs where action='auto_publish'");
    assert.equal(autoAudit.rows.length,3);assert.ok(autoAudit.rows.every(r=>r.actor_id===operator));
    // 같은 키 재시도는 이미 공개되었다는 사실을 돌려준다
    const replayKey=randomUUID();await submit(db,replayKey,'재시도 확인용 의견입니다 공개',[true,true]);
    assert.equal((await submit(db,replayKey,'재시도 확인용 의견입니다 공개',[true,true])).published,true);
    // 정한 시간이 지나면 저절로 꺼진다
    await role(db,'postgres');await db.exec("update public.service_settings set test_auto_publish_until=now()-interval '1 second'");
    await role(db,'service_role');
    assert.equal((await db.query<{c:{test_auto_publish:boolean}}>('select public.read_public_config() as c')).rows[0].c.test_auto_publish,false);
    assert.equal((await submit(db,randomUUID(),'시간이 지나면 검토를 거칩니다',[true,true])).published,false);
    await role(db,'authenticated',operator);await db.query('select public.admin_set_test_auto_publish(true,1)');
    await db.query('select public.admin_set_test_auto_publish(false)');
    const after=await submit(db,randomUUID(),'다시 검토를 거치는 의견입니다',[true,true]);
    assert.equal(after.published,false);
    await role(db,'authenticated',operator);
    const settingsAudit=await db.query<{value:string}>('select value from public.settings_audit_logs order by created_at,id');
    // 같은 시각(ms)에 두 기록이 생기면 순서가 정해지지 않으므로 '끔' 기록이 하나 있는지로 본다.
    assert.equal(settingsAudit.rows.length,3);assert.equal(settingsAudit.rows.filter(r=>r.value==='off').length,1);
    await role(db,'anon');await assert.rejects(()=>db.query('select * from public.settings_audit_logs'),/permission denied/);
  }finally{await db.close();}
});

test('staff-only review pin: stored inside the cell, operator-only read, never public, removed on delete',async()=>{
  const db=await boot();try{
    await db.exec('update public.service_settings set submissions_enabled=true');
    await role(db,'service_role');
    const cfg=(await db.query<{r:Record<string,unknown>}>('select public.read_public_config() as r')).rows[0].r;
    assert.equal(cfg.review_pin,true);assert.equal(cfg.notice_version,NOTICE_VERSION);
    const c=representative({grid_version:'pohang-v1',cell_x:41,cell_y:28});
    const rv={pano_id:1187902201,pin_pan:330,pin_tilt:12.5,view_pan:5.5,view_tilt:-3,view_zoom:1};
    const pin={lat:c.lat+0.0004,lon:c.lon-0.0005,roadview:rv};
    // 다른 칸 좌표·잘못된 로드뷰 값은 거절하고 아무것도 남기지 않는다.
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{lat:c.lat+0.003,lon:c.lon}),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{lat:'x',lon:c.lon}),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{...pin,roadview:{...rv,pin_tilt:120}}),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{...pin,roadview:{...rv,pano_id:-1}}),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{...pin,roadview:{...rv,pano_id:'1187902201'}}),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{...pin,roadview:{...rv,extra:1}}),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{...pin,extra:1}),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,[1,2]),/INVALID_PIN/);
    await assert.rejects(()=>submit(db,randomUUID(),'1234567890',[true,true],undefined,undefined,{...pin,roadview:[1]}),/INVALID_PIN/);
    assert.equal((await raw(db)).length,0);
    const key=randomUUID();
    await submit(db,key,'1234567890',[true,true],undefined,undefined,pin);
    await submit(db,key,'1234567890',[true,true],undefined,undefined,pin); // 같은 키 재시도: 핀도 1건
    await submit(db,randomUUID(),'0987654321',[true,true],undefined,undefined,{lat:c.lat,lon:c.lon,roadview:null});
    await submit(db,randomUUID(),'1122334455'); // 핀 없이(예전 화면) 등록도 그대로 된다
    await role(db,'postgres');
    const all=(await db.query<Record<string,unknown>>('select * from public.opinion_review_pins order by created_at')).rows;
    assert.equal(all.length,2);
    assert.equal(all[0].lat,pin.lat);assert.equal(Number(all[0].pano_id),rv.pano_id);assert.equal(all[0].pin_pan,330);
    assert.equal(all[1].pano_id,null);
    // 익명·일반 로그인은 읽지 못하고, 담당자도 직접 쓰거나 지우지 못한다.
    await role(db,'anon');await assert.rejects(()=>db.query('select * from public.opinion_review_pins'),/permission denied/);
    await role(db,'authenticated',outsider);assert.equal((await db.query('select * from public.opinion_review_pins')).rows.length,0);
    await role(db,'authenticated',operator);
    assert.equal((await db.query('select * from public.opinion_review_pins')).rows.length,2);
    await assert.rejects(()=>db.query('delete from public.opinion_review_pins'),/permission denied/);
    await assert.rejects(()=>db.query('update public.opinion_review_pins set lat=0'),/permission denied/);
    await assert.rejects(()=>db.query('insert into public.opinion_review_pins(opinion_id,lat,lon) values($1,36,129)',[randomUUID()]),/permission denied/);
    // 공개되어도 공개 응답에는 대표점만
    const rows=await raw(db);const pinned=rows.find(r=>r.original_text==='1234567890')!;
    let v=await action(db,pinned.id,1,'save_summary','핀 있는 의견');
    v=await action(db,pinned.id,v.version,'publish');
    const pub=await publicData(db);assert.equal(pub.length,1);
    assert.deepEqual(Object.keys(pub[0]).sort(),['category','location','public_id','summary']);
    assert.ok(!JSON.stringify(pub).includes(String(pin.lat)) && !JSON.stringify(pub).includes(String(rv.pano_id)));
    // 삭제하면 핀도 지워진다.
    await action(db,pinned.id,v.version,'delete');
    await role(db,'postgres');
    const left=(await db.query<{opinion_id:string}>('select opinion_id from public.opinion_review_pins')).rows;
    assert.equal(left.length,1);assert.notEqual(left[0].opinion_id,pinned.id);
  }finally{await db.close();}
});
