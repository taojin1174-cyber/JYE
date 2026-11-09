const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const permissionFields = ['can_create_quotes','can_edit_quotes','can_review_quotes','can_request_deletion'];
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new HttpError(status,message);};
function checkPassword(value) {
  if(typeof value!=='string'||value.length<12||value.length>128)fail(400,'密码长度须为 12–128 个字符');
  return value;
}
function memberFields(input) {
  if(!['admin','editor','viewer'].includes(input.role))fail(400,'请选择有效角色');
  const display_name=String(input.display_name||'').trim();
  if(!display_name||display_name.length>60)fail(400,'姓名须为 1–60 个字符');
  const fields={display_name,role:input.role};
  for(const field of permissionFields)fields[field]=input.role==='admin'||(input.role==='editor'&&input[field]===true);
  return fields;
}

// 在服务端验证真实登录用户及数据库授权；从不信任客户端提交的角色、操作者或密钥。
export function createAccountHandler({url,serviceKey,allowedOrigins=['https://bbroot01.bbroot.com'],fetchImpl=fetch,now=()=>Date.now()}) {
  return async function handler(request) {
    const origin=request.headers.get('origin');
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Vary:'Origin'};
    if(origin&&allowedOrigins.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
    const reply=(status,body)=>new Response(body===null?null:JSON.stringify(body),{status,headers});
    try {
      if(origin&&!allowedOrigins.includes(origin))fail(403,'此来源不允许访问账号服务');
      if(request.method==='OPTIONS')return reply(204,null);
      if(request.method!=='POST')fail(405,'仅支持 POST 请求');
      if(!url||!serviceKey)fail(503,'账号服务尚未配置');
      const bearer=request.headers.get('authorization');
      if(!/^Bearer [^\s]+$/i.test(bearer||''))fail(401,'请先登录');
      const token=bearer.slice(7);
      async function api(path,{method='GET',body,auth=serviceKey}={}) {
        const response=await fetchImpl(url.replace(/\/$/,'')+path,{method,headers:{apikey:serviceKey,Authorization:`Bearer ${auth}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
        let value;try{value=await response.json();}catch{value=null;}
        if(!response.ok){
          if(response.status===401||response.status===403)fail(401,'登录已失效或操作未获授权');
          if(value?.code==='P0001')fail(400,value.message);
          if(response.status===422||response.status===400)fail(400,'账号信息或密码不符合要求，请检查是否已存在及密码强度');
          fail(502,'账号服务处理失败，请稍后重试');
        }
        return value;
      }
      const user=await api('/auth/v1/user',{auth:token});
      if(!uuid.test(user?.id||''))fail(401,'登录信息无效');
      const members=await api(`/rest/v1/members?id=eq.${user.id}&select=*`);
      const actor=members?.[0];
      if(!actor?.active)fail(403,'账号未获授权或已停用');
      let claims;try{claims=JSON.parse(atob(token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));}catch{fail(401,'登录信息无效');}
      if(claims.sub!==user.id||!Number.isFinite(claims.iat))fail(401,'登录信息无效');
      const text=await request.text();if(text.length>16384)fail(413,'提交内容过长');
      let input;try{input=JSON.parse(text);}catch{fail(400,'提交格式不正确');}
      const action=input.action;
      if(action!=='change_password'&&(actor.must_change_password||claims.iat*1000<Date.parse(actor.auth_valid_after)))fail(401,'账号安全信息已更新，请重新登录并修改初始密码');
      if(action!=='change_password'&&actor.role!=='admin')fail(403,'只有管理员可以管理员工账号');
      const cutoff=()=>new Date(Math.ceil(now()/1000)*1000).toISOString();
      const audit=(action,target_id,details={})=>api('/rest/v1/management_audit',{method:'POST',body:{actor:user.id,action,target_id,details}});
      async function target() {
        if(!uuid.test(input.id||''))fail(400,'账号编号无效');
        const result=await api(`/rest/v1/members?id=eq.${input.id}&select=*`);
        if(!result?.[0])fail(404,'员工账号不存在');
        return result[0];
      }
      async function updateMember(id,fields) {
        return api(`/rest/v1/members?id=eq.${id}`,{method:'PATCH',body:{...fields,updated_by:user.id}});
      }
      if(action==='create') {
        const email=String(input.email||'').trim().toLowerCase();
        if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail(400,'请输入有效的员工邮箱账号');
        const fields=memberFields(input);const password=checkPassword(input.password);
        const created=await api('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true,user_metadata:{display_name:fields.display_name}}});
        if(!uuid.test(created?.id||''))fail(502,'账号创建响应无效');
        try {
          await api('/rest/v1/members',{method:'POST',body:{id:created.id,email,...fields,active:true,must_change_password:true,updated_by:user.id}});
        }catch(error){
          try{await api(`/auth/v1/admin/users/${created.id}`,{method:'DELETE'});}catch{fail(502,'登录账号已创建，但业务授权未完成，请联系项目管理员检查');}
          throw error;
        }
        return reply(200,{ok:true,id:created.id,message:'员工账号已创建，首次登录须修改密码'});
      }
      if(action==='update_member') {
        const member=await target();const fields=memberFields(input);
        if(member.id===user.id&&fields.role!==actor.role)fail(400,'不能修改自己的角色');
        await updateMember(member.id,fields);
        return reply(200,{ok:true,message:'姓名与权限已更新'});
      }
      if(action==='set_active') {
        const member=await target();if(typeof input.active!=='boolean')fail(400,'账号状态无效');
        if(member.id===user.id&&!input.active)fail(400,'不能停用自己的账号');
        if(input.active){
          await api(`/auth/v1/admin/users/${member.id}`,{method:'PUT',body:{ban_duration:'none'}});
          await updateMember(member.id,{active:true});
        }else{
          await updateMember(member.id,{active:false});
          try{await api(`/auth/v1/admin/users/${member.id}`,{method:'PUT',body:{ban_duration:'876000h'}});}
          catch{return reply(200,{ok:true,message:'数据访问已停用；登录停用同步失败，可再次点击停用重试'});}
        }
        return reply(200,{ok:true,message:input.active?'员工账号已启用':'员工账号已停用'});
      }
      if(action==='reset_password') {
        const member=await target();if(member.id===user.id)fail(400,'请在我的账户中修改自己的密码');
        const password=checkPassword(input.password);
        await updateMember(member.id,{must_change_password:true,auth_valid_after:cutoff()});
        await api(`/auth/v1/admin/users/${member.id}`,{method:'PUT',body:{password}});
        await audit('password_reset',member.id,{must_change_password:true});
        return reply(200,{ok:true,message:'密码已重置，员工下次登录须修改密码'});
      }
      if(action==='change_password') {
        const password=checkPassword(input.password);
        if(typeof input.current_password!=='string'||!input.current_password)fail(400,'请输入当前密码');
        if(password===input.current_password)fail(400,'新密码须与当前密码不同');
        // 再验证当前密码，旧会话不能绕过管理员重置直接设置新密码。
        const verified=await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email:actor.email,password:input.current_password}});
        if(verified?.user?.id!==user.id||!verified.access_token)fail(401,'当前密码验证失败');
        await api('/auth/v1/user',{method:'PUT',auth:verified.access_token,body:{password}});
        await updateMember(user.id,{must_change_password:false,auth_valid_after:cutoff()});
        await audit('password_changed',user.id);
        return reply(200,{ok:true,requires_relogin:true,message:'密码已修改，请使用新密码重新登录'});
      }
      fail(400,'不支持的账号操作');
    }catch(error){return reply(error instanceof HttpError?error.status:502,{error:error instanceof HttpError?error.message:'账号服务暂时不可用，请稍后重试'});}
  };
}
