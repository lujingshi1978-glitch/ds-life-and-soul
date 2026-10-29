import fs from 'node:fs';import path from 'node:path';
import {REPO,run,locateNpm} from './deploy.mjs';
export async function setupSocialRuntime({repoRoot=REPO,installRun=run}={}){
 const env={...process.env};for(const key of Object.keys(env))if(/API_KEY|TOKEN|COOKIE|PASSWORD/i.test(key))delete env[key];
 async function lockedRuntime(templateName,directory,pkgName,version,entries){
  const template=path.join(repoRoot,'templates',templateName),runtime=path.join(repoRoot,'work/integration-runtime',directory);fs.mkdirSync(runtime,{recursive:true});
  const installed=path.join(runtime,'node_modules',pkgName,'package.json');
  const ready=()=>{try{return JSON.parse(fs.readFileSync(installed,'utf8')).version===version&&entries.every(p=>fs.existsSync(path.join(runtime,'node_modules',p)));}catch{return false;}};
  // Existing production runtimes may have an older operator-owned manifest.
  // Reuse the compatible installed runtime without overwriting that manifest.
  if(ready())return;
  // An empty cwd is not an npm project: npm may walk to the release root and
  // mutate its manifest. Seed a locked standalone project before invoking npm.
  for(const name of ['package.json','package-lock.json']){const bytes=fs.readFileSync(path.join(template,name)),to=path.join(runtime,name);if(fs.existsSync(to)&&!fs.readFileSync(to).equals(bytes))throw Error('平台适配器清单已被修改，请保留原目录并核对后再安装。');if(!fs.existsSync(to))fs.writeFileSync(to,bytes,{flag:'wx'});}
  if(!ready())await installRun(process.execPath,[locateNpm(),'ci','--ignore-scripts','--no-audit','--fund=false','--registry=https://registry.npmjs.org'],{cwd:runtime,env});
  if(!ready())throw Error('平台适配器安装后的版本或入口核验失败');
 }
 await lockedRuntime('social-runtime','social/opencli','@jackwener/opencli','2.0.2',['@jackwener/opencli/dist/src/main.js','@jackwener/opencli/dist/src/daemon.js']);
 await lockedRuntime('browser-runtime','browser','@playwright/mcp','0.0.83',['@playwright/mcp/cli.js','playwright/index.mjs']);
 return {ok:true,installed:true,version:'2.0.2',browserVersion:'0.0.83',extensionRequired:true,extensionGuide:'https://github.com/jackwener/OpenCLI#2-install-the-browser-bridge-extension',message:'读取适配器已安装；请在使用生活台的浏览器中安装OpenCLI扩展，再完成平台登录。原生互动组件需另行准备，未自动授予写权限。'};
}
