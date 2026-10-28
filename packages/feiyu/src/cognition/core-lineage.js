import {hash,json,parse} from './contracts.js';

function spliceFragments(fragments,before,after,evidence){
  let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  const retained=[];let offset=0;
  for(const f of fragments){const stop=offset+f.text.length;
    if(offset<start){const text=f.text.slice(0,Math.min(f.text.length,start-offset));if(text)retained.push({...f,text});}offset=stop;
  }
  // A rewritten passage still inherits the proof of the passage it replaced.
  // Otherwise a paraphrase could detach an old claim from a later forgetting.
  const inherited=[];offset=0;for(const f of fragments){const stop=offset+f.text.length;if(stop>start&&offset<before.length-end)inherited.push(...(f.evidence||[]));offset=stop;}
  const refs=[...new Set([...evidence,...inherited])],added=after.slice(start,after.length-end);if(added)retained.push({id:'core-fragment:'+hash([added,refs]).slice(0,24),text:added,evidence:refs});
  offset=0;for(const f of fragments){const stop=offset+f.text.length;if(stop>before.length-end){const text=f.text.slice(Math.max(0,before.length-end-offset));if(text)retained.push({...f,text});}offset=stop;}
  return retained;
}
const support=fragments=>[...new Set(fragments.flatMap(f=>f.evidence||[]))];
function save(s,field,revision,fragments){
  s.db.prepare('DELETE FROM v3_core_fragments WHERE field=?').run(field);
  for(const [i,f]of fragments.entries())s.db.prepare('INSERT INTO v3_core_fragments VALUES(?,?,?,?)').run(field,f.id+':'+i,f.text,json(f.evidence||[]));
  s.db.prepare('INSERT OR REPLACE INTO v3_core_fragment_versions VALUES(?,?,?)').run(field,revision,json(fragments));
}
export function installCoreLineage(s){
  s.db.exec('CREATE TABLE IF NOT EXISTS v3_core_fragments(field TEXT NOT NULL,fragment_id TEXT NOT NULL,text TEXT NOT NULL,evidence_json TEXT NOT NULL,PRIMARY KEY(field,fragment_id));CREATE TABLE IF NOT EXISTS v3_core_fragment_versions(field TEXT NOT NULL,revision INTEGER NOT NULL,fragments_json TEXT NOT NULL,PRIMARY KEY(field,revision));');
  s.db.exec('CREATE TABLE IF NOT EXISTS v3_core_lineage_meta(version INTEGER NOT NULL)');const upgrade=s.db.prepare('SELECT version FROM v3_core_lineage_meta LIMIT 1').get()?.version!==2;
  if(upgrade&&!s.db.isTransaction){s.atomic('core-fragment-lineage-upgraded',()=>{installCoreLineage(s);return {affected:[]};});return;}
  if(upgrade){s.db.exec('DELETE FROM v3_core_fragments;DELETE FROM v3_core_fragment_versions');}
  for(const core of s.db.prepare('SELECT * FROM v2_core WHERE locked=0').all()){
    if(s.db.prepare('SELECT 1 FROM v3_core_fragment_versions WHERE field=? AND revision=?').get(core.field,core.revision))continue;
    let before='',fragments=[];
    for(const v of s.db.prepare('SELECT * FROM v2_core_versions WHERE field=? AND revision<=? ORDER BY revision').all(core.field,core.revision)){
      if(!v.body)continue;fragments=spliceFragments(fragments,before,v.body,parse(v.evidence));before=v.body;s.db.prepare('INSERT OR IGNORE INTO v3_core_fragment_versions VALUES(?,?,?)').run(core.field,v.revision,json(fragments));
    }
    if(before!==core.body)fragments=spliceFragments(fragments,before,core.body,parse(core.evidence));save(s,core.field,core.revision,fragments);
    s.db.prepare('UPDATE v2_core SET evidence=? WHERE field=?').run(json(support(fragments)),core.field);
  }
  if(upgrade){s.db.exec('DELETE FROM v3_core_lineage_meta');s.db.prepare('INSERT INTO v3_core_lineage_meta VALUES(2)').run();}
}
export function updateCoreLineage(s,field,revision,before,after,evidence){
  installCoreLineage(s);const row=s.db.prepare('SELECT fragments_json FROM v3_core_fragment_versions WHERE field=? AND revision=?').get(field,revision);
  const fragments=spliceFragments(row?parse(row.fragments_json):[{text:before,evidence:[]}],before,after,evidence);save(s,field,revision+1,fragments);return support(fragments);
}
export function forgetCoreLineage(s,affected,{redact=true}={}){
  const gone=new Set(affected);
  for(const core of s.db.prepare('SELECT * FROM v2_core WHERE locked=0').all()){
    const row=s.db.prepare('SELECT fragments_json FROM v3_core_fragment_versions WHERE field=? AND revision=?').get(core.field,core.revision);if(!row)continue;
    const old=parse(row.fragments_json),fragments=old.filter(f=>!(f.evidence||[]).some(id=>gone.has(id)));if(fragments.length===old.length)continue;
    const text=fragments.map(f=>f.text).join(''),evidence=support(fragments);save(s,core.field,core.revision+1,fragments);
    s.db.prepare('UPDATE v2_core SET body=?,revision=revision+1,evidence=? WHERE field=?').run(text,json(evidence),core.field);
    s.db.prepare('INSERT INTO v2_core_versions VALUES(?,?,?,?,?)').run(core.field,core.revision+1,text,json(evidence),s.now());
  }
  if(!redact)return;
  for(const v of s.db.prepare('SELECT * FROM v3_core_fragment_versions').all()){
    const before=parse(v.fragments_json),fragments=before.filter(f=>!(f.evidence||[]).some(id=>gone.has(id)));if(before.length===fragments.length)continue;
    s.db.prepare('UPDATE v3_core_fragment_versions SET fragments_json=? WHERE field=? AND revision=?').run(json(fragments),v.field,v.revision);
    s.db.prepare('UPDATE v2_core_versions SET body=?,evidence=? WHERE field=? AND revision=?').run(fragments.map(f=>f.text).join(''),json(support(fragments)),v.field,v.revision);
  }
}
