// Runs in the rendered note page. Never mix neighbouring recommendation images.
export function collectXhsNoteImages(noteId){
 const entry=window.__INITIAL_STATE__?.note?.noteDetailMap?.[noteId];
 const note=entry?.note||entry;
 const urls=[],add=value=>{if(typeof value!=='string'||!value.trim())return;try{const u=new URL(value,location.href);if(u.protocol==='http:')u.protocol='https:';if(u.protocol!=='https:'||u.username||u.password||u.port||!/(?:^|\.)(?:xhscdn\.com|xhsimg\.com|xiaohongshu\.com)$/.test(u.hostname))return;if(!urls.includes(u.href)&&urls.length<100)urls.push(u.href);}catch{}};
 for(const image of (Array.isArray(note?.imageList)?note.imageList:[]).slice(0,100)){
  if(!image||typeof image!=='object')continue;const list=Array.isArray(image.infoList)?image.infoList:[],preferred=list.find(x=>x.imageScene==='WB_DFT')||list.find(x=>x.imageScene==='WB_PRV');
  add(image.urlDefault||preferred?.url||image.urlPre||image.url);
 }
 if(!urls.length){const root=document.querySelector('#noteContainer');if(root)for(const image of root.querySelectorAll('.swiper-slide img, .note-slider img, .media-container img, .image-container img'))if(image.naturalWidth>=200)add(image.currentSrc||image.src);}
 return {kind:note?.type==='video'?'video':'images',urls};
}
