-- 在一个新的 Supabase 项目 SQL Editor 中执行一次。所有业务数据均默认禁止匿名访问。
create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null check (role in ('admin','editor','viewer')),
  created_at timestamptz not null default now()
);
create or replace function public.member_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.members where id = auth.uid();
$$;
revoke all on function public.member_role() from public;
grant execute on function public.member_role() to authenticated;

create table public.products (
  id text primary key default gen_random_uuid()::text,
  category text not null check (length(trim(category)) between 1 and 20),
  name text not null check (length(trim(name)) between 1 and 60),
  state text not null check (state in ('鲜品','冻品','活体','冷鲜')),
  spec text not null check (length(trim(spec)) between 1 and 160),
  unique(category,name,state,spec)
);
create table public.collection_items (
  id text primary key,
  source_id text not null,
  source_name text not null,
  title text not null,
  url text not null check (url ~ '^https?://'),
  price_text text not null default '',
  region_text text not null default '',
  published_on date,
  category text not null default '',
  kind text not null check (kind in ('supply','market','macro')),
  details text not null default '',
  status text not null default 'pending' check (status in ('pending','converted','dismissed')),
  fetched_at timestamptz not null default now()
);
create table public.quotes (
  id text primary key default gen_random_uuid()::text,
  product_id text not null references public.products(id),
  supplier text not null check (length(trim(supplier)) between 1 and 120),
  province text not null check (province in ('北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆','台湾','香港','澳门')),
  city text not null default '',
  price numeric(14,4) not null check (price > 0),
  basis text not null check (basis in ('factory','delivered','untaxed')),
  source text not null check (source in ('manual','engine')),
  source_name text not null default '',
  source_url text not null default '' check (source_url = '' or source_url ~* '^https?://'),
  quoted_on date not null,
  valid_until date not null check (valid_until >= quoted_on),
  min_order text not null default '',
  freight numeric(14,4) check (freight >= 0),
  notes text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  collector_key text unique,
  collection_item_id text unique references public.collection_items(id),
  created_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index quotes_lookup on public.quotes(product_id, status, quoted_on desc, valid_until);
create index quotes_creator on public.quotes(created_by);
create table public.quote_audit (
  id bigint generated always as identity primary key,
  quote_id text not null,
  actor uuid,
  operation text not null,
  old_record jsonb,
  new_record jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.guard_quote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.quoted_on > (now() at time zone 'Asia/Shanghai')::date then
    raise exception '报价日期不能晚于今天';
  end if;
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if auth.role() = 'service_role' then
      new.status := 'pending';
      new.source := 'engine';
    end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.collector_key := old.collector_key;
    new.collection_item_id := old.collection_item_id;
  end if;
  if new.collection_item_id is not null and not exists (
    select 1 from public.collection_items where id=new.collection_item_id and kind='supply'
  ) then
    raise exception '仅供货线索可以转为供货报价';
  end if;
  new.updated_at := now();
  if new.status in ('approved','rejected') and (TG_OP = 'INSERT' or new.status is distinct from old.status) then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  elsif new.status = 'pending' then
    new.reviewed_by := null;
    new.reviewed_at := null;
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;
create trigger guard_quote before insert or update on public.quotes for each row execute function public.guard_quote();
create or replace function public.audit_quote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.quote_audit(quote_id,actor,operation,old_record,new_record)
  values (new.id,auth.uid(),TG_OP,case when TG_OP='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  if TG_OP = 'INSERT' and new.collection_item_id is not null then
    update public.collection_items set status='converted' where id=new.collection_item_id;
  end if;
  return new;
end;
$$;
create trigger audit_quote after insert or update on public.quotes for each row execute function public.audit_quote();
-- 管理员不能通过网页权限接口修改自己的角色，避免误锁账号。
create or replace function public.guard_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.id = auth.uid() and new.role is distinct from old.role then
    raise exception '不能修改自己的角色';
  end if;
  return new;
end;
$$;
create trigger guard_member before update on public.members for each row execute function public.guard_member();

alter table public.members enable row level security;
alter table public.products enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_audit enable row level security;
alter table public.collection_items enable row level security;
revoke all on public.members,public.products,public.quotes,public.quote_audit,public.collection_items from anon,authenticated;
grant select on public.members,public.products,public.quotes to authenticated;
grant insert on public.members,public.products,public.quotes to authenticated;
grant update(role) on public.members to authenticated;
grant update on public.quotes to authenticated;
grant select on public.quote_audit to authenticated;
grant select on public.collection_items to authenticated;
grant update(status) on public.collection_items to authenticated;
create policy members_read on public.members for select to authenticated using (id=auth.uid() or public.member_role()='admin');
create policy members_add on public.members for insert to authenticated with check(public.member_role()='admin');
create policy members_update on public.members for update to authenticated using(public.member_role()='admin') with check(public.member_role()='admin');
create policy products_read on public.products for select to authenticated using(public.member_role() is not null);
create policy products_add on public.products for insert to authenticated with check(public.member_role()='admin');
create policy quotes_read on public.quotes for select to authenticated using(public.member_role()='admin' or (public.member_role() is not null and status='approved') or (public.member_role()='editor' and created_by=auth.uid()));
create policy quotes_add on public.quotes for insert to authenticated with check(public.member_role()='admin' or (public.member_role()='editor' and status='pending' and created_by=auth.uid()));
create policy quotes_update on public.quotes for update to authenticated using(public.member_role()='admin') with check(public.member_role()='admin');
create policy audit_read on public.quote_audit for select to authenticated using(public.member_role()='admin');
create policy collection_read on public.collection_items for select to authenticated using(public.member_role() is not null);
create policy collection_update on public.collection_items for update to authenticated using(public.member_role()='admin') with check(public.member_role()='admin');

-- 仅初始化产品定义；不会导入演示行情。
insert into public.products(id,category,name,state,spec) values
('chicken-fresh','鸡','白羽鸡','鲜品','白条整鸡 · 1–1.5 kg/只'),
('chicken-frozen','鸡','白羽鸡','冻品','白条整鸡 · 1–1.5 kg/只'),
('chicken-leg','鸡','鸡腿','冻品','单冻琵琶腿 · 80–100 g/只'),
('pig-fresh','猪','猪肉','鲜品','白条猪 · 一级'),
('pig-belly','猪','五花肉','冻品','去骨带皮 · 标准块'),
('duck-frozen','鸭','白条鸭','冻品','整鸭 · 1.5–2 kg/只'),
('duck-fresh','鸭','白条鸭','鲜品','整鸭 · 1.5–2 kg/只'),
('goose-fresh','鹅','白条鹅','鲜品','整鹅 · 3–4 kg/只'),
('lamb-fresh','羊','羊肉','鲜品','胴体 · 绵羊 · 一级'),
('lamb-frozen','羊','羊腿','冻品','带骨后腿 · 2–3 kg/只');

-- 初始化管理员：先在 Authentication 创建/邀请自己的用户，再执行下面语句（替换邮箱）：
-- insert into public.members(id,email,display_name,role)
-- select id,email,'管理员','admin' from auth.users where email='你的邮箱';
-- 邀请同事后同样插入 members，role 填 editor 或 viewer。
