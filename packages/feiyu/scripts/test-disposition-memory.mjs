import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync,backup} from 'node:sqlite';
import {CharacterCognition} from '../src/cognition/service.js';import {createConversationStageSystem as createIntimacySystem,conversationBatchLimit as intimacyBatchLimit} from '../src/conversation-stage.js';import {innerChatPolicy,affinityToolAllowed} from '../src/affinity-chat-policy.js';import {retireRelationshipRules,retireSocialControls} from '../src/cognition/relationship-rules.js';
import {LiveCognition} from '../src/cognition/live.js';import {ContactStore} from '../src/contact-store.js';
import {DIALOGUE_DISPOSITION_HINT,DIALOGUE_DISPOSITION_MAX_CHARS} from '../src/cognition/dispositions.js';
const receipt={disposed:true,transcriptPersisted:false};
function fixture(t,{before}={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-dispositions-'));const r=new CharacterCognition({root,characterId:'character:disposition-test',embedding:null,now:()=>Date.parse('2026-10-25T10:00:00+08:00')});r.policy.seed({identity:{text:'我想慢慢认识世界，保留自己的判断。'}});before?.(r);r.enableInner();t.after(async()=>{await r.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});return r;}
function event(r,id,text,person='qq:100001'){return r.observe({adapter:'test-chat',externalId:id,kind:'chat',text,metadata:{speakerId:person,conversationPeerId:person,scope:person.replace('qq:','private:')}},{kind:'message-received',eventRoot:id});}
function apply(r,e,ops,key){return r.inner.apply({summary:'我有自己的感受，旧想法仍在。',changes:[],dispositions:ops},{expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],key});}
const thought=(text,more={})=>({kind:'attitude',target:'qq:100001',facet:'相处',text,reason:'这次真实交谈使我有了这个感受',...more});

test('dialogue projection preserves mixed feelings and old intentions as data without modifying storage or the full view',t=>{
 const r=fixture(t),a=event(r,'dialogue-a','我认真听，也知道你还介意那个玩笑');
 const text='我仍信任他，也还介意那个玩笑；下回他继续逗，我可能接两句损，也可能不回应。';
 apply(r,a,[thought(text)],'dialogue-attitude');
 const b=event(r,'dialogue-b','我愿意慢慢聊','qq:100002');
 apply(r,b,[thought('我愿意慢慢聊，但不想被催。',{target:'qq:100002'})],'other-attitude');
 const c=event(r,'dialogue-c','我看见他把田慢慢补好了');apply(r,c,[{kind:'interest',target:'慢慢种地的视频',text:'我喜欢看他把田补好，想再看一点。',facet:'兴趣',reason:'这次看到的细节让我喜欢'}],'dialogue-interest');
 const legacy=r.dispositions.context('qq:100001'),head=r.inner.head().generation;
 const changes=()=>[r.store.db.prepare('SELECT total_changes() n').get().n,r.archive.db.prepare('SELECT total_changes() n').get().n];
 const before=changes(),projection=r.dispositions.dialogueContext('qq:100001');
 assert.equal(projection.attitudes.length,1);assert.equal(projection.attitudes[0].text,text);
 assert.equal(projection.attitudes[0].target,'qq:100001');assert.equal(projection.attitudes[0].subjectId,r.characterId);
 assert.equal(projection.attitudes[0].revision,legacy.attitudes[0].revision);assert.equal(projection.attitudes[0].at,legacy.attitudes[0].at);
 assert.equal(projection.attitudes[0].interpretation,'subjective-memory-not-current-behavior-rule');
 assert.ok(projection.attitudes[0].evidenceCount>0);assert.equal(projection.attitudes[0].evidence,undefined);
 assert.ok(!JSON.stringify(projection).includes('100002'));assert.equal(projection.interests.length,0);assert.equal(r.dispositions.context('qq:100001').interests.length,1);
 assert.deepEqual(changes(),before);assert.equal(r.inner.head().generation,head);
 assert.deepEqual(r.dispositions.context('qq:100001'),legacy);
 assert.match(DIALOGUE_DISPOSITION_HINT,/本轮说话规则/);assert.match(DIALOGUE_DISPOSITION_HINT,/边界和拒绝权/);
});

test('dialogue projection has a whole-object budget, Unicode-safe excerpts and visible omission counts',t=>{
 const r=fixture(t),fullText='我'+'🙂'.repeat(599),reason='原因'.repeat(150);
 for(let n=0;n<8;n++){const a=event(r,'dialogue-budget-attitude-'+n,'我愿意聊具体经历'+n);apply(r,a,[thought(fullText,{facet:'相处'+n,reason})],'budget-attitude-'+n);}
 for(let n=0;n<10;n++){const a=event(r,'dialogue-budget-interest-'+n,'看了新的主题'+n);apply(r,a,[{kind:'interest',target:'主题'+n,text:fullText,facet:'兴趣'+n,reason}],'budget-interest-'+n);}
 const before=r.dispositions.rows({limit:2000}).map(m=>({id:m.id,gist:m.gist,revision:m.revision}));
 const projection=r.dispositions.dialogueContext('qq:100001'),all=[...projection.attitudes,...projection.interests,...projection.pendingReinterpretations];
 assert.ok(JSON.stringify(projection).length<=DIALOGUE_DISPOSITION_MAX_CHARS);
 assert.ok(projection.attitudes.length>0);assert.equal(projection.interests.length,0);
 assert.equal(projection.attitudes.length+projection.omitted.attitudes,8);assert.equal(projection.omitted.interests,0);assert.equal(r.dispositions.context().interests.length,10);
 assert.ok(projection.omitted.attitudes+projection.omitted.interests>0);
 for(const item of all){assert.equal([...item.text].length,300);assert.equal(item.partial,true);assert.equal([...item.reason].length,100);assert.equal(item.reasonPartial,true);assert.equal(Buffer.from(item.text,'utf8').toString('utf8'),item.text);}
 assert.deepEqual(r.dispositions.rows({limit:2000}).map(m=>({id:m.id,gist:m.gist,revision:m.revision})),before);
});

test('dialogue projection without a current peer cannot expose another friend attitude and new characters remain empty',t=>{
 const r=fixture(t);assert.deepEqual(r.dispositions.dialogueContext('qq:100001').attitudes,[]);
 const a=event(r,'dialogue-peer','我认真听你说');apply(r,a,[thought('我信任他，也可能拒绝继续这个话题。')],'dialogue-peer');
 const missing=r.dispositions.dialogueContext(null),other=r.dispositions.dialogueContext('qq:100002');
 assert.equal(missing.currentPeer,null);assert.deepEqual(missing.attitudes,[]);assert.deepEqual(missing.pendingReinterpretations,[]);
 assert.ok(!JSON.stringify(missing).includes('100001'));assert.deepEqual(other.attitudes,[]);
 assert.equal(r.dispositions.context('qq:100001').attitudes.length,1);
});

test('dialogue projection marks pending reinterpretation without erasing the former feeling or promoting it to a reply rule',t=>{
 const r=fixture(t),a=event(r,'dialogue-corrected','那句话是我说的'),text='我那时有点介意，下回可能不想接这类玩笑。';
 apply(r,a,[thought(text)],'dialogue-corrected');const old=r.dispositions.rows()[0];
 event(r,'dialogue-corrected','其实那句是转述，之前没有说清楚');
 const projection=r.dispositions.dialogueContext('qq:100001'),pending=projection.pendingReinterpretations.find(m=>m.id===old.id);
 assert.ok(pending);assert.equal(pending.text,text);assert.equal(pending.revision,old.revision);
 assert.equal(pending.status,'candidate');assert.equal(pending.needsReinterpretation,true);
 assert.equal(pending.interpretation,'subjective-memory-not-current-behavior-rule');
 assert.equal(r.store.get(old.id,{includeInactive:true}).gist,text);
 assert.equal(r.dispositions.context('qq:100001').pendingReinterpretations[0].text,text);
});

test('mixed attitudes coexist with explicit subject, graph and recall provenance, without a score',async t=>{const r=fixture(t),a=event(r,'a','你那次说的话我认真听了');apply(r,a,[thought('我信任他认真听我说话。')],'trust');const old=r.dispositions.rows()[0],b=event(r,'b','刚才拿你在意的事开玩笑了');apply(r,b,[thought('我还是信任他，但这次玩笑让我生气，暂时不想接话。',{transition:'coexist',previousId:old.id,expectedRevision:old.revision})],'anger');assert.equal(r.dispositions.rows().length,2);assert.ok(r.store.edges(old.id).some(e=>e.relation==='contradicts'));const found=await r.retriever.recall('信任 生气 玩笑',{budgetChars:3000});assert.equal(found.items.length,2);assert.ok(found.chars<=2200);assert.ok(JSON.stringify(found.items).length<=2200);assert.equal(found.bundles[0].conflict,true);assert.ok(found.items.some(m=>m.id===old.id));assert.ok(found.items.every(m=>m.disposition&&m.subjectId===r.characterId&&!m.assertion));assert.equal(r.policy.relationship('qq:100001').affinity,undefined);assert.throws(()=>r.policy.setAffinity('qq:100001',99),{code:'RELATIONSHIP_SCORING_RETIRED'});});

test('continuation preserves the old memory and original archive, and enforces target and version',t=>{const r=fixture(t),a=event(r,'a','我当时没顾上你的感受');apply(r,a,[thought('我现在有点介意。')],'one');const old=r.dispositions.rows()[0],b=event(r,'b','对不起，下次我会先问你');assert.throws(()=>apply(r,b,[thought('缓和了',{transition:'continue',previousId:old.id,expectedRevision:9})],'bad'),{code:'DISPOSITION_VERSION_CONFLICT'});apply(r,b,[thought('那点介意还在，但他认真道歉让我愿意再聊。',{transition:'continue',previousId:old.id,expectedRevision:old.revision})],'two');assert.equal(r.store.get(old.id).status,'outdated');assert.equal(r.store.get(old.id).gist,old.gist);assert.equal(r.archive.get(a.sourceId,a.revision).text,'我当时没顾上你的感受');assert.equal(r.dispositions.rows().length,1);assert.equal(r.dispositions.rows({includePast:true}).length,2);});

test('late invalid action rolls back disposition writes, head and retirement together',t=>{const r=fixture(t),a=event(r,'a','你好'),head=r.inner.head().generation;assert.throws(()=>r.inner.apply({summary:'新的想法',dispositions:[thought('我愿意听他说话')],decision:{kind:'invented'}},{expectedGeneration:head,eventIds:[a.eventId],key:'invalid'}),{code:'V3_INVALID_DECISION'});assert.equal(r.dispositions.rows().length,0);assert.equal(r.inner.head().generation,head);});

test('a person absent from evidence cannot become the target, and numeric controls are rejected',t=>{const r=fixture(t),a=event(r,'a','你好');assert.throws(()=>apply(r,a,[thought('讨厌他',{target:'qq:999999'})],'wrong-person'),{code:'V3_PERSON_NOT_IN_EVIDENCE'});assert.throws(()=>apply(r,a,[thought('喜欢',{score:90})],'score'),{code:'INVALID_DISPOSITION'});});

test('interest is a subjective memory; repeated observations and elapsed time cannot promote or erase it',t=>{const r=fixture(t),a=event(r,'a','我看了一个笨拙但认真种地的方块人');apply(r,a,[{kind:'interest',target:'认真做事的笨拙角色',text:'我喜欢他笨归笨，还会把炸掉的田补回去。',facet:'为什么想继续看',reason:'这次看视频时明确觉得顺眼'}],'interest');const old=r.dispositions.rows()[0];for(let n=0;n<7;n++)assert.throws(()=>r.policy.maintainInterest({name:'认真做事的笨拙角色',evidence:[old.id]}),{code:'DISPOSITION_MODEL_REQUIRED'});r.policy.decayInterests();assert.equal(r.dispositions.rows()[0].gist,old.gist);assert.equal(r.policy.interests()[0].level,undefined);});

test('source correction invalidates only dependent attitudes; forgetting does not erase the original archive',t=>{const r=fixture(t),a=event(r,'a','我说过那个玩笑'),b=event(r,'b','我认真听你说话','qq:100002');apply(r,a,[thought('我有点介意那个玩笑')],'a');apply(r,b,[thought('我信任他听我说话',{target:'qq:100002'})],'b');const mine=r.dispositions.rows().find(m=>m.metadata.disposition.target==='qq:100001');r.archive.erase(a.sourceId);assert.ok(!r.dispositions.rows().some(m=>m.id===mine.id));assert.equal(r.dispositions.rows({person:'qq:100002'}).length,1);});

test('legacy scores remain archived, explicit preferences and written relationship notes survive without invented liking',t=>{const r=fixture(t,{before:r=>{r.policy.setAffinity('qq:100001',99);r.store.atomic('fixture',()=>{r.store.setProjection('relationship','qq:100001',{affinity:99,notes:['他认真听我说话，我觉得安心。']});r.store.setProjection('interests','self',{items:[{name:'大白饭',anchored:true,level:'无法离开',note:'这是原有设定'},{name:'和 qq:100001 聊天',socialPeer:'qq:100001',level:'喜欢'}]});return {affected:[]};});}});assert.ok(r.dispositions.rows({kind:'interest'}).some(m=>m.gist.includes('大白饭')));assert.ok(r.dispositions.rows({kind:'attitude'}).some(m=>m.gist.includes('认真听我说话')));assert.ok(!r.dispositions.rows({kind:'interest'}).some(m=>m.gist.includes('100001')));assert.equal(r.store.projection('relationship','qq:100001'),null);assert.equal(r.store.projection('interests'),null);assert.ok(r.store.db.prepare('SELECT count(*) n FROM v3_retired_controls').get().n>=2);const n=r.dispositions.rows().length;r.dispositions.migrate();assert.equal(r.dispositions.rows().length,n);});

test('score-free stages close once, recover a pending close, and never invoke a scoring model',async()=>{const conversations=new Map([['private:1',{}]]);let saved=0,closed=0,fail=true;const sys=createIntimacySystem({conversations:()=>conversations,settings:()=>({contextual:true,enabled:false}),initialScore:()=>{throw Error('No score initialization')},persist:()=>saved++,judge:()=>{throw Error('No scoring')},onStageClosed:()=>{closed++;if(fail)throw Error('interrupted stage close');}}),st=conversations.get('private:1');sys.record('private:1',st,'user','你好',Date.now()-700000,'1');await assert.rejects(sys.evaluate('private:1',true),/interrupted/);assert.ok(st.conversationStagePending);assert.equal(st.intimacy,undefined);fail=false;assert.equal((await sys.evaluate('private:1',true)).scoring,false);assert.equal(st.conversationStagePending,undefined);assert.equal((await sys.evaluate('private:1',true)).skipped,true);assert.equal(sys.ensure('private:1',st).score,undefined);assert.equal(saved,2);assert.equal(closed,2);});

test('old scored stages retain messages while retiring social controls and preserving refusal boundaries',t=>{const r=fixture(t),states=new Map([['private:100001',{intimacy:{score:99,stage:{id:'old',messages:[{role:'user',text:'还没整理'}]}},relationship:{score:99,paused:true,snoozeUntil:999}}]]);retireSocialControls(r,states);const st=states.values().next().value;assert.equal(st.intimacy,undefined);assert.equal(st.conversationStage.messages[0].text,'还没整理');assert.deepEqual(st.relationship,{paused:true,snoozeUntil:999});});

test('tools and transport limits are independent of score and energy; cleaned core has no retired policy',()=>{const a=innerChatPolicy('你好'),b=innerChatPolicy('你好');assert.deepEqual(a,b);assert.equal(a.score,undefined);for(const tool of ['qq_recall','qq_read_webpage','qq_read_file','qq_social_action','qq_learning_status'])assert.equal(affinityToolAllowed(tool,a),true,tool);assert.equal(intimacyBatchLimit({mind:{version:3},send:{burstMaxMessages:8}},'private:1',0,.05),null);assert.equal(intimacyBatchLimit({mind:{version:3},send:{burstMaxMessages:8}},'private:1',100,1),null);const cleaned=retireRelationshipRules('亲密度和精力影响愿意投入多少、回复长短与主动联系，但不改变账号权限。');assert.ok(!cleaned.includes('亲密度'));assert.match(cleaned,/自己决定/);});

test('synthetic V2 backup migration preserves every original memory and archive row through reopen', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-disposition-migration-'));
  const characterId = 'character:synthetic-migration';
  const source = new CharacterCognition({ root: path.join(root, 'source'), characterId, embedding: null });
  let r;
  t.after(async () => { await source.close(); await r?.close(); assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  source.policy.seed({ identity: { text: '合成角色保留自己的判断。' } });
  const memories = [];
  for (const [index, feeling] of ['我仍信任对方认真听我说话。', '那次玩笑让我介意，但不抹掉信任。'].entries()) {
    const event = source.observe({ adapter: 'synthetic-migration-fixture', externalId: 'event-' + index, kind: 'chat', text: feeling, metadata: { speakerId: 'qq:100001', conversationPeerId: 'qq:100001', scope: 'private:100001' } }, { kind: 'message-received', eventRoot: 'synthetic-migration-' + index });
    memories.push(source.store.addNodes([{ kind: 'episode', gist: feeling, evidence: [{ sourceId: event.sourceId, revision: event.revision }], participants: [{ entityId: 'qq:100001', role: 'speaker' }] }]).ids[0]);
  }
  source.policy.setAffinity('qq:100001', 90, { evidence: memories });
  source.store.setProjection('relationship', 'qq:100001', { affinity: 90, notes: ['我仍信任对方认真听我说话。', '那次玩笑让我介意，但不抹掉信任。'] }, { dependencies: memories });
  source.policy.maintainInterest({ name: '合成兴趣：认真种地', anchored: true, evidence: memories, note: '来自合成夹具的明确偏好' });
  const restoreRoot = path.join(root, 'restored');
  const destination = path.join(restoreRoot, 'characters', path.basename(source.dir));
  fs.mkdirSync(destination, { recursive: true });
  await backup(source.store.db, path.join(destination, 'cognition-v2.sqlite'));
  await backup(source.archive.db, path.join(destination, 'archive-v2.sqlite'));
  await source.close();
  r = new CharacterCognition({ root: restoreRoot, characterId, embedding: null });
  const originals = r.archive.db.prepare('SELECT * FROM documents ORDER BY source_id,revision').all().map(row => JSON.stringify(row));
  const ids = r.store.db.prepare('SELECT memory_id FROM memory_nodes').all().map(row => row.memory_id);
  assert.ok(originals.length >= 2); assert.equal(ids.length, 2);
  r.enableInner();
  for (const id of ids) assert.ok(r.store.db.prepare('SELECT 1 FROM memory_nodes WHERE memory_id=?').get(id));
  const digest = value => createHash('sha256').update(value).digest('hex');
  const beforeHashes = new Map(originals.map(value => { const row = JSON.parse(value); return [row.source_id + '@' + row.revision, digest(value)]; }));
  const afterDocuments = r.archive.db.prepare('SELECT * FROM documents ORDER BY source_id,revision').all();
  const afterById = new Map(afterDocuments.map(row => [row.source_id + '@' + row.revision, row]));
  for (const [id, checksum] of beforeHashes) assert.equal(digest(JSON.stringify(afterById.get(id))), checksum, 'synthetic source archive changed: ' + id);
  for (const row of afterDocuments) if (!beforeHashes.has(row.source_id + '@' + row.revision)) assert.ok(['inner-config', 'disposition-migration'].includes(row.adapter));
  const attitudes = r.dispositions.rows({ kind: 'attitude', person: 'qq:100001', includePending: true });
  assert.equal(attitudes.length, 2); assert.ok(attitudes.some(value => value.gist.includes('信任'))); assert.ok(attitudes.some(value => value.gist.includes('介意')));
  const count = r.dispositions.rows({ limit: 2000 }).length, generation = r.inner.head().generation;
  await r.close(); r = new CharacterCognition({ root: restoreRoot, characterId, embedding: null }); r.enableInner();
  assert.equal(r.dispositions.rows({ limit: 2000 }).length, count); assert.equal(r.inner.head().generation, generation);
});

test('foreground state tool writes retrievable attitude memories, returns IDs, and rejects invalid input before any write',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-live-disposition-')),legacy=path.join(root,'legacy');fs.mkdirSync(legacy);const contacts=new ContactStore(path.join(legacy,'contacts.sqlite')),owner=new LiveCognition({root:path.join(root,'v3'),profile:{id:'test',name:'测试角色',dir:legacy},contacts,core:'我有自己的判断。',innerVersion:3,think:async()=>({data:{summary:'不强行变化',changes:[]},receipt})});t.after(async()=>{await owner.close();contacts.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});contacts.record('private:100001',{role:'user',text:'我在认真听你说',messageId:'live',at:Date.now()});owner.beginBehavior('chat','chat','private:100001');const before=owner.store.state(),db=owner.runtime.store.db,count=()=>db.prepare('SELECT count(*) n FROM cognitive_events').get().n,n=count();assert.throws(()=>owner.store.updateState({expectedVersion:before.version,psychological:'无效的新感受',appraisal:{emotions:{anger:2}}},'private:100001'),/INVALID_APPRAISAL/);assert.equal(count(),n);assert.equal(owner.store.state().version,before.version);assert.throws(()=>owner.store.updateState({expectedVersion:before.version,dispositions:[thought('捏造别人的关系',{target:'qq:999999'})]},'private:100001'),{code:'V3_PERSON_NOT_IN_EVIDENCE'});assert.equal(count(),n);const result=owner.store.updateState({expectedVersion:before.version,psychological:'认真听我说这点，我记着。',dispositions:[thought('我愿意把想法讲给他听。')]},'private:100001');assert.equal(result.dispositionChanges.length,1);assert.ok(result.dispositionChanges[0].evidenceCount>0);const recalled=await owner.recall('private:100001',{cues:'愿意 想法 讲给他听',budgetChars:3000});assert.ok(recalled.items.some(m=>m.id===result.dispositionChanges[0].id&&m.disposition));owner.endBehavior('chat');});

test('forgetting a subjective attitude preserves its external evidence and independently known facts',t=>{const r=fixture(t),a=event(r,'a','我喜欢种地');const fact=r.store.addNodes([{kind:'episode',gist:'对方说喜欢种地',evidence:[{sourceId:a.sourceId,revision:a.revision,span:{offset:0,length:6}}],participants:[{entityId:'qq:100001',role:'speaker'}]}]).ids[0];apply(r,a,[thought('他认真种地这点，我有点喜欢。')],'feeling');const mine=r.dispositions.rows()[0];r.lifecycle.forget(mine.id,mine.revision);assert.equal(r.dispositions.rows().length,0);assert.ok(r.store.get(fact));assert.equal(r.archive.get(a.sourceId,a.revision).text,'我喜欢种地');assert.equal(r.store.db.prepare('SELECT count(*) n FROM v3_forget_spans WHERE memory_id=?').get(mine.id).n,0);});

test('corrected premises retain the old subjective attitude as pending and model reinterpretation uses only fresh evidence',async t=>{const r=fixture(t),a=event(r,'corrected','那句话是我说的');apply(r,a,[thought('我因为那句话有点介意。')],'original-feeling');const old=r.dispositions.rows()[0],fresh=event(r,'corrected','那句话其实是转述，之前我没有说明清楚');assert.equal(r.store.get(old.id,{includeInactive:true}).status,'candidate');assert.equal(r.dispositions.context('qq:100001').pendingReinterpretations[0].text,old.gist);let calls=0;r.model.think=async input=>{calls++;assert.ok(input.material.before.pendingDispositions.some(x=>x.id===old.id));return {data:{summary:'原来我误解了那句话，介意过是真的，现在愿意重新看。',changes:[],dispositions:[thought('我那次介意是真实的，不过现在知道是转述，愿意重新理解。',{transition:'continue',previousId:old.id,expectedRevision:old.revision,eventIds:[fresh.eventId]})]},receipt};};const result=await r.inner.reflect({eventIds:[fresh.eventId],key:'reinterpreted'});assert.equal(result.status,'applied');assert.equal(calls,1);const current=r.dispositions.rows()[0];assert.ok(current.evidence.every(e=>e.revision===fresh.revision));assert.equal(r.store.get(old.id).status,'outdated');assert.equal(r.dispositions.context('qq:100001').pendingReinterpretations.length,0);});


test('the public role text cannot retain score-driven length or tiered-interest instructions',()=>{const original=fs.readFileSync(new URL('../roles/肥鱼温柔撒娇.md',import.meta.url),'utf8'),cleaned=retireRelationshipRules(original);for(const old of ['实际长度和条数遵守亲密度','遵守当前亲密度与精力节奏','爱好有等级','管理员身份不等于必须加分'])assert.ok(!cleaned.includes(old),old);assert.equal(retireRelationshipRules(cleaned),cleaned);assert.match(cleaned,/允许矛盾/);});


test('review carries completed experience and sent text even when the original request dominates the text prefix',async t=>{const r=fixture(t),scope='private:100001',request=r.observe({adapter:'operator-console',externalId:'long-request',kind:'operator-note',text:'请看视频并发消息。'.repeat(160),metadata:{speakerId:'qq:100001',scope,notPrimaryEvidence:true}},{kind:'operator-note'}),experience=r.observe({adapter:'inner-feeling',externalId:'read-complete',kind:'experience',text:'视频已经读过字幕，取水失败又换办法这点让我有兴趣。',metadata:{speakerId:r.characterId,conversationPeerId:'qq:100001',scope,explicitExperience:true}},{kind:'experience-recorded'}),sent=r.observe({adapter:'qq-live-archive',externalId:'actual-sent',kind:'chat',text:'那段取水试了七八次还挺有意思的。',metadata:{speakerId:r.characterId,scope}},{kind:'resource-observed',outcome:'observed'});r.inner.apply({summary:'已读字幕的感受。',changes:[]},{expectedGeneration:r.inner.head().generation,eventIds:[experience.eventId],key:'already-experienced'});let called=0;r.model.think=async({material})=>{called++;const reviewed=material.newEvents.find(e=>e.kind==='operator-review').reviewedEvents;assert.ok(reviewed.some(e=>e.explicitExperience&&e.text.includes('已经读过字幕')));assert.ok(reviewed.some(e=>e.eventId===sent.eventId&&e.kind==='resource-observed'));assert.equal(reviewed[0].explicitExperience,true);assert.ok(reviewed.every(e=>e.historical&&e.sourceId&&e.revision===1));return {data:{summary:'已经读过，也已经分享，不把旧要求当新任务。',changes:[],psychology:{}},receipt};};const host={runtime:r,isV3:true,behaviors:new Map(),running:null,changed(){}};const result=await LiveCognition.prototype.reviewEvents.call(host,scope,[request.eventId,experience.eventId,sent.eventId],{dream:true});assert.equal(result.status,'applied');assert.equal(called,1);});


test('a successful native video read records its exact target before feelings and links to the same activity',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-perception-')),legacy=path.join(root,'legacy');fs.mkdirSync(legacy);const contacts=new ContactStore(path.join(legacy,'contacts.sqlite')),o=new LiveCognition({root:path.join(root,'v3'),profile:{id:'test',name:'测试',dir:legacy},contacts,core:'自己体验与判断。',innerVersion:3});t.after(async()=>{await o.close();contacts.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});const scope='private:100001',r=o.runtime,request=r.observe({adapter:'operator-console',externalId:'read',kind:'operator-note',text:'请看这个视频。',metadata:{speakerId:'qq:100001',scope}},{kind:'operator-note',eventRoot:'native-round'});assert.equal(o.recordPerception(scope,{tool:'qq_read_bili_video',target:'BVx',result:{}}),null);o.beginBehavior('native','chat',scope);const observation=o.recordPerception(scope,{tool:'qq_read_bili_video',target:'https://www.bilibili.com/video/BV1Tbn26aEZC',result:{source:'https://www.bilibili.com/video/BV1Tbn26aEZC',title:'方块人',subtitle:'取水没成功，换个地方继续试。',perception:{frames:[{time:1}],errors:{vision:'不可用'}}}}),doc=r.archive.get(observation.sourceId,observation.revision),body=JSON.parse(doc.text);assert.equal(body.target,'https://www.bilibili.com/video/BV1Tbn26aEZC');assert.equal(body.channels.subtitle,true);assert.equal(body.channels.visualInterpretation,false);assert.equal(body.fullVideoPlayback,false);assert.equal(doc.metadata.explicitObservation,true);assert.equal(r.store.db.prepare('SELECT event_root FROM cognitive_events WHERE event_id=?').get(observation.eventId).event_root,'native-round');assert.equal(r.dispositions.rows().length,0);const result=o.store.updateState({expectedVersion:o.store.state().version,psychological:'读到字幕了，我有点想接着看。'},scope),feeling=r.store.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE event_id=?').get(result.pendingInnerIntegration),felt=r.archive.get(feeling.source_id,feeling.source_revision);assert.ok(felt.metadata.basisSources.some(e=>e.sourceId===observation.sourceId));o.endBehavior('native');const jobs=r.store.db.prepare("SELECT payload_json FROM jobs WHERE kind='reflect'").all().map(x=>JSON.parse(x.payload_json));assert.ok(jobs.some(j=>j.eventIds.includes(observation.eventId)));});
