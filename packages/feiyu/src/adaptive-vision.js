import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const run=promisify(execFile);
export function imageDetail(detail='auto',question=''){
 if(!['auto','coarse','fine'].includes(detail))throw Error('图片精度无效');
 return detail==='auto'&&/文字|小字|读字|截图|题目|解题|公式|表格|账单|代码|报错|识别.*字|看不清|OCR/i.test(question)?'fine':detail;
}
export async function prepareVisionImage(buffer,{root,python,detail='auto',question='',name='图片',signal}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-image-'));
 try{const file=path.join(dir,'source.png');fs.writeFileSync(file,buffer);
  const options={count:1,detail:imageDetail(detail,question),textHint:false};
  const {stdout}=await run(python,['-X','utf8',path.join(root,'scripts/read-local-media.py'),file,JSON.stringify(options)],{signal,windowsHide:true,timeout:15000,maxBuffer:14*1024*1024});
  const result=JSON.parse(stdout);if(!result.ok||!result.images?.length)throw Error('图片预处理未取得画面');
  return result.images.map((image,i)=>({type:'image',mediaType:image.mediaType,data:image.data,name:name+'-'+i+'-'+image.detail+'.jpg'}));
 }finally{const rel=path.relative(os.tmpdir(),dir);if(rel.startsWith('feiyu-image-')&&!rel.includes('..'))fs.rmSync(dir,{recursive:true,force:true});}
}
export const ADAPTIVE_VISION_HINT='【看图投入】普通照片、表情先粗看，接当下内容和情绪即可。文字、题目、表格、代码、小字、长截图或看不清时，用qq_read_file(detail="fine",question=要看什么,messageRef=消息seq,index=附件序号)重新读取原图及局部，不用低清预览猜字。局部不足时按frames中nextTileOffset继续传tileOffset，图片描述写明不确定文字。精读结果不会自动扩成长篇聊天。';
