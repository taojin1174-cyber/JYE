export const roleNames = { admin:'管理员',editor:'员工',viewer:'只读成员' };
export const permissionNames = { can_create_quotes:'录入报价',can_edit_quotes:'修改本人待审报价',can_review_quotes:'审核他人报价',can_request_deletion:'申请删除本人报价' };
export function defaultPermissions(role) {
  return {can_create_quotes:role!=='viewer',can_edit_quotes:role==='admin',can_review_quotes:role==='admin',can_request_deletion:role!=='viewer'};
}
export function can(member,permission) {
  if(!member||member.active===false||member.must_change_password)return false;
  return member.role==='admin'||(member.role==='editor'&&member[permission]===true);
}
export function canEditQuote(member,quote) {
  return Boolean(quote&&!quote.deleted_at&&can(member,'can_edit_quotes')&&(member.role==='admin'||quote.created_by===member.id&&quote.status==='pending'));
}
export function canReviewQuote(member,quote) {
  return Boolean(quote&&!quote.deleted_at&&can(member,'can_review_quotes')&&(member.role==='admin'||quote.created_by!==member.id));
}
export function canRequestDeletion(member,quote) {
  return Boolean(quote&&!quote.deleted_at&&can(member,'can_request_deletion')&&(member.role==='admin'||quote.created_by===member.id));
}
