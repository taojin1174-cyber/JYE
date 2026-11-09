-- 先执行 schema.sql，再执行本迁移。可重复应用；已有自定义权限不会被重置。
begin;
create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;

alter table public.members
  add column if not exists active boolean not null default true,
  add column if not exists can_create_quotes boolean not null default false,
  add column if not exists can_edit_quotes boolean not null default false,
  add column if not exists can_review_quotes boolean not null default false,
  add column if not exists can_request_deletion boolean not null default false,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists auth_valid_after timestamptz not null default '1970-01-01T00:00:00Z',
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
update public.members set can_create_quotes=true, can_request_deletion=true
where role='editor' and not exists(select 1 from public.app_migrations where name='team_permissions_v1');

create or replace function public.member_role() returns text
language sql stable security definer set search_path='' as $$
  select role from public.members where id=auth.uid() and active and not must_change_password
    and coalesce((auth.jwt()->>'iat')::bigint,0) >= extract(epoch from auth_valid_after);
$$;
create or replace function public.member_can(p_permission text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case when public.member_role()='admin' then true
    when public.member_role()='editor' then case p_permission
      when 'create' then can_create_quotes when 'edit' then can_edit_quotes
      when 'review' then can_review_quotes when 'request_deletion' then can_request_deletion else false end
    else false end from public.members where id=auth.uid()),false);
$$;
revoke all on function public.member_can(text) from public;
grant execute on function public.member_can(text) to authenticated;

alter table public.quotes
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_request_id uuid,
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by uuid references auth.users(id),
  add column if not exists restore_reason text not null default '';
create table if not exists public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id text not null references public.quotes(id),
  reason text not null check (length(trim(reason)) between 4 and 500),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  quote_snapshot jsonb not null
);
create unique index if not exists deletion_requests_one_pending on public.deletion_requests(quote_id) where status='pending';
create table if not exists public.management_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  action text not null,
  target_id text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.deletion_requests enable row level security;
alter table public.management_audit enable row level security;
revoke all on public.deletion_requests,public.management_audit from anon,authenticated;
grant select on public.deletion_requests,public.management_audit to authenticated;
grant select,insert on public.management_audit to service_role;
grant select,insert,update on public.members to service_role;
drop policy if exists requests_read on public.deletion_requests;
create policy requests_read on public.deletion_requests for select to authenticated
  using(public.member_role()='admin' or (public.member_role() is not null and requested_by=auth.uid()));
drop policy if exists management_audit_read on public.management_audit;
create policy management_audit_read on public.management_audit for select to authenticated using(public.member_role()='admin');

create or replace function public.guard_member() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_actor uuid;
begin
  v_actor:=coalesce(auth.uid(),new.updated_by);
  if TG_OP='UPDATE' then
    if old.id=v_actor and (new.role is distinct from old.role or not new.active) then raise exception '不能修改自己的角色或停用自己的账号'; end if;
    if old.role='admin' and old.active and (new.role<>'admin' or not new.active) then
      perform pg_advisory_xact_lock(830091);
      if not exists(select 1 from public.members where role='admin' and active and id<>old.id) then raise exception '至少保留一名有效管理员'; end if;
    end if;
    new.id:=old.id; new.email:=old.email; new.created_at:=old.created_at;
  end if;
  new.updated_by:=v_actor; new.updated_at:=now();
  return new;
end;
$$;
drop trigger if exists guard_member on public.members;
create trigger guard_member before insert or update on public.members for each row execute function public.guard_member();
create or replace function public.audit_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.management_audit(actor,action,target_id,details)
    values(new.updated_by,case when TG_OP='INSERT' then 'account_created' else 'account_updated' end,new.id::text,
      jsonb_build_object('name',new.display_name,'role',new.role,'active',new.active,
        'permissions',jsonb_build_object('create',new.can_create_quotes,'edit',new.can_edit_quotes,'review',new.can_review_quotes,'request_deletion',new.can_request_deletion)));
  return new;
end;
$$;
drop trigger if exists audit_member on public.members;
create trigger audit_member after insert or update on public.members for each row execute function public.audit_member();
-- 账号变更只能经验证管理员身份的 Edge Function 执行。
revoke insert,update,delete on public.members from authenticated;
revoke update(role) on public.members from authenticated;

create or replace function public.guard_quote() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_role text; v_excluded text[]:=array['status','created_by','created_at','updated_at','reviewed_by','reviewed_at'];
begin
  v_role:=public.member_role();
  if new.quoted_on > (now() at time zone 'Asia/Shanghai')::date then raise exception '报价日期不能晚于今天'; end if;
  if TG_OP='INSERT' then
    new.created_by:=auth.uid(); new.created_at:=now();
    if auth.role()='service_role' then new.status:='pending'; new.source:='engine';
    elsif auth.uid() is not null and (not public.member_can('create') or (v_role<>'admin' and new.status<>'pending')) then
      raise exception '当前账号只能按授权提交待审核报价';
    end if;
    new.deleted_at:=null; new.deleted_by:=null; new.deletion_request_id:=null;
    new.restored_at:=null; new.restored_by:=null; new.restore_reason:='';
  else
    new.created_by:=old.created_by; new.created_at:=old.created_at;
    new.collector_key:=old.collector_key; new.collection_item_id:=old.collection_item_id;
    if auth.uid() is not null and v_role is distinct from 'admin' then
      if public.member_can('edit') and old.created_by=auth.uid() and old.status='pending' and new.status='pending' then
        if new.deleted_at is distinct from old.deleted_at then raise exception '删除必须提交申请'; end if;
      elsif public.member_can('review') and old.created_by is distinct from auth.uid()
        and (to_jsonb(new)-v_excluded)=(to_jsonb(old)-v_excluded) then null;
      else raise exception '没有修改该报价的权限'; end if;
    end if;
  end if;
  if new.collection_item_id is not null and not exists(select 1 from public.collection_items where id=new.collection_item_id and kind='supply') then
    raise exception '仅供货线索可以转为供货报价';
  end if;
  new.updated_at:=now();
  if new.status in ('approved','rejected') and (TG_OP='INSERT' or new.status is distinct from old.status) then
    new.reviewed_by:=auth.uid(); new.reviewed_at:=now();
  elsif new.status='pending' then new.reviewed_by:=null; new.reviewed_at:=null;
  else new.reviewed_by:=old.reviewed_by; new.reviewed_at:=old.reviewed_at; end if;
  return new;
end;
$$;
drop policy if exists quotes_read on public.quotes;
drop policy if exists quotes_add on public.quotes;
drop policy if exists quotes_update on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using(public.member_role()='admin'
  or (deleted_at is null and public.member_role() is not null and (status='approved' or created_by=auth.uid() or public.member_can('review'))));
create policy quotes_add on public.quotes for insert to authenticated with check(public.member_can('create') and created_by=auth.uid()
  and (public.member_role()='admin' or status='pending'));
create policy quotes_update on public.quotes for update to authenticated
  using(deleted_at is null and (public.member_role()='admin' or public.member_can('review') or (public.member_can('edit') and created_by=auth.uid() and status='pending')))
  with check(deleted_at is null and (public.member_role()='admin' or public.member_can('review') or (public.member_can('edit') and created_by=auth.uid() and status='pending')));
revoke update,delete on public.quotes from authenticated;
grant update(product_id,supplier,province,city,price,basis,source,source_name,source_url,quoted_on,valid_until,min_order,freight,notes,status) on public.quotes to authenticated;

create or replace function public.request_quote_deletion(p_quote_id text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_quote public.quotes; v_id uuid;
begin
  if not public.member_can('request_deletion') then raise exception '没有申请删除的权限'; end if;
  if length(trim(p_reason))<4 or length(p_reason)>500 then raise exception '请填写 4–500 字的删除原因'; end if;
  select * into v_quote from public.quotes where id=p_quote_id and deleted_at is null for share;
  if not found then raise exception '报价不存在或已删除'; end if;
  if public.member_role()<>'admin' and v_quote.created_by is distinct from auth.uid() then raise exception '仅可申请删除本人录入的报价'; end if;
  if exists(select 1 from public.deletion_requests where quote_id=p_quote_id and status='pending') then raise exception '这条报价已有待审批的删除申请'; end if;
  insert into public.deletion_requests(quote_id,reason,requested_by,quote_snapshot)
    values(p_quote_id,trim(p_reason),auth.uid(),to_jsonb(v_quote)) returning id into v_id;
  insert into public.management_audit(actor,action,target_id,details)
    values(auth.uid(),'deletion_requested',p_quote_id,jsonb_build_object('request_id',v_id,'reason',trim(p_reason)));
  return v_id;
end;
$$;
create or replace function public.review_quote_deletion(p_request_id uuid,p_decision text,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.deletion_requests;
begin
  if public.member_role() is distinct from 'admin' then raise exception '只有管理员可以审批删除'; end if;
  if p_decision not in ('approved','rejected') then raise exception '审批结果无效'; end if;
  if length(p_note)>500 or (p_decision='rejected' and length(trim(p_note))<4) then raise exception '驳回时请填写至少 4 字原因，最长 500 字'; end if;
  select * into v_request from public.deletion_requests where id=p_request_id for update;
  if not found or v_request.status<>'pending' then raise exception '申请不存在或已处理'; end if;
  if p_decision='approved' then
    perform 1 from public.quotes where id=v_request.quote_id and deleted_at is null for update;
    if not found then raise exception '报价已删除，请刷新申请列表'; end if;
    update public.quotes set deleted_at=now(),deleted_by=auth.uid(),deletion_request_id=p_request_id where id=v_request.quote_id;
  end if;
  update public.deletion_requests set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_note=trim(p_note) where id=p_request_id;
  insert into public.management_audit(actor,action,target_id,details)
    values(auth.uid(),'deletion_'||p_decision,v_request.quote_id,jsonb_build_object('request_id',p_request_id,'reason',v_request.reason,'note',trim(p_note)));
end;
$$;
create or replace function public.restore_quote(p_quote_id text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.member_role() is distinct from 'admin' then raise exception '只有管理员可以恢复报价'; end if;
  if length(trim(p_reason))<4 or length(p_reason)>500 then raise exception '请填写 4–500 字恢复原因'; end if;
  perform 1 from public.quotes where id=p_quote_id and deleted_at is not null for update;
  if not found then raise exception '报价不在回收站'; end if;
  update public.quotes set deleted_at=null,deleted_by=null,deletion_request_id=null,restored_at=now(),restored_by=auth.uid(),restore_reason=trim(p_reason) where id=p_quote_id;
  insert into public.management_audit(actor,action,target_id,details) values(auth.uid(),'quote_restored',p_quote_id,jsonb_build_object('reason',trim(p_reason)));
end;
$$;
revoke all on function public.request_quote_deletion(text,text),public.review_quote_deletion(uuid,text,text),public.restore_quote(text,text) from public;
grant execute on function public.request_quote_deletion(text,text),public.review_quote_deletion(uuid,text,text),public.restore_quote(text,text) to authenticated;
insert into public.app_migrations(name) values('team_permissions_v1') on conflict do nothing;
-- Supabase 的默认授权可能单独授予 anon/authenticated，不能只撤销 PUBLIC。
revoke execute on function public.audit_member(),public.audit_quote(),public.guard_member(),public.guard_quote() from public,anon,authenticated;
revoke execute on function public.member_role(),public.member_can(text),public.request_quote_deletion(text,text),public.review_quote_deletion(uuid,text,text),public.restore_quote(text,text) from public,anon;
commit;
