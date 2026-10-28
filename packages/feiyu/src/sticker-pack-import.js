import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {loadStickerStore,saveStickerStore,normalizeStickerEntry} from './sticker-lib.js';import {looksLikeImageBuffer} from './safe-fetch.js';
const moods={angry:['生气','炸毛','不爽'],baka:['吐槽','笨蛋','调侃'],confused:['疑惑','问号','没懂'],cpu:['卡住','烧脑'],fool:['自嘲','翻车'],happy:['开心','好笑','绷不住'],like:['喜欢','赞同'],meow:['卖萌','可爱'],morning:['早安'],reply:['回应','收到'],sad:['难过','委屈','安慰'],see:['围观','偷看','吃瓜'],shy:['害羞','夸奖'],sigh:['无语','无奈','麻了'],sleep:['困','睡觉','晚安'],surprised:['震惊','惊讶'],work:['忙','上班']};
export function importStickerPack(profileDir,sourceDir,pack){
 if(!['deepseek','aemeath','phoebe'].includes(pack))throw Error('未知表情包');const manifest=JSON.parse(fs.readFileSync(path.join(sourceDir,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
 const file=path.join(profileDir,'stickers.json'),entries=loadStickerStore(file),byHash=new Map(entries.map(e=>[e.md5,e])),counts={added:0,existing:0,skipped:0};
 for(const category of Object.keys(moods)){
  const dir=path.join(sourceDir,'memes',category);if(!fs.existsSync(dir))continue;let index=0;
  for(const f of fs.readdirSync(dir,{withFileTypes:true})){
   if(!f.isFile()||!/^\.(png|jpe?g|gif|webp)$/i.test(path.extname(f.name))){counts.skipped++;continue;}
   const original=path.join(dir,f.name),size=fs.statSync(original).size;if(size>20*1024*1024){counts.skipped++;continue;}const buffer=fs.readFileSync(original);if(!looksLikeImageBuffer(buffer)){counts.skipped++;continue;}
   const hash=crypto.createHash('sha256').update(buffer).digest('hex'),md5=crypto.createHash('md5').update(buffer).digest('hex').toUpperCase();if(byHash.has(md5)){counts.existing++;continue;}
   const ext=path.extname(f.name).toLowerCase(),asset=pack+'/'+hash+ext,target=path.join(profileDir,'sticker-packs',asset);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,buffer);
   const entry=normalizeStickerEntry({id:'pack:'+pack+':'+hash.slice(0,20),asset,pack,md5,source:'manual',desc:manifest.name+'·'+moods[category][0]+'·'+(++index),tags:[...moods[category],category,manifest.name],localNote:'作者归类为'+moods[category][0]+'；未逐张识别图中文字，歧义时先看图。',usage:'表达'+moods[category].join('/')+'。先判断眼前互动，再选图，不以画面动作当现实事件。'});entries.push(entry);byHash.set(md5,entry);counts.added++;
  }
 }
 saveStickerStore(file,entries);const receipt={pack,source:manifest.source,license:manifest.license,name:manifest.name,version:manifest.version,...counts,at:Date.now()};fs.mkdirSync(path.join(profileDir,'sticker-packs',pack),{recursive:true});fs.writeFileSync(path.join(profileDir,'sticker-packs',pack,'source.json'),JSON.stringify(receipt,null,2));return receipt;
}
