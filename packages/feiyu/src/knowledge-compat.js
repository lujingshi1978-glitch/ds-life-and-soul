const redirect = { alias: 'role-knowledge', redirect: '/api/knowledge', management: '#knowledge' };
const mappedStatus = value => value === 'confirmed' ? 'usable' : value;
const legacyStatus = value => ['usable','contested','outdated'].includes(value) ? 'confirmed' : value;
const fields = body => ({
  ...(body.content !== undefined ? { concept: body.content } : {}),
  ...(body.meaning !== undefined ? { understanding: body.meaning } : {}),
  ...(body.usage !== undefined || body.example !== undefined ? { contexts: [body.usage,body.example].filter(v=>v!==undefined&&v!=='') } : {}),
  ...(body.risk !== undefined ? { risks: body.risk ? [body.risk] : [] } : {}),
  ...(body.sources !== undefined ? { referenceUrls: body.sources } : {}),
  type: 'slang',
});
function legacyEntry(entry,{publicOnly=false}={}) {
  const value={id:entry.id,content:entry.concept,meaning:entry.understanding,usage:entry.contexts?.[0]||'',example:entry.contexts?.[1]||'',risk:entry.risks?.join('；')||'',status:legacyStatus(entry.status),source:'unified-knowledge',updatedAt:entry.updated?new Date(entry.updated).toISOString():'',revision:entry.revision};
  return publicOnly?{...value,usage:'',example:'',risk:''}:{...value,sources:entry.sources||[],scope:entry.scope};
}
function requireManager(knowledge) {
  if(typeof knowledge.manageKnowledge!=='function'){const e=new Error('角色认知已关闭，不能修改知识');e.code='KNOWLEDGE_DISABLED';e.statusCode=409;throw e;}
}
function queryValue(query,key) { return typeof query?.get==='function'?query.get(key):query?.[key]; }

// Authentication, role revision, contact authorization, tool flags and quotas stay with the bridge.
export function handleSlangCompatibility(knowledge,{method,path,query={},body={},scope='self'}={}) {
  if(path!=='/api/slang'&&!path?.startsWith('/api/slang/'))return null;
  const reply=(value,status=200)=>({status,body:{...redirect,...value}});
  try {
    if(method==='GET'&&path==='/api/slang'){
      const result=knowledge.list({q:queryValue(query,'q')||'',status:mappedStatus(queryValue(query,'status')||''),offset:queryValue(query,'offset'),limit:queryValue(query,'limit')});
      return reply({ok:true,...result,entries:result.entries.map(e=>legacyEntry(e)),writable:typeof knowledge.manageKnowledge==='function'});
    }
    if(['/api/slang/clear','/api/slang/batch-delete','/api/slang/extract','/api/slang/research','/api/slang/config'].includes(path))return reply({ok:false,error:'SLANG_OPERATION_RETIRED',message:'此操作已退役，请使用角色知识库；原始记忆与历史词库保留。'},410);
    if(!body||typeof body!=='object'||Array.isArray(body))return reply({ok:false,error:'KNOWLEDGE_INPUT_INVALID'},400);
    if(body.status!==undefined&&!['candidate','confirmed','rejected'].includes(body.status))return reply({ok:false,error:'KNOWLEDGE_STATUS_INVALID'},400);
    requireManager(knowledge);
    if(method==='POST'&&path==='/api/slang'){
      const entry=knowledge.manageKnowledge(body.status==='confirmed'?'confirm':'create',{input:fields(body),scope,actor:'console'});
      return reply({ok:true,entry:legacyEntry(entry),value:entry},201);
    }
    if(method==='POST'&&['/api/slang/batch-confirm','/api/slang/batch-reject'].includes(path)){
      if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>100||body.ids.some(id=>typeof id!=='string'))return reply({ok:false,error:'EXPLICIT_KNOWLEDGE_IDS_REQUIRED'},400);
      const action=path.endsWith('confirm')?'confirm':'reject',entries=[],skipped=[];
      for(const id of [...new Set(body.ids)])try{entries.push(knowledge.manageKnowledge(action,{id,scope,actor:'console'}));}catch(error){skipped.push({id,error:error.code||error.message});}
      return reply({ok:entries.length>0,entries:entries.map(e=>legacyEntry(e)),[action==='confirm'?'confirmedCount':'rejectedCount']:entries.length,skippedCount:skipped.length,skipped},entries.length?200:400);
    }
    const match=path.match(/^\/api\/slang\/([^/]+)(?:\/(confirm|reject))?$/);
    if(!match)return reply({ok:false,error:'SLANG_OPERATION_RETIRED'},410);
    const id=decodeURIComponent(match[1]);
    const action=method==='DELETE'&&!match[2]?'delete':method==='PATCH'&&!match[2]?(body.status==='confirmed'?'confirm':body.status==='rejected'?'reject':'update'):method==='POST'&&match[2]?match[2]:null;
    if(!action)return reply({ok:false,error:'METHOD_NOT_ALLOWED'},405);
    const entry=knowledge.manageKnowledge(action,{id,input:fields(body),scope,actor:'console',expectedRevision:body.expectedRevision});
    return reply({ok:true,entry:legacyEntry(entry),value:entry,softDeleted:action==='delete'});
  }catch(error){return reply({ok:false,error:error.code||'KNOWLEDGE_COMPAT_FAILED',message:error.message},error.statusCode||500);}
}

export function querySlangCompatibility(knowledge,{q='',limit=30}={}) {
  const cues=String(q).trim().toLowerCase(),count=Math.max(1,Math.min(80,Number(limit)||30)),entries=(cues?knowledge.match('self',cues,{limit:count}):knowledge.list({status:'usable',limit:count}).entries).filter(e=>e.scope==='self'&&e.status==='usable'&&(!cues||[e.concept,e.understanding,...(e.aliases||[])].some(v=>String(v).toLowerCase().includes(cues)))).map(e=>legacyEntry(e,{publicOnly:true}));
  return {ok:true,...redirect,total:entries.length,entries,block:''};
}

export function submitSlangCompatibility(knowledge,body,{scope,actor='agent'}={}) {
  requireManager(knowledge);
  if(actor!=='agent'||! /^(?:private|group):\d+$/.test(scope||'')){const e=new Error('会话未授权');e.code='CONTACT_NOT_AUTHORIZED';e.statusCode=403;throw e;}
  const content=typeof body.content==='string'?body.content.trim():'';
  if(!content||[...content].length>50){const e=new Error('词条需为1到50字');e.code='KNOWLEDGE_INPUT_INVALID';e.statusCode=400;throw e;}
  const existing=knowledge.entries().find(e=>e.concept===content&&(e.scope===scope||e.scope==='self'));
  if(existing?.status==='rejected'){const e=new Error('该知识已停用，请由管理员复核');e.code='KNOWLEDGE_REJECTED';e.statusCode=403;throw e;}
  if(existing)return {ok:true,...redirect,duplicate:true,status:legacyStatus(existing.status),entry:legacyEntry(existing,{publicOnly:true})};
  const entry=knowledge.manageKnowledge('create',{scope,actor,input:{concept:content,understanding:'',contexts:typeof body.context==='string'&&body.context.trim()?[body.context.trim().slice(0,200)]:[],type:'slang'}});
  return {ok:true,...redirect,duplicate:false,status:'candidate',entry:legacyEntry(entry,{publicOnly:true})};
}
