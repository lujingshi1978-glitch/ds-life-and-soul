import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
export function secureStatePath(target,{verifyOnly=false,recursive=true,skipLinks=false}={}){
 if(process.platform!=='win32'){
  let checked=0;try{const walk=p=>{const s=fs.lstatSync(p);if(s.isSymbolicLink()){if(skipLinks)return;throw Error();}const mode=s.isDirectory()?0o700:0o600;if(!verifyOnly)fs.chmodSync(p,mode);if((fs.statSync(p).mode&0o077)!==0)throw Error();checked++;if(recursive&&s.isDirectory())for(const n of fs.readdirSync(p))walk(path.join(p,n));};walk(target);return {ok:true,checked,detail:'private-posix'};}catch{return {ok:false,detail:'PRIVATE_ACL_FAILED'};}
 }
 const script=`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);try{
 $q=[Console]::In.ReadToEnd()|ConvertFrom-Json;$r=Get-Item -LiteralPath $q.path -Force;if($r.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'root-link'}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544');$items=[Collections.Generic.List[IO.FileSystemInfo]]::new();$items.Add($r);$skipped=0
 for($i=0;$i -lt $items.Count;$i++){if($q.recursive -and $items[$i] -is [IO.DirectoryInfo]){foreach($child in $items[$i].GetFileSystemInfos()){if($child.Attributes -band [IO.FileAttributes]::ReparsePoint){if(-not $q.skipLinks){throw 'child-link'};$skipped++;continue};$items.Add($child)}}}
 foreach($item in $items){$dir=$item -is [IO.DirectoryInfo];$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
 if(-not $q.verifyOnly){$acl.SetAccessRuleProtection($true,$false);foreach($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($rule)}
 foreach($value in $allowed){$who=[Security.Principal.SecurityIdentifier]::new($value);if($dir){$rule=[Security.AccessControl.FileSystemAccessRule]::new($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{$rule=[Security.AccessControl.FileSystemAccessRule]::new($who,'FullControl','Allow')};$acl.AddAccessRule($rule)};$item.SetAccessControl($acl);$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)}
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));if($rules.Count -ne 3){throw 'rule-count'}
 foreach($rule in $rules){if($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow' -or [int]$rule.FileSystemRights -ne 2032127){throw 'unexpected-grant'}}
 if($item.FullName -eq $r.FullName -and -not $acl.AreAccessRulesProtected){throw 'root-inheritance'}
 };[Console]::Write((@{ok=$true;checked=$items.Count;skippedLinks=$skipped;detail='private-sid-tree-verified'}|ConvertTo-Json -Compress))
 }catch{[Console]::Write('{"ok":false,"detail":"PRIVATE_ACL_FAILED"}');exit 1}`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{input:JSON.stringify({path:path.resolve(target),verifyOnly,recursive,skipLinks}),encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:65536});
 try{const value=JSON.parse(r.stdout);return !r.error&&r.status===0&&value.ok?value:{ok:false,detail:'PRIVATE_ACL_FAILED'};}catch{return {ok:false,detail:'PRIVATE_ACL_FAILED'};}
}
