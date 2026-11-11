-- 产品规格删除权限（2026-11-11）
-- 背景：products 原先只有 select / insert 授权，前端删除会返回 permission denied。
-- 这里补上 delete 授权，并限制只有管理员可删。
-- 被报价引用的产品仍会被外键约束阻止，前端会先做前置校验。

grant delete on public.products to authenticated;

drop policy if exists products_delete on public.products;

create policy products_delete on public.products
  for delete to authenticated
  using (public.member_role() = 'admin');
