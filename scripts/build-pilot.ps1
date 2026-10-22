$ErrorActionPreference = 'Stop'
$pilotRoot = Split-Path -Parent $PSScriptRoot
$pilotBuilder = Join-Path $pilotRoot 'node_modules\.bin\electron-builder.cmd'
$pilotNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
$pilotOldPath = $env:PATH
$pilotOldNpm = $env:PERSONAL_WORKBENCH_REAL_NPM
$pilotOldSigning = $env:CSC_IDENTITY_AUTO_DISCOVERY
Push-Location $pilotRoot
try {
  $env:PERSONAL_WORKBENCH_REAL_NPM = $pilotNpm
  $env:PATH = (Join-Path $PSScriptRoot 'npm-shim') + ';' + $pilotOldPath
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  $pilotPrefix = (& npm.cmd prefix -w | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $pilotPrefix -ne $pilotRoot) { throw 'npm shim self-test failed' }
  & $pilotBuilder --config electron-builder.pilot.json --win nsis portable --x64 --publish never
  if ($LASTEXITCODE -ne 0) { throw ('Pilot build failed: ' + $LASTEXITCODE) }
}
finally {
  Pop-Location
  $env:PATH = $pilotOldPath
  if ($null -eq $pilotOldNpm) { Remove-Item Env:PERSONAL_WORKBENCH_REAL_NPM -ErrorAction SilentlyContinue } else { $env:PERSONAL_WORKBENCH_REAL_NPM = $pilotOldNpm }
  if ($null -eq $pilotOldSigning) { Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY -ErrorAction SilentlyContinue } else { $env:CSC_IDENTITY_AUTO_DISCOVERY = $pilotOldSigning }
}
