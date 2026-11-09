import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL 实际权限：录入、越权、删除审批、停用和审计', async t => {
  const db = new PGlite();
  const ids = { admin:'10000000-0000-4000-8000-000000000001', entry:'10000000-0000-4000-8000-000000000002', viewer:'10000000-0000-4000-8000-000000000003', reviewer:'10000000-0000-4000-8000-000000000004' };
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on all functions in schema auth to authenticated,anon,service_role;
  `);
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  const migration=await readFile(new URL('../supabase/migrations/20261109_team_permissions.sql',import.meta.url),'utf8');
  await db.exec(migration);
  for(const [name,id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${name}@example.test`]);
    await db.query(`insert into public.members(id,email,display_name,role,can_create_quotes,can_request_deletion,can_review_quotes) values($1,$2,$3,$4,$5,$5,$6)`,[id,`${name}@example.test`,name,name==='admin'?'admin':name==='viewer'?'viewer':'editor',name!=='viewer',name==='reviewer']);
  }
  async function as(name,sql,params=[]) {
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[name],role:'authenticated',iat:Math.floor(Date.now()/1000)})]);
    await db.exec('set role authenticated');
    try { return await db.query(sql,params); }
    finally { await db.exec('reset role'); await db.exec("select set_config('request.jwt.claims','{}',false)"); }
  }
  const insert=`insert into public.quotes(id,product_id,supplier,province,price,basis,source,quoted_on,valid_until,status)
    values($1,'chicken-fresh','测试供应商','山东',12,'factory','manual',(now() at time zone 'Asia/Shanghai')::date,(now() at time zone 'Asia/Shanghai')::date+2,$2)`;
  await t.test('录入员仅新增待审，不能自审、改价、直接删除或篡改授权',async()=>{
    await as('entry',insert,['entry-q','pending']);
    await assert.rejects(as('entry',insert,['bad-q','approved']));
    try { await as('entry',"update public.quotes set status='approved' where id='entry-q'"); } catch {}
    assert.equal((await db.query("select status from public.quotes where id='entry-q'")).rows[0].status,'pending');
    // RLS 可能拒绝，也可能将可更新行过滤为零；两种情况都必须保持数据不变。
    try { await as('entry',"update public.quotes set price=1 where id='entry-q'"); } catch {}
    assert.equal((await db.query("select price from public.quotes where id='entry-q'")).rows[0].price,'12.0000');
    await assert.rejects(as('entry',"delete from public.quotes where id='entry-q'"));
    await assert.rejects(as('entry',"update public.members set role='admin' where id=$1",[ids.entry]));
    await assert.rejects(as('entry',"update public.quotes set deleted_at=now() where id='entry-q'"));
  });
  await t.test('只读成员不能录入或申请删除；审核授权不能改价或审核本人报价',async()=>{
    await assert.rejects(as('viewer',insert,['viewer-q','pending']));
    await assert.rejects(as('viewer',"select public.request_quote_deletion('entry-q','重复报价')"));
    await as('reviewer',"update public.quotes set status='approved' where id='entry-q'");
    await assert.rejects(as('reviewer',"update public.quotes set price=1 where id='entry-q'"));
    await as('reviewer',insert,['reviewer-q','pending']);
    await assert.rejects(as('reviewer',"update public.quotes set status='approved' where id='reviewer-q'"));
  });
  let requestId;
  await t.test('删除必须申请，重复申请、替他人申请和员工审批均被拒绝',async()=>{
    requestId=(await as('entry',"select public.request_quote_deletion('entry-q','重复录入报价') as id")).rows[0].id;
    assert.equal((await db.query("select deleted_at from public.quotes where id='entry-q'")).rows[0].deleted_at,null);
    await assert.rejects(as('entry',"select public.request_quote_deletion('entry-q','重复录入报价')"));
    await assert.rejects(as('entry',"select public.request_quote_deletion('reviewer-q','录入信息错误')"));
    await assert.rejects(as('entry',"select public.review_quote_deletion($1,'approved','')",[requestId]));
    assert.equal((await as('viewer','select count(*)::int as n from public.deletion_requests')).rows[0].n,0);
  });
  await t.test('管理员审批后软删除、员工不可见、可恢复且记录可追溯',async()=>{
    await as('admin',"select public.review_quote_deletion($1,'approved','核实为重复记录')",[requestId]);
    assert.ok((await db.query("select deleted_at from public.quotes where id='entry-q'")).rows[0].deleted_at);
    assert.equal((await as('entry',"select count(*)::int as n from public.quotes where id='entry-q'")).rows[0].n,0);
    await assert.rejects(as('admin',"select public.review_quote_deletion($1,'approved','')",[requestId]));
    await assert.rejects(as('admin',"delete from public.quotes where id='entry-q'"));
    await as('admin',"select public.restore_quote('entry-q','审批误删恢复')");
    assert.equal((await as('entry',"select count(*)::int as n from public.quotes where id='entry-q'")).rows[0].n,1);
    const events=(await as('admin','select action from public.management_audit')).rows.map(r=>r.action);
    assert.ok(events.includes('deletion_requested'));assert.ok(events.includes('deletion_approved'));assert.ok(events.includes('quote_restored'));
    assert.equal((await as('entry','select count(*)::int as n from public.management_audit')).rows[0].n,0);
  });
  await t.test('停用、首次改密和重置后的旧令牌都立即失去业务权限',async()=>{
    await db.query('update public.members set active=false where id=$1',[ids.entry]);
    assert.equal((await as('entry','select public.member_role() as role')).rows[0].role,null);
    assert.equal((await as('entry','select count(*)::int as n from public.quotes')).rows[0].n,0);
    await assert.rejects(as('entry',insert,['disabled-q','pending']));
    await db.query('update public.members set active=true,must_change_password=true where id=$1',[ids.entry]);
    assert.equal((await as('entry','select public.member_role() as role')).rows[0].role,null);
    await db.query("update public.members set must_change_password=false,auth_valid_after=now()+interval '1 minute' where id=$1",[ids.entry]);
    assert.equal((await as('entry','select public.member_role() as role')).rows[0].role,null);
    await db.query("update public.members set auth_valid_after='1970-01-01' where id=$1",[ids.entry]);
  });
  await t.test('至少保留一名管理员，迁移重跑不重置自定义权限',async()=>{
    await assert.rejects(db.query('update public.members set active=false where id=$1',[ids.admin]));
    await db.query('update public.members set can_create_quotes=false where id=$1',[ids.entry]);
    await db.exec(migration);
    assert.equal((await db.query('select can_create_quotes from public.members where id=$1',[ids.entry])).rows[0].can_create_quotes,false);
  });
  await db.close();
});
