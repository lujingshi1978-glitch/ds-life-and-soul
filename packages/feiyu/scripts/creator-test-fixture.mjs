import fs from 'node:fs';
export const fakeCreator=()=>({prepare:async cwd=>{fs.mkdirSync(cwd,{recursive:true});return {preset:'feiyu-creator'};},bindSession(){},revoke(){},describe(){return {boundary:'windows-lpac-private-workspace'};}});
