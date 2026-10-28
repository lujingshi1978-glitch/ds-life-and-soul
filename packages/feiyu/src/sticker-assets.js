import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {looksLikeImageBuffer} from './safe-fetch.js';
// Only immutable imported images inside the active role's pack directory.
export function readStickerAsset(profileDir,entry,maxBytes=20*1024*1024){
 const match=String(entry?.asset||'').match(/^(deepseek|aemeath|phoebe)\/([a-f0-9]{64})\.(png|jpe?g|gif|webp)$/);if(!match)throw Error('无效本地表情引用');
 const root=fs.realpathSync(profileDir),file=fs.realpathSync(path.join(root,'sticker-packs',entry.asset)),relative=path.relative(root,file);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('本地表情超出角色目录');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>maxBytes)throw Error('本地表情大小超限');const buffer=fs.readFileSync(file);
 if(!looksLikeImageBuffer(buffer)||crypto.createHash('sha256').update(buffer).digest('hex')!==match[2])throw Error('本地表情校验失败');return {buffer};
}
