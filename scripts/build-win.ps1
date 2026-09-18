$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$shimDir = Join-Path $PSScriptRoot 'npm-shim'
$builder = Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd'

if (-not (Test-Path -LiteralPath $builder)) {
  throw "electron-builder not found: $builder"
}

$realNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
$oldPath = $env:PATH
$oldRealNpm = $env:PERSONAL_WORKBENCH_REAL_NPM

try {
  $env:PERSONAL_WORKBENCH_REAL_NPM = $realNpm
  $env:PATH = "$shimDir;$oldPath"

  $prefix = (& npm.cmd prefix -w | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $prefix -ne $projectRoot) {
    throw "npm shim self-test failed: prefix='$prefix'"
  }

  & $builder --win --x64
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "electron-builder failed with exit code $exitCode"
  }
}
finally {
  $env:PATH = $oldPath
  if ($null -eq $oldRealNpm) {
    Remove-Item Env:PERSONAL_WORKBENCH_REAL_NPM -ErrorAction SilentlyContinue
  } else {
    $env:PERSONAL_WORKBENCH_REAL_NPM = $oldRealNpm
  }
}
