import { roleNames,permissionNames,defaultPermissions,canRequestDeletion } from './permissions.js';
import { money } from './core.js';

const actionNames={account_created:'新增员工',account_updated:'调整账号与授权',password_reset:'重置员工密码',password_changed:'修改本人密码',deletion_requested:'提交删除申请',deletion_approved:'批准删除',deletion_rejected:'驳回删除',quote_restored:'恢复报价',quote_created:'录入报价',quote_updated:'修改报价',quote_reviewed:'审核报价'};
const requestNames={pending:'待审批',approved:'已批准',rejected:'已驳回'};
export function createTeamUI(ctx){
 const {store,esc:e,icon,showDialog,dialogHead,field,toast,execute,render}=ctx;
 const data=()=>ctx.getData();
 const member=id=>data().members?.find(m=>m.id===id);
 const person=id=>id===store.member?.id?'我':member(id)?.display_name||member(id)?.email||'系统 / 历史账号';
 const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
 const empty=(text,cols)=>`<tr><td colspan="${cols}" class="empty">${e(text)}</td></tr>`;
 const quoteName=q=>ctx.productLabel(ctx.product(q?.product_id));
 const permissions=m=>m.role==='admin'?'全部管理权限':Object.entries(permissionNames).filter(([key])=>m[key]&&m.role!=='viewer').map(([,name])=>name).join(' · ')||'只读';
 const blocked=()=>toast('真实员工账号需要先连接团队数据库，当前只提供本机权限体验');
 const footer=label=>`<div class="dialog-foot"><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">${label}</button></div>`;
 function staffPanel(){
  const members=data().members||[];
  return `${!store.cloud?'<div class="review-intro">当前是本机演示。下面的演示身份可在右上角“我的账户”切换；新增员工、密码重置和停用将在连接团队数据库后启用。</div>':''}<section class="panel"><div class="panel-head"><h2>员工账号 <small>${members.length} 个账号</small></h2><button class="btn primary small" data-team="create">${icon('plus',13)}新增员工</button></div><div class="table-wrap"><table><thead><tr><th>姓名 / 登录账号</th><th>角色</th><th>操作权限</th><th>状态</th><th>账号管理</th></tr></thead><tbody>${members.map(m=>`<tr><td>${e(m.display_name)}${m.id===store.member.id?'<span class="tag fresh">当前账号</span>':''}<div class="product-spec">${e(m.email)}</div></td><td>${e(roleNames[m.role])}</td><td class="permission-summary">${e(permissions(m))}</td><td>${m.active?'正常':'已停用'}${m.must_change_password?'<div class="product-spec">下次登录须改密</div>':''}${!store.cloud?'<div class="product-spec">演示身份</div>':''}</td><td><div class="review-actions"><button class="btn small" data-member-edit="${e(m.id)}">授权</button>${m.id!==store.member.id?`<button class="btn small" data-member-reset="${e(m.id)}">重置密码</button><button class="btn small ${m.active?'danger':''}" data-member-state="${e(m.id)}">${m.active?'停用':'启用'}</button>`:'<button class="btn small" data-team="change-password">修改密码</button>'}</div></td></tr>`).join('')||empty('尚无员工账号',5)}</tbody></table></div><div class="table-foot"><span>员工密码不展示原文。管理员可设置初始密码或重置；首次登录必须修改。停用后业务权限立即失效。</span></div></section>`;
 }
 function deletionPanel({compact=false}={}){
  const all=(data().deletionRequests||[]).filter(r=>store.role==='admin'||r.requested_by===store.member.id);
  const filter=ctx.state.deletionFilter||'pending';
  const rows=all.filter(r=>!compact?r.status===filter:true).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,compact?10:100);
  return `<section class="panel ${compact?'request-history':''}"><div class="panel-head"><h2>${store.role==='admin'?'删除申请':'我的删除申请'} <small>审批通过后才移入回收站</small></h2>${!compact?`<div class="segmented">${Object.entries(requestNames).map(([id,name])=>`<button data-team-delete-filter="${id}" class="${filter===id?'active':''}">${name} ${all.filter(r=>r.status===id).length}</button>`).join('')}</div>`:''}</div><div class="table-wrap"><table><thead><tr><th>申请报价</th><th>申请人 / 时间</th><th>删除原因</th><th>审批结果</th><th></th></tr></thead><tbody>${rows.map(r=>{const q=data().quotes.find(q=>q.id===r.quote_id)||r.quote_snapshot;return `<tr><td>${e(quoteName(q))}<div class="product-spec">${e(q?.supplier)} · ¥ ${money(q?.price)} / kg</div></td><td>${e(person(r.requested_by))}<div class="product-spec">${e(time(r.created_at))}</div></td><td class="source-notes">${e(r.reason)}</td><td>${e(requestNames[r.status])}${r.review_note?`<div class="product-spec">${e(r.review_note)}</div>`:''}${r.reviewed_at?`<div class="product-spec">${e(person(r.reviewed_by))} · ${e(time(r.reviewed_at))}</div>`:''}</td><td>${store.role==='admin'&&r.status==='pending'?`<button class="btn small primary" data-delete-review="${e(r.id)}">审批</button>`:'<span class="subtle">保留申请记录</span>'}</td></tr>`;}).join('')||empty('暂无删除申请',5)}</tbody></table></div></section>`;
 }
 function recyclePanel(){
  const rows=data().quotes.filter(q=>q.deleted_at).sort((a,b)=>b.deleted_at.localeCompare(a.deleted_at));
  return `<section class="panel"><div class="panel-head"><h2>报价回收站 <small>${rows.length} 条 · 不参与均价</small></h2></div><div class="table-wrap"><table><thead><tr><th>产品 / 供应商</th><th>供货价</th><th>删除时间</th><th>删除原因</th><th></th></tr></thead><tbody>${rows.map(q=>`<tr><td>${e(quoteName(q))}<div class="product-spec">${e(q.supplier)} · ${e(q.province)}</div></td><td>¥ ${money(q.price)} / kg</td><td>${e(time(q.deleted_at))}</td><td class="source-notes">${e(data().deletionRequests.find(r=>r.id===q.deletion_request_id)?.reason||'历史记录')}</td><td><button class="btn small" data-restore-quote="${e(q.id)}">恢复报价</button></td></tr>`).join('')||empty('回收站为空',5)}</tbody></table></div></section>`;
 }
 function auditPanel(){
  const rows=[...(data().audit||[])].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,100);
  return `<section class="panel"><div class="panel-head"><h2>操作日志 <small>最近 ${rows.length} 条</small></h2></div><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>说明</th></tr></thead><tbody>${rows.map(r=>{const q=data().quotes.find(q=>q.id===r.target_id);const m=member(r.target_id);return `<tr><td>${e(time(r.created_at))}</td><td>${e(person(r.actor))}</td><td>${e(actionNames[r.action]||r.action)}</td><td>${e(m?.display_name||q?.supplier||r.target_id.slice(0,8))}</td><td class="source-notes">${e(r.details?.reason||r.details?.note||r.details?.name||'操作已记录')}</td></tr>`;}).join('')||empty('暂无操作记录',5)}</tbody></table></div><div class="table-foot"><span>保留账号授权、密码操作、删除审批及恢复记录；不记录密码原文。</span></div></section>`;
 }
 function memberForm(id){
  if(!store.cloud)return blocked();
  const m=id?member(id):{role:'editor',display_name:'',email:'',...defaultPermissions('editor')};if(!m)return;
  showDialog(dialogHead(id?'员工授权':'新增员工','登录账号使用邮箱；权限由后端验证。')+`<form id="team-member-form" data-id="${e(id||'')}"><div class="form-body"><p class="form-error" role="alert"></p><div class="form-grid">${field('姓名 <span>*</span>',`<input name="display_name" aria-label="员工姓名" value="${e(m.display_name)}" required maxlength="60">`)}${field('登录账号（邮箱） <span>*</span>',`<input name="email" aria-label="员工邮箱账号" type="email" value="${e(m.email)}" required ${id?'disabled':''} autocomplete="off">`)}${field('角色',`<select name="role" aria-label="员工角色" ${id===store.member.id?'disabled':''}>${Object.entries(roleNames).map(([role,label])=>`<option value="${role}" ${m.role===role?'selected':''}>${label}</option>`).join('')}</select>`)}${!id?field('初始密码 <span>*</span>','<input name="password" aria-label="员工初始密码" type="password" minlength="12" maxlength="128" required autocomplete="new-password">'):''}<div class="field full"><label>员工操作权限</label><div class="permission-grid">${Object.entries(permissionNames).map(([key,label])=>`<label class="permission-option"><input type="checkbox" name="${key}" ${m.role==='admin'||m[key]&&m.role!=='viewer'?'checked':''} ${m.role!=='editor'?'disabled':''}>${label}</label>`).join('')}</div><small>删除审批、恢复和账号管理始终仅限管理员。员工的修改权限只作用于本人待审报价。</small></div>${!id?'<p class="subtle full">新员工首次登录必须修改初始密码。</p>':''}</div></div>${footer(id?'保存授权':'创建员工账号')}</form>`);
 }
 function resetForm(id){if(!store.cloud)return blocked();const m=member(id);if(!m)return;showDialog(dialogHead('重置员工密码',`${m.display_name} · ${m.email}`)+`<form id="team-reset-form" data-id="${e(id)}"><div class="form-body"><p class="form-error" role="alert"></p>${field('新的临时密码 <span>*</span>','<input name="password" aria-label="新的临时密码" type="password" minlength="12" maxlength="128" required autocomplete="new-password">')}<p class="subtle">重置后原会话失去业务权限，员工须用临时密码登录并设置自己的新密码。</p></div>${footer('重置密码')}</form>`);}
 function passwordFields(){return `${field('当前密码 / 初始密码','<input name="current_password" aria-label="当前密码" type="password" autocomplete="current-password" required>')}${field('新密码','<input name="password" aria-label="新密码" type="password" minlength="12" maxlength="128" autocomplete="new-password" required>')}${field('再次输入新密码','<input name="confirmation" aria-label="再次输入新密码" type="password" minlength="12" maxlength="128" autocomplete="new-password" required>')}`;}
 function passwordForm(){if(!store.cloud)return blocked();showDialog(dialogHead('修改我的密码','修改后需要重新登录。')+`<form id="team-password-form"><div class="form-body password-fields"><p class="form-error" role="alert"></p>${passwordFields()}</div>${footer('修改密码')}</form>`);}
 function passwordRequiredPage(){return `<main class="login"><img src="./favicon.svg" width="40" height="40" alt="行情跳动"><h1>首次登录修改密码</h1><p>${e(store.member?.email)}<br>完成改密后即可访问工作台。</p><form id="team-password-form" class="password-fields"><p class="form-error" role="alert"></p>${passwordFields()}<button class="btn primary" type="submit">修改密码并重新登录</button></form><button class="text-btn" data-team="logout">退出登录</button></main>`;}
 function accountDialog(){showDialog(dialogHead('我的账户',store.member?.display_name||'')+`<div class="form-body"><div class="settings-row"><span>账号</span><span>${e(store.member?.email)}</span></div><div class="settings-row"><span>角色</span><strong>${e(roleNames[store.role])}</strong></div><p class="subtle permission-summary">${e(permissions(store.member))}</p>${store.cloud?'<button class="btn" data-team="change-password">修改我的密码</button>':`<h3 class="team-subtitle">本机权限体验</h3><div class="demo-role-switch">${[['admin','管理员'],['editor','仅录入员工'],['viewer','只读成员']].map(([role,label])=>`<button class="btn ${role===store.role?'primary':''}" data-team-demo="${role}">${label}</button>`).join('')}</div><p class="subtle">演示切换只影响当前浏览器，不创建真实员工账号。</p>`}</div><div class="dialog-foot">${store.cloud?'<button class="btn" data-team="logout">退出登录</button>':''}<button class="btn" data-action="close">关闭</button></div>`);}
 function requestForm(id){const q=data().quotes.find(q=>q.id===id);if(!canRequestDeletion(store.member,q))return toast('没有申请删除这条报价的权限');showDialog(dialogHead('申请删除报价',`${quoteName(q)} · ${q.supplier}`)+`<form id="team-delete-form" data-id="${e(id)}"><div class="form-body"><p class="form-error" role="alert"></p>${field('删除原因 <span>*</span>','<textarea name="reason" aria-label="删除原因" required minlength="4" maxlength="500" placeholder="例如：重复录入报价，请说明具体情况"></textarea>')}<p class="subtle">提交申请后报价继续保留；管理员批准后才移入回收站并退出均价统计。</p></div>${footer('提交删除申请')}</form>`);}
 function reviewForm(id){const r=data().deletionRequests.find(r=>r.id===id);if(!r||store.role!=='admin')return;const q=data().quotes.find(q=>q.id===r.quote_id)||r.quote_snapshot;showDialog(dialogHead('审批删除申请',quoteName(q))+`<form id="team-delete-review-form" data-id="${e(id)}"><div class="form-body"><p class="form-error" role="alert"></p><div class="settings-row"><span>供应商</span><strong>${e(q.supplier)}</strong></div><div class="settings-row"><span>申请人</span><span>${e(person(r.requested_by))}</span></div><div class="settings-row"><span>申请时 / 当前价格</span><span>¥ ${money(r.quote_snapshot?.price)} / ¥ ${money(q.price)}</span></div><p class="request-reason">${e(r.reason)}</p>${field('审批决定','<select name="decision" aria-label="审批决定"><option value="approved">批准删除，移入回收站</option><option value="rejected">驳回申请，保留报价</option></select>')}${field('审批说明','<textarea name="note" aria-label="审批说明" maxlength="500" placeholder="驳回时请填写至少 4 字原因"></textarea>')}</div>${footer('确认审批')}</form>`);}
 function restoreForm(id){showDialog(dialogHead('恢复报价','恢复后按原审核状态和有效期重新参与统计。')+`<form id="team-restore-form" data-id="${e(id)}"><div class="form-body"><p class="form-error" role="alert"></p>${field('恢复原因','<textarea name="reason" aria-label="恢复原因" required minlength="4" maxlength="500"></textarea>')}</div>${footer('恢复报价')}</form>`);}
 function handleClick(el){
  if(el.dataset.memberEdit){memberForm(el.dataset.memberEdit);return true;}
  if(el.dataset.memberReset){resetForm(el.dataset.memberReset);return true;}
  if(el.dataset.memberState){if(!store.cloud){blocked();return true;}execute(async()=>{const m=member(el.dataset.memberState);const result=await store.accountAction('set_active',{id:m.id,active:!m.active});ctx.setData(await store.reload());render();toast(result.message);},el);return true;}
  if(el.dataset.deleteRequest){requestForm(el.dataset.deleteRequest);return true;}
  if(el.dataset.deleteReview){reviewForm(el.dataset.deleteReview);return true;}
  if(el.dataset.restoreQuote){restoreForm(el.dataset.restoreQuote);return true;}
  if(el.dataset.teamDeleteFilter){ctx.state.deletionFilter=el.dataset.teamDeleteFilter;render();return true;}
  if(el.dataset.teamDemo){ctx.onDemoRole(el.dataset.teamDemo);return true;}
  if(el.dataset.team==='create'){memberForm();return true;}
  if(el.dataset.team==='change-password'){passwordForm();return true;}
  if(el.dataset.team==='logout'){execute(ctx.onLogout,el);return true;}
  return false;
 }
 function handleChange(el){
  if(el.name==='role'&&el.closest('#team-member-form'))for(const [key,value]of Object.entries(defaultPermissions(el.value))){const box=el.form.elements[key];box.checked=value;box.disabled=el.value!=='editor';}
 }
 async function submit(form,fields){
  if(!form.id.startsWith('team-'))return false;
  if(form.id==='team-member-form'){
    const id=form.dataset.id;const role=fields.role||member(id)?.role;
    const values={display_name:fields.display_name,role,...Object.fromEntries(Object.keys(permissionNames).map(key=>[key,fields[key]==='on']))};
    const password=fields.password;delete fields.password;form.querySelector('[name=password]')?.setAttribute('value','');
    const result=await store.accountAction(id?'update_member':'create',{...values,...id?{id}:{email:fields.email,password}});
    form.reset();ctx.setData(await store.reload());ctx.closeDialog();render();toast(result.message);
  }
  if(form.id==='team-reset-form'){const password=fields.password;fields.password='';form.reset();const result=await store.accountAction('reset_password',{id:form.dataset.id,password});ctx.setData(await store.reload());ctx.closeDialog();render();toast(result.message);}
  if(form.id==='team-password-form'){
    if(fields.password!==fields.confirmation)throw new Error('两次新密码不一致');
    const values={current_password:fields.current_password,password:fields.password};form.reset();fields.current_password='';fields.password='';fields.confirmation='';
    const result=await store.accountAction('change_password',values);await ctx.onLogout();toast(result.message);
  }
  if(form.id==='team-delete-form'){ctx.setData(await store.requestDeletion(form.dataset.id,fields.reason));ctx.closeDialog();render();toast('删除申请已提交，报价暂时保留');}
  if(form.id==='team-delete-review-form'){ctx.setData(await store.reviewDeletion(form.dataset.id,fields.decision,fields.note));ctx.closeDialog();render();toast(fields.decision==='approved'?'已批准删除，报价移入回收站':'申请已驳回，报价保留');}
  if(form.id==='team-restore-form'){ctx.setData(await store.restoreQuote(form.dataset.id,fields.reason));ctx.closeDialog();render();toast('报价已恢复');}
  return true;
 }
 return {staffPanel,deletionPanel,recyclePanel,auditPanel,accountDialog,passwordRequiredPage,handleClick,handleChange,submit};
}
