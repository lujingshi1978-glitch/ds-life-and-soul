import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {defaultRuntimeTuning,mergeRuntimeTuning,runtimeTuningView,TUNING_FIELDS} from '../src/runtime-tuning.js';

const html=await readFile(new URL('../public/console.html',import.meta.url),'utf8');
const begin=html.indexOf('// FEIYU_RUNTIME_TUNING_UI_BEGIN'),end=html.indexOf('// FEIYU_RUNTIME_TUNING_UI_END');
assert(begin>=0&&end>begin);
const source=html.slice(begin,end)+'\nglobalThis.createEditor=createRuntimeTuningEditor;';
const copy=value=>JSON.parse(JSON.stringify(value));
class Element {
  constructor(tag,text=''){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.listeners=new Map();this._text=text;this.value='';this.hidden=false;this.disabled=false;this.className='';this.classList={toggle:(name,on)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));if(on)values.add(name);else values.delete(name);this.className=[...values].join(' ');}};}
  setAttribute(key,value){this.attrs[key]=String(value);if(key==='class')this.className=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  append(...values){for(const value of values){this.children.push(value);value.parent=this;if(this.tagName==='SELECT'&&this.children.length===1)this.value=value.attrs.value??'';}}
  replaceChildren(...values){this.children=[];this._text='';this.append(...values);}
  set textContent(value){this.children=[];this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  async emit(type){if(type==='click'&&this.disabled)return;for(const listener of this.listeners.get(type)||[])await listener({target:this,currentTarget:this,preventDefault(){}});await settle();}
  querySelectorAll(selector){const names=selector.split(',').map(value=>value.trim().toUpperCase());return walk(this).filter(child=>child!==this&&names.includes(child.tagName));}
}
const walk=root=>[root,...root.children.flatMap(walk)];
const doc={createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text)};
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};}
function setup({stored=storage(),effective={},initialRevision=1}={}){
  let values=defaultRuntimeTuning(),revision=initialRevision,postError=null;const calls=[];
  const api=async(path,method,body)=>{assert.equal(path,'/api/runtime-tuning');const received=copy(body??null);calls.push({path,method:method||'GET',body:received});if(method==='POST'){if(postError)return {ok:false,error:postError};if(received.revision!==revision)return {ok:false,error:'参数版本已变化'};values=mergeRuntimeTuning(values,received.values);revision++;}return runtimeTuningView(values,{revision,effective});};
  const context=vm.createContext({console,JSON,Map,Set,Number,String,Date});new vm.Script(source).runInContext(context);
  const editor=context.createEditor({document:doc,api,storage:stored});
  const nodes=()=>walk(editor.element),byId=id=>nodes().find(node=>node.attrs.id===id),button=label=>nodes().find(node=>node.tagName==='BUTTON'&&node.textContent===label),field=path=>byId('runtime-field-'+path.replaceAll('.','-'));
  return {editor,calls,stored,nodes,button,field,setServer:(patch)=>{values=mergeRuntimeTuning(values,patch);revision++;},failPosts:message=>postError=message,getValues:()=>copy(values)};
}
async function input(fixture,path,value){const node=fixture.field(path);assert(node,path);node.value=String(value);await node.emit('input');}

test('the independent runtime page and mobile styles are present without replacing the role core',()=>{
  assert.match(html,/data-view="runtime"/);assert.match(html,/id="page-runtime"/);assert.match(html,/@media\(max-width:540px\)/);assert.match(html,/runtimeTuningView\.refresh\(\)/);assert.match(html,/id="personaCore"/);
});
test('every real schema field renders with bounds, recommendations, labels and restart marker',async()=>{
  const f=setup();await f.editor.refresh();assert.equal(f.calls.length,1);
  for(const field of TUNING_FIELDS){const control=f.field(field.path);assert(control,field.path);if(field.type==='number'){assert.equal(control.attrs.min,String(field.min));assert.equal(control.attrs.max,String(field.max));}assert(control.attrs['aria-describedby']);}
  assert.match(f.editor.element.textContent,/推荐/);assert.match(f.editor.element.textContent,/重启后生效/);assert(f.button('保存参数').disabled);
});
test('save sends only the changed nested field with its revision and preserves zero',async()=>{
  const f=setup();await f.editor.refresh();await input(f,'life.foregroundIdleMs',0);await f.button('保存参数').emit('click');
  assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>call.body),[{revision:1,values:{life:{foregroundIdleMs:0}}}]);assert(f.button('保存参数').disabled);
});
test('invalid numeric drafts block writes instead of coercing empty strings or fractions',async()=>{
  const f=setup();await f.editor.refresh();for(const value of ['', '1.5', '999999999']){await input(f,'life.wakeIntervalMs',value);assert(f.button('保存参数').disabled);assert.equal(f.field('life.wakeIntervalMs').attrs['aria-invalid'],'true');}assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
});
test('recommended presets only preview, can cancel, then explicitly apply to draft before saving',async()=>{
  const f=setup();await f.editor.refresh();await f.button('预览推荐').emit('click');assert(f.button('应用到草稿'));assert.equal(f.field('budget.dailySoftLimitCny').value,'0');assert.equal(f.calls.length,1);
  await f.button('取消预览').emit('click');assert.equal(f.field('budget.dailySoftLimitCny').value,'0');
  await f.button('预览推荐').emit('click');await f.button('应用到草稿').emit('click');assert.equal(f.field('budget.dailySoftLimitCny').value,'10');assert.equal(f.calls.length,1);await f.button('取消草稿').emit('click');assert.equal(f.field('budget.dailySoftLimitCny').value,'0');assert.equal(f.calls.length,1);
});
test('refresh preserves unsaved input and a full page reconstruction restores the tab draft',async()=>{
  const stored=storage(),f=setup({stored});await f.editor.refresh();await input(f,'text.psycheChars',1600);await f.editor.refresh();assert.equal(f.field('text.psycheChars').value,'1600');assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
  const next=setup({stored});await next.editor.refresh();assert.equal(next.field('text.psycheChars').value,'1600');assert(!next.button('保存参数').disabled);await next.button('取消草稿').emit('click');assert.equal(stored.values.size,0);
});
test('server revisions require an explicit review; rebasing keeps only edited fields',async()=>{
  const f=setup();await f.editor.refresh();await input(f,'text.psycheChars',1500);f.setServer({text:{psycheChars:1800},life:{wakeIntervalMs:120000}});await f.editor.refresh();assert.equal(f.field('text.psycheChars').value,'1500');assert(f.button('保存参数').disabled);await f.button('核对新版本').emit('click');assert.match(f.editor.element.textContent,/1800 字/);await f.button('按新版本继续编辑').emit('click');assert(!f.button('保存参数').disabled);assert.equal(f.field('life.wakeIntervalMs').value,'120000');await f.button('保存参数').emit('click');assert.deepEqual(f.calls.find(call=>call.method==='POST').body,{revision:2,values:{text:{psycheChars:1500}}});
});
test('real SHA256 revision tokens retain unsaved drafts across a full page reconstruction',async()=>{
 const stored=storage(),revision='a'.repeat(64),f=setup({stored,initialRevision:revision});await f.editor.refresh();await input(f,'text.psycheChars',1800);
 const next=setup({stored,initialRevision:revision});await next.editor.refresh();assert.equal(next.field('text.psycheChars').value,'1800');assert(!next.button('保存参数').disabled);
});
test('failed or stale writes retain drafts and never schedule hidden retries',async()=>{
  const f=setup();await f.editor.refresh();await input(f,'budget.dailySoftLimitCny',12);f.failPosts('页面或设定已变化，请刷新后重新核对');await f.button('保存参数').emit('click');assert.equal(f.field('budget.dailySoftLimitCny').value,'12');assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.match(f.editor.element.textContent,/草稿已保留/);assert(f.stored.values.size>0);
});
test('budget and embedding show real effective state without model paths or bearer tokens',async()=>{
  const f=setup({effective:{budget:{limitCny:10,knownCny:3.25,windingDown:true,unknownCost:2},embedding:{configured:true,model:'C:\\private\\model',dimensions:512,reason:'failed C:\\private\\model Bearer fixture-secret',serviceHealth:'not-probed',requiresRestart:true,index:{eligible:8,covered:5,missing:3,requiresReindex:true}}}});await f.editor.refresh();const text=f.editor.element.textContent;assert.match(text,/¥3\.25/);assert.match(text,/已进入收尾/);assert.match(text,/512 维/);assert.match(text,/索引覆盖：5 \/ 8/);assert.match(text,/未定价/);assert(!text.includes('C:\\private'));assert(!text.includes('fixture-secret'));
});
test('role examples remove exactly the two named cards and preserve the two active candidates',async()=>{
  for(const file of ['傲娇助手.md','小鲸鱼.md'])await assert.rejects(readFile(new URL('../roles/'+file,import.meta.url)),{code:'ENOENT'});for(const file of ['肥鱼温柔撒娇.md'])assert((await readFile(new URL('../roles/'+file,import.meta.url))).length>1000);
});
