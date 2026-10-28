export function internetPanelStatus({legacy,multi,apps,history}){
 const old=legacy.status(),allSites=!!multi&&apps.settings.multiSiteActivity;
 if(!allSites)return {...old,mode:'bilibili',currentPlatform:old.running?'bilibili':null,recent:old.recent.map(r=>({...r,platform:'bilibili'}))};
 const rows=history.db.prepare("SELECT id,at,body FROM behavior_events WHERE kind='activity' AND json_valid(body) AND json_extract(body,'$.type')='web-read' ORDER BY at DESC LIMIT 8").all();
 const count=history.db.prepare("SELECT count(*) n FROM behavior_events WHERE kind='activity' AND json_valid(body) AND json_extract(body,'$.type')='web-read'").get().n;
 const recent=rows.map(row=>{const e=JSON.parse(row.body);return {id:row.id,at:row.at,title:e.title||e.url||e.platform,platform:e.platform,decision:{summary:e.summary,feeling:e.feeling},actions:e.actions};});
 return {...old,mode:'multi-site',automatic:old.settings.enabled===true,selection:'inner-intent',decisionState:multi.mind.runtime?.inner?.meta('agencyWakeV1')||null,running:!!multi.running||old.running,currentPlatform:multi.running?multi.mind.archive.meta('multi-site-last-platform'):old.running?'bilibili':null,lastError:multi.lastError||null,nextAt:multi.mind.archive.meta('multi-site-next'),reviewed:old.reviewed+count,recent:[...recent,...old.recent.map(r=>({...r,platform:'bilibili'}))].sort((a,b)=>b.at-a.at).slice(0,8)};
}
