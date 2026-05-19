Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($env:NVM_SYMLINK)) {
 $npmRoot = 'C:\nvm4w\nodejs'
} else {
 $npmRoot = $env:NVM_SYMLINK
}

$npm = Join-Path $npmRoot 'npm.cmd'
$env:Path = "$npmRoot;$env:Path"

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist'))) {
 & $npm run build
}

& $npm run dev
