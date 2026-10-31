import path from 'node:path';
import { verifyBundle } from './manager.mjs';
const target=process.argv[2];
if(!target){console.error('Usage: node packaging/windows/verify-release.mjs <extracted-release-folder>');process.exitCode=2;}
else try{const result=await verifyBundle(path.resolve(target));console.log(JSON.stringify({ok:true,version:result.version,files:result.files.length}));}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'VERIFY_FAILED',message:error.message}));process.exitCode=1;}
