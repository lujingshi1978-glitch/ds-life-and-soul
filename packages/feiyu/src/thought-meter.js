import {StringDecoder} from 'node:string_decoder';
import fs from 'node:fs';
export function thoughtPurpose(prompt=''){
  if(/短时心理|这一轮行为后的/.test(prompt))return '心理更新';
  if(/亲密度|大幅下降/.test(prompt))return '亲密度评估';
  if(/睡前总结/.test(prompt))return '睡前总结';
  if(/记忆整理|记忆整合|梦游|口头禅/.test(prompt))return '记忆整理';
  if(/知识|学习眼前/.test(prompt))return '知识学习';
  if(/回忆线索/.test(prompt))return '深度回忆';
  if(/视频|B站/.test(prompt))return '上网活动';
  return '后台思考';
}
export function recordThoughtUsage(file,record){
  if(!record?.usage||!/^thought-[\w-]+$/.test(record.id))return false;
  // Usage only. No prompt, response, reasoning or personal material is journalled here.
  fs.appendFileSync(file,JSON.stringify({id:record.id,at:record.at,model:record.model,provider:record.provider,purpose:thoughtPurpose(record.prompt),outcome:record.outcome,usage:record.usage})+'\n',{encoding:'utf8',mode:0o600});return true;
}
export class ThoughtUsageReader {
  constructor(file,ingest){this.file=file;this.ingest=ingest;this.offset=0;this.tail='';this.decoder=new StringDecoder('utf8');}
  drain(){if(!fs.existsSync(this.file))return 0;const size=fs.statSync(this.file).size;if(size<this.offset){this.offset=0;this.tail='';this.decoder=new StringDecoder('utf8');}if(size===this.offset)return 0;
    const fd=fs.openSync(this.file,'r');let n,buffer=Buffer.alloc(Math.min(size-this.offset,1024*1024));try{n=fs.readSync(fd,buffer,0,buffer.length,this.offset);}finally{fs.closeSync(fd);}this.offset+=n;
    const text=this.tail+this.decoder.write(buffer.subarray(0,n)),lines=text.split('\n');this.tail=lines.pop();let count=0;
    for(const line of lines){let r;try{r=JSON.parse(line);}catch{continue;}if(r.usage&&/^thought-[\w-]+$/.test(r.id)){try{this.ingest(r);count++;}catch(e){this.offset=0;this.tail='';this.decoder=new StringDecoder('utf8');throw e;}}}
    return count;
  }
}
