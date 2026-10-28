// Exercises the actual MCP server/schema against an isolated HTTP API. Nothing
// reads production credentials, calls a model, or sends a message to QQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {DIALOGUE_CONTRACT,dialogueContract,installDialogueLoop} from '../plugins/qq-agent-presets/qq-chat-loop.mjs';
import {publishDialogueContext} from '../plugins/qq-agent-presets/dialogue-context.mjs';
import {innerChatPolicy,affinityChatPolicy,affinityToolAllowed} from '../src/affinity-chat-policy.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('native dialogue contract follows host-selected budgets and preserves the original defaults',()=>{
 assert.match(DIALOGUE_CONTRACT,/最多1000字/);
 assert.match(dialogueContract({psycheChars:2000,psycheThreadChars:900}),/最多2000字[\s\S]*最多900字/);
 assert.throws(()=>dialogueContract({psycheChars:999999}),/trusted psyche budget/);
});

test('real MCP schema validates psyche deltas and forwards exact optimistic-lock and evidence fields',async()=>{
  const requests=[];
  const api=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):null;
    requests.push({url:req.url,body,token:req.headers['x-agent-token']});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify(req.method==='GET'?{ok:true,mind:{generation:23,psycheRevision:11,psychology:[{id:'psyche:old',revision:3,text:'还是有点不爽'}]}}:{ok:true,value:{accepted:body,generation:24}}));
  });
  await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(0,'127.0.0.1',resolve);});
  let fixture,client;
  try{
    fixture=await fs.mkdtemp(path.join(root,'.tmp-psyche-tool-test-'));
    await fs.mkdir(path.join(fixture,'src'));
    for(const name of ['mcp-snowluma-safe.js','mcp-host-server.js','qq-model-view.js','qq-link-share.js','media-conversation.js','sensitive.js'])await fs.copyFile(path.join(root,'src',name),path.join(fixture,'src',name));
    await fs.writeFile(path.join(fixture,'config.json'),JSON.stringify({consolePort:api.address().port}));
    const transport=new StdioClientTransport({command:process.execPath,args:[path.join(fixture,'src/mcp-snowluma-safe.js')],cwd:fixture,stderr:'pipe'});
    client=new Client({name:'psyche-tool-protocol-test',version:'1.0.0'});await client.connect(transport);
    const listed=await client.listTools(),tool=listed.tools.find(t=>t.name==='qq_update_mind_state');
    assert.ok(tool,'production MCP exposes the mind tool');
    const schema=tool.inputSchema.properties;
    assert.deepEqual(Object.keys(schema.psychology.properties).sort(),['add','merge','release','resolve','update']);
    assert.equal(schema.psychological.maxLength,12000);
    assert.equal(schema.psychology.properties.add.items.properties.text.maxLength,4000);
    assert.equal(listed.tools.find(t=>t.name==='qq_read_resource').inputSchema.properties.limit.maximum,60000);
    assert.ok(listed.tools.find(t=>t.name==='qq_memory_expand').inputSchema.properties.offset);
    assert.equal(schema.expectedMindGeneration.minimum,0);
    assert.equal(schema.expectedPsycheRevision.minimum,0);
    assert.equal(schema.psychology.properties.merge.items.properties.ids.minItems,2);
    assert.match(tool.description,/承接before/);assert.match(tool.description,/未变不加/);
    const common={key:'private:10001',token:'isolated-token',expectedVersion:42,expectedMindGeneration:23,expectedPsycheRevision:11};
    const preferenceSchema=schema.dispositions.items.properties.preference;
    assert.deepEqual(Object.keys(preferenceSchema.properties).sort(),['attraction','reservations','scope']);
    const preferenceOp={kind:'interest',target:'陶艺',facet:'材料顺势',preference:{attraction:'顺着材料找构思',reservations:'不为拍摄刻意破坏',scope:'只读文字，未实作'},reason:'实际读到的文字让我产生小范围好奇',memoryIds:['memory:read']};
    const preferenceResult=await client.callTool({name:'qq_update_mind_state',arguments:{...common,dispositions:[preferenceOp]}});assert.notEqual(preferenceResult.isError,true);assert.deepEqual(requests.at(-1).body.dispositions,[preferenceOp]);
    const delta={
      add:[{text:'这个话头还没放下',kind:'tension',importance:.7,intensity:.4,reason:'新来信让我重新想起',eventIds:['event:new']}],
      update:[{id:'psyche:old',expectedRevision:3,text:'气还没消 但愿意听听',reason:'对方作出具体解释',objectIds:['inner:concern'],memoryIds:['memory:old']}],
      merge:[{ids:['psyche:a','psyche:b'],expectedRevisions:[{id:'psyche:a',revision:1},{id:'psyche:b',revision:2}],text:'两段是同一份牵挂 也还存着矛盾',reason:'已有感受重复表达'}],
      resolve:[{id:'psyche:c',expectedRevision:2,reason:'误会已经由原始来信澄清'}],
      release:[{id:'psyche:d',expectedRevision:1,reason:'这件事确实不再挂心'}],
    };
    const args={...common,psychological:'还是有点不爽。那件好玩的事也想继续看看。',psychology:delta,psyche:{attention:[{focus:'想继续看看那段故事',objectId:'inner:concern'}],emotionalTensions:[{feeling:'嘴上嫌弃 也还有牵挂',objectIds:['inner:concern']}]},appraisal:{focus:'新的解释',emotions:{anger:.3,interest:.4}},valence:-.2,arousal:.35};
    const result=await client.callTool({name:'qq_update_mind_state',arguments:args});assert.notEqual(result.isError,true);
    assert.equal(requests.at(-1).url,'/api/socialV2/mind/state');assert.equal(requests.at(-1).token,common.token);
    const {token,...body}=args;assert.deepEqual(requests.at(-1).body,body,'the real handler preserves the complete delta and locks');
    assert.deepEqual(JSON.parse(result.content[0].text).accepted,body);
    await client.callTool({name:'qq_update_mind_state',arguments:{...common,mood:'没变'}});
    assert.equal(Object.hasOwn(requests.at(-1).body,'psychology'),false,'omission does not manufacture an add delta');
    const unicode={...common,psychological:'🙂'.repeat(999)+'。',mood:'🙂'.repeat(300),appraisal:{focus:'🙂'.repeat(100),trigger:'🙂'.repeat(100)},psychology:{add:[{text:'🙂'.repeat(600),kind:'🙂'.repeat(80),reason:'🙂'.repeat(300)}]},psyche:{attention:[{focus:'🙂'.repeat(160)}],emotionalTensions:[{feeling:'🙂'.repeat(160)}]},dispositions:[{kind:'interest',target:'🙂'.repeat(100),text:'🙂'.repeat(600),facet:'🙂'.repeat(80),reason:'🙂'.repeat(300)}]};
    const unicodeResult=await client.callTool({name:'qq_update_mind_state',arguments:unicode});
    assert.notEqual(unicodeResult.isError,true,'MCP accepts the same Unicode code-point bounds as cognition');
    assert.equal(requests.at(-1).body.psychological,unicode.psychological);assert.equal(requests.at(-1).body.psychology.add[0].text,unicode.psychology.add[0].text);
    for(const patch of [
      {psychological:'心'.repeat(12001)},
      {psychological:'🙂'.repeat(12001)},
      {psychology:{add:[{text:'🙂'.repeat(4001)}]}},
      {psyche:{attention:[{focus:'🙂'.repeat(161)}]}},
      {expectedMindGeneration:-1},
      {expectedPsycheRevision:1.5},
      {psychology:{update:[{id:'psyche:old',text:'改了但没有原因'}]}},
      {psychology:{merge:[{ids:['psyche:old'],text:'一个不叫合并',reason:'不充分'}]}},
      {psychology:{add:[{text:'新感觉',intensity:1.1}]}},
      {psychology:{unknown:[]}},
      {psyche:{attention:['不是约定的结构']}},
      {psyche:{attention:[{focus:'看看',action:'browse'}]}},
    ]){
      const before=requests.length,bad=await client.callTool({name:'qq_update_mind_state',arguments:{...common,...patch}});
      assert.equal(bad.isError,true,JSON.stringify(patch));assert.equal(requests.length,before,'invalid requests never reach the API');
    }
    const prompt=await client.callTool({name:'qq_get_prompt',arguments:{key:common.key,token:common.token}});
    const current=JSON.parse(prompt.content[0].text).mind;
    assert.equal(current.generation,23);assert.equal(current.psycheRevision,11);assert.equal(current.psychology[0].revision,3);
  }finally{
    await client?.close();await new Promise(resolve=>api.close(resolve));
    if(fixture){const resolved=path.resolve(fixture);assert.ok(resolved.startsWith(root+path.sep)&&path.basename(resolved).startsWith('.tmp-psyche-tool-test-'));await fs.rm(resolved,{recursive:true,force:true});}
  }
});

test('coherent V3 psyche survives Unicode and legacy effort limits and conflict refresh passes native guards',async()=>{
  const id='session-psyche-unicode',policy={...innerChatPolicy(),stateChars:80},release=publishDialogueContext({version:1,sessionId:id,key:'private:10001',reason:'private',context:'fixture',policy}),contexts=[],handlers=new Map();let guard;
  const psychological='旧的感受还在。'+'🙂'.repeat(550)+'我现在想安静一下。';
  const mind={implementation:'feiyu-cognition-v3',generation:24,psycheRevision:12,core:'fixture',state:{version:43,psychological}};
  const ctx={effect:f=>f(),on:(name,fn)=>handlers.set(name,fn),tools:{guard:f=>{guard=f;}},systemPrompt:{section:()=>()=>{},context:c=>{contexts.push(c);return()=>{};}}};
  try{
    installDialogueLoop(ctx,{readMind:()=>mind,secret:()=>'',persist:()=>{}});
    const content=contexts.find(c=>c.name==='qq-mind-state').text({agent:{id}}),current=JSON.parse(content.slice(content.indexOf('\n')+1));
    assert.ok([...psychological].length<1000&&psychological.length>1000);
    assert.equal(current.psychological,psychological,'a valid complete projection ignores retired tier budgets and preserves its final feeling');
    assert.equal(current.psychological.endsWith('我现在想安静一下。'),true);
    const assembly=await handlers.get('system-prompt/assemble')({}, {agent:{id}},async()=>({contexts:[{name:'qq-mind-state'}],tools:[{name:'mcp__snowluma__qq_get_prompt'},{name:'mcp__snowluma__qq_update_mind_state'},{name:'not-authorized'}]}));
    assert.deepEqual(assembly.tools.map(t=>t.name),['mcp__snowluma__qq_get_prompt','mcp__snowluma__qq_update_mind_state']);
    assert.equal(guard({agent:{id},name:'mcp__snowluma__qq_get_prompt'}),undefined,'a stale write can actually fetch fresh versions');
    assert.match(guard({agent:{id},name:'not-authorized'}),/未开放/);
    for(const p of [innerChatPolicy(),affinityChatPolicy(0),affinityChatPolicy(50),affinityChatPolicy(100)])assert.equal(affinityToolAllowed('mcp__snowluma__qq_get_prompt',p),true);
  }finally{release();}
});

test('native dialogue prompt binds current psyche references to the same atomic mirror snapshot',()=>{
  const id='session-psyche-protocol',release=publishDialogueContext({version:1,sessionId:id,key:'private:10001',reason:'private',context:'fixture'}),contexts=[];
  const mind={generation:23,psycheRevision:11,core:'fixture core',state:{version:42,psychological:'统一的当前内心',valence:.1,arousal:.3,energy:.5},psychology:[{id:'psyche:old',revision:3,text:'留在背景的旧矛盾',status:'quiet'}],psyche:{attention:[{focus:'眼前这个话头'}],emotionalTensions:[{feeling:'还没完全消气'}]}};
  const ctx={effect:f=>f(),on:()=>{},systemPrompt:{section:()=>()=>{},context:c=>{contexts.push(c);return()=>{};}}};
  try{
    installDialogueLoop(ctx,{secret:()=>'',persist:()=>{},readMind:()=>mind});
    const content=contexts.find(c=>c.name==='qq-mind-state').text({agent:{id}}),state=JSON.parse(content.slice(content.indexOf('\n')+1));
    assert.equal(state.psychological,'统一的当前内心');assert.equal(state.generation,23);assert.equal(state.psycheRevision,11);
    assert.deepEqual(state.psychology,mind.psychology);assert.deepEqual(state.psyche,mind.psyche);
    assert.equal(state.psychological.includes('留在背景'),false,'background prose is not spliced into the current mind');
    assert.match(DIALOGUE_CONTRACT,/元唤醒/);assert.match(DIALOGUE_CONTRACT,/未变不加/);assert.match(DIALOGUE_CONTRACT,/暂时不关注不等于解决/);assert.match(DIALOGUE_CONTRACT,/冲突先读取qq_get_prompt/);
  }finally{release();}
});
