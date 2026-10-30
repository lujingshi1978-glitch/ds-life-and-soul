import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';
const root=process.env.FEIYU_DECK_WORKSPACE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const revision=process.env.FEIYU_DECK_REVISION||'philosophy-r5';
const file=path.join(root,'output',`feiyu-introduction-${revision}.pptx`);
const p=await PresentationFile.importPptx(await FileBlob.load(file));
const dir=path.join(root,'.build','final-renders');await fs.mkdir(dir,{recursive:true});
for(let i=0;i<p.slides.items.length;i++){
 const png=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(path.join(dir,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
}
const montage=await p.export({format:'png',montage:{columns:4,slideWidth:320,padding:16,gap:12}});
await fs.writeFile(path.join(root,'output','overview.png'),new Uint8Array(await montage.arrayBuffer()));
console.log(JSON.stringify({finalImported:true,slides:p.slides.items.length,rendered:p.slides.items.length}));
