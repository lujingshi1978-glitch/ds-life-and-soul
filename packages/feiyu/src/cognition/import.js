import fs from 'node:fs';
import readline from 'node:readline';
import {hash,fail,entityId} from './contracts.js';

// Explicit, resumable import of an operator-created JSONL export. Never opens a live V1 database.
// {id,qq,role:'user'|'assistant',at,body}. Legacy rows stay resources until re-encoded with evidence.
export async function importChatExport(runtime,file,{limit=10000,signal}={}){
  const input=fs.createReadStream(file,{encoding:'utf8',signal}),lines=readline.createInterface({input,crlfDelay:Infinity});let read=0,imported=0;
  try{for await(const line of lines){signal?.throwIfAborted();if(!line.trim())continue;if(++read>limit)break;if(line.length>300000)fail('IMPORT_LINE_TOO_LARGE');const row=JSON.parse(line);
    const peer=entityId('qq:'+row.qq);if(!['user','assistant'].includes(row.role)||typeof row.body!=='string')fail('INVALID_LEGACY_ROW');
    runtime.observe({adapter:'legacy-export',externalId:'chat:'+String(row.id||hash(row)),kind:'chat',text:row.body,occurredAt:row.at,metadata:{speakerId:row.role==='user'?peer:runtime.characterId,conversationPeerId:peer,privacyLabel:'private',legacy:true,attributionVerified:false}},
      {kind:'legacy-chat-imported',eventRoot:'legacy:chat:'+String(row.id||hash(row)),outcome:'observed'});imported++;
  }}finally{lines.close();input.destroy();}return {read:Math.min(read,limit),imported,source:'explicit-export',liveV1Opened:false};
}
