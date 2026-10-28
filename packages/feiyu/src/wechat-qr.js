// QR generation is a locked core dependency, independent of optional runtimes.
export async function renderWechatQr(value,{loadQr=()=>import('qrcode')}={}){
  if(typeof value!=='string'||!value.trim()||value.length>8192)throw Object.assign(Error('微信返回的二维码内容无效，请重新获取。'),{code:'WECHAT_QR_INVALID'});
  let QR;try{({default:QR}=await loadQr());if(typeof QR?.toDataURL!=='function')throw Error();}
  catch{throw Object.assign(Error('微信二维码组件未就绪，请停止肥鱼后运行 scripts/修复核心依赖.cmd，再重新启动。'),{code:'WECHAT_QR_UNAVAILABLE'});}
  try{return await QR.toDataURL(value,{width:280,margin:2});}
  catch{throw Object.assign(Error('微信登录二维码生成失败，请重新获取。'),{code:'WECHAT_QR_RENDER_FAILED'});}
}
