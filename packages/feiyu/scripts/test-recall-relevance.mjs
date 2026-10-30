import test from 'node:test';import assert from 'node:assert/strict';
import {queryRelevance,recallQueryTerms,recallRelevance,qualifyRecallMemory,isContactReflectionQuery} from '../src/cognition/recall-relevance.js';
import {rerankMemories,graphPaths} from '../src/cognition/v3-ranking.js';
const memory=(id,gist,detail='',extra={})=>({id,gist,detail,metadata:{},participants:[],evidence:[{sourceId:'source:'+id,revision:1}],status:'active',event_root:id,...extra});

test('distinctive retained detail outranks an unrelated old concern without changing either record',()=>{
 const direct=memory('one','读过一段短篇','灯塔旁有木船，船边挂着银铃。'),old=memory('two','他愿意给我留时间，心里很暖。'),rows=[old,direct],before=structuredClone(rows),options={score:id=>id==='one'?.3:.9,query:'木船 银铃',normalized:true,relevantIds:new Set(['two']),primaryIds:new Set(['one'])};
 assert.equal(queryRelevance(direct,options.query).kind,'direct');assert.equal(rerankMemories(rows,options)[0].id,'one');assert.deepEqual(rows,before);
 assert.equal(rerankMemories(rows,{...options,relevanceMode:'legacy'})[0].id,'two');
});

test('topic changes remove rejected topic cues while an explicit later recollection remains eligible',()=>{
 const old=memory('old','怪谈里的废屋很吓人'),food=memory('food','番茄鸡蛋面配一点醋。');
 const query='先不聊怪谈了，今天想聊番茄鸡蛋面';assert.equal(queryRelevance(old,query).direct,false);assert.equal(queryRelevance(food,query).direct,true);
 assert.equal(queryRelevance(old,'再说说怪谈的废屋').direct,true);
});

test('generic greetings and current-state words are not independent topical anchors',()=>{
 assert.deepEqual(recallQueryTerms('你好呀，你最近在干什么？'),[]);const m=memory('old','最近觉得自己可以有一点想法。');assert.equal(queryRelevance(m,'你好，你最近有什么想法？').kind,'generic');
 assert.deepEqual(recallQueryTerms('你在干嘛'),[]);assert.ok(recallQueryTerms('machine shipping history').includes('history'));
 assert.equal(queryRelevance(memory('craft','陶艺杯子','',{metadata:{tags:['釉色']} }),'釉色').direct,true);
});

test('semantic-only and typed association routes survive without literal overlap or invented provenance',()=>{
 const unrelated=memory('old','以前被误会时很难过'),bridge=memory('bridge','窑炉冷却时才能看清釉色'),semantic=memory('semantic','发面时要等菌群慢慢工作'),options={score:()=>.7,normalized:true,query:'酸种酵母',semanticIds:new Set(['semantic']),associationIds:new Set(['bridge'])};
 assert.equal(queryRelevance(semantic,options.query).direct,false);assert.equal(recallRelevance(semantic,options.query,options).route,'semantic');assert.equal(recallRelevance(bridge,options.query,options).expandable,true);assert.equal(recallRelevance(unrelated,options.query,options).expandable,false);
 const before=structuredClone([unrelated,bridge,semantic]),ranked=rerankMemories([unrelated,bridge,semantic],options);assert.deepEqual(ranked.map(x=>x.id),['semantic','bridge','old']);assert.deepEqual([unrelated,bridge,semantic],before);
 const noEvidence=memory('none','酸种酵母','',{evidence:[]});assert.deepEqual(rerankMemories([noEvidence],options)[0].evidence,[]);
});

test('ranking does not delete candidates or break counterevidence and graph expansion stays bounded',()=>{
 const a=memory('a','陶艺'),b=memory('b','烧成温度'),c=memory('c','旧误解已澄清'),all=new Map([a,b,c].map(x=>[x.id,x]));
 const store={get:id=>all.get(id),members:()=>[],edges:id=>id==='a'?[{from_id:'a',to_id:'b',relation:'semantic',confidence:.9}]:id==='b'?[{from_id:'b',to_id:'c',relation:'responds_to',confidence:.9}]:[]},paths=graphPaths(store,[a],{maxVisited:3,maxAdded:2,maxHops:2});
 assert.deepEqual(new Set(paths.map(x=>x.m.id)),new Set(['b','c']));assert.ok(paths.every(p=>p.hops<=2));assert.equal(rerankMemories([a,b,c],{score:()=>.5,query:'陶艺'}).length,3);
});

test('context qualification preserves current-contact reflection without promoting another person or ordinary new-topic chatter',()=>{
 const own=memory('own','他肯自己承认越界，我愿意慢慢看。','',{metadata:{disposition:{kind:'attitude',target:'qq:7'}}}),other=memory('other','那次被谢过之后心里暖了。','',{metadata:{disposition:{kind:'attitude',target:'qq:8'}}}),options={query:'你现在对我是什么感觉，愿不愿意继续聊？',entities:['qq:7']};
 assert.equal(isContactReflectionQuery(options.query),true);assert.equal(qualifyRecallMemory(own,options),true);assert.equal(qualifyRecallMemory(other,options),false);assert.equal(qualifyRecallMemory(own,{query:'番茄鸡蛋面怎么煮',entities:['qq:7']}),false);assert.equal(isContactReflectionQuery('你对我画的城堡是什么感觉'),false);
 assert.equal(rerankMemories([other,own],{...options,score:id=>id==='other'?.9:.3,normalized:true})[0].id,'own');
});

test('a generic greeting cannot open the semantic floodgate, while a substantive nonliteral bridge stays eligible',()=>{
 const m=memory('m','烧成时材料改变');assert.equal(qualifyRecallMemory(m,{query:'你好',semanticIds:new Set(['m'])}),false);assert.equal(qualifyRecallMemory(m,{query:'窑炉温度',semanticIds:new Set(['m'])}),true);assert.equal(qualifyRecallMemory(m,{query:'窑炉温度',associationIds:new Set(['m'])}),true);
});
