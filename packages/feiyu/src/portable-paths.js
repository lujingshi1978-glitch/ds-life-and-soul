import path from 'node:path';
export function mediaPython(root){return process.env.FEIYU_MEDIA_PYTHON||path.resolve(root,'../../work/integration-runtime/media/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');}
