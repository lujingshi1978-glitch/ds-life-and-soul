import path from 'node:path';
import fs from 'node:fs';
export function openCliEntry(root,daemon=false){const name=daemon?'daemon.js':'main.js',base=path.resolve(root,'../../work/integration-runtime/social');const selected=path.join(base,'opencli/node_modules/@jackwener/opencli/dist/src',name);return fs.existsSync(selected)?selected:path.join(base,'node_modules/@jackwener/opencli/dist/src',name);}
export function mediaPython(root){return process.env.FEIYU_MEDIA_PYTHON||path.resolve(root,'../../work/integration-runtime/media/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');}
