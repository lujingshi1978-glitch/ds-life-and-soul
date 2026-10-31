param([string]$OutputRoot)
$ErrorActionPreference='Stop'
if(-not $OutputRoot){$OutputRoot=Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path '.local/windows-ui'}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(-not (Test-Path -LiteralPath $compiler)){throw 'Windows .NET Framework C# compiler not found'}
$ui=Join-Path $OutputRoot 'ui'
New-Item -ItemType Directory -Path $ui -Force|Out-Null
$bootstrap=([char]0x80A5).ToString()+([char]0x9C7C).ToString()+'.exe'
$common=@('/nologo','/target:winexe','/codepage:65001','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll')
& $compiler @common ('/out:'+(Join-Path $ui 'Feiyu.UI.exe')) (Join-Path $PSScriptRoot 'Launcher.cs')
if($LASTEXITCODE -ne 0){throw 'Native UI compilation failed'}
& $compiler @common ('/out:'+(Join-Path $OutputRoot $bootstrap)) (Join-Path $PSScriptRoot 'Bootstrap.cs')
if($LASTEXITCODE -ne 0){throw 'Bootstrap compilation failed'}
Write-Output ('Native UI compiled: '+$OutputRoot)
