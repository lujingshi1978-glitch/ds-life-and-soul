import {json,parse} from './contracts.js';

// Repair old structural pointers without inventing an experience or motivation.
export function reconcileGoalLinks(inner){
  const db=inner.db;let links=0,chapters=0;
  for(const row of db.prepare("SELECT o.object_id,o.kind,v.revision,v.body_json FROM v3_inner_objects o JOIN v3_inner_versions v USING(object_id) WHERE o.kind IN ('wish','chapter','concern','motive','action')").all()){
    const body=parse(row.body_json),targets=new Set([...(body.objectIds||[]),body.chapterId,body.wishId,'inner:life-direction'].filter(Boolean));
    for(const target of targets){const p=inner.object(target);if(p&&target!==row.object_id)links+=Number(db.prepare('INSERT OR IGNORE INTO v3_goal_links VALUES(?,?,?,?,?)').run(row.object_id,row.revision,target,p.current_revision,row.kind==='action'?'pursues':'expresses').changes);}
    // Earlier code guessed the most recently created wish. Only an explicit
    // wishId is a specific claim; otherwise bind to the stable user direction.
    if(row.kind==='chapter'&&!body.wishId){const p=inner.object('inner:life-direction');if(p)chapters+=Number(db.prepare('UPDATE v3_life_chapters SET wish_id=?,wish_revision=? WHERE object_id=? AND revision=? AND wish_id<>?').run(p.object_id,p.current_revision,row.object_id,row.revision,p.object_id).changes);}
  }return {links,chapters};
}

export function reconcileDerivedVersions(runtime){
  const s=runtime.store,db=s.db;let rebased=0,queued=0;
  const rows=db.prepare("SELECT d.* FROM dependencies d JOIN memory_nodes n ON n.memory_id=d.parent_id JOIN memory_nodes c ON c.memory_id=d.child_id WHERE d.child_revision=c.current_revision AND d.parent_revision<>n.current_revision AND c.status<>'forgotten'").all();
  for(const d of rows){
    const now=s.get(d.parent_id),old=s.get(d.parent_id,{revision:d.parent_revision,includeInactive:true});
    const semantic=m=>m&&json({gist:m.gist,detail:m.detail,assertion:m.assertion,participants:m.participants,evidence:m.evidence,epistemic:m.epistemic});
    if(now?.status==='active'&&old&&semantic(now)===semantic(old)){
      db.prepare('UPDATE dependencies SET parent_revision=? WHERE child_id=? AND child_revision=? AND parent_id=?').run(now.revision,d.child_id,d.child_revision,d.parent_id);rebased++;
    }else{
      db.prepare("UPDATE memory_nodes SET status='candidate' WHERE memory_id=? AND status<>'forgotten'").run(d.child_id);s.index(d.child_id);
      const previous=db.prepare("SELECT status FROM v3_repair_queue WHERE kind='memory' AND target=?").get(d.child_id);
      if(!previous||!['pending','no-independent-evidence','needs-primary-evidence'].includes(previous.status)){
        db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('memory',?,'parent-revised','pending')").run(d.child_id);queued++;
      }
    }
  }return {rebased,queued};
}
