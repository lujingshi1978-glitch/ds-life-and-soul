param([string]$OutputRoot)
$ErrorActionPreference='Stop'
if(-not $OutputRoot){$OutputRoot=Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path '.local/windows-ui'}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
& (Join-Path $PSScriptRoot 'build-ui.ps1') -OutputRoot $OutputRoot
$runtime=Join-Path $OutputRoot 'runtime/node-v24.19.0-win-x64'
New-Item -ItemType Directory -Path $runtime -Force|Out-Null
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $runtime 'node.exe')
@'
const action=process.argv[2];
if(action==='configure'){
 let raw='';for await(const b of process.stdin)raw+=b;
 if(JSON.parse(raw).fixture!=='native-fixture')throw Error('Fixture input lost');
}
process.stdout.write(JSON.stringify({type:'result',ok:true,value:{installed:true,version:'fixture-native',healthy:false}})+'\n');
process.exit(0);
'@|Set-Content -LiteralPath (Join-Path $OutputRoot 'manager.mjs') -Encoding UTF8
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$exe=Join-Path $OutputRoot 'ui/NativeUiSmoke.exe'
& $compiler /nologo /target:winexe /codepage:65001 /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll ('/out:'+$exe) (Join-Path $PSScriptRoot 'NativeUiSmoke.cs')
if($LASTEXITCODE -ne 0){throw 'Native UI fixture compilation failed'}
$process=Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if(-not $process.WaitForExit(90000)){$process.Kill();throw 'Native UI fixture timed out'}
if($process.ExitCode -ne 0){throw 'Native UI fixture failed'}
$report=Get-Content -Raw -LiteralPath (Join-Path $OutputRoot 'native-results.json')|ConvertFrom-Json
if(-not $report.ok){throw ('Native UI fixture: '+$report.error)}
$report|ConvertTo-Json
