param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
$launchManifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pilotProfile = [IO.Path]::GetFullPath($launchManifest.profile)
$pilotExecutable = [IO.Path]::GetFullPath($launchManifest.executable)
$formalProfile = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'personal-workbench-optimized'))
if ($pilotProfile.Equals($formalProfile,[StringComparison]::OrdinalIgnoreCase) -or $pilotProfile.StartsWith($formalProfile + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Formal profile forbidden' }
$pilotMarker = Get-Content -LiteralPath (Join-Path $pilotProfile 'profile-marker.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pilotMarker.kind -ne 'personal-workbench-isolated-pilot-v1' -or $pilotMarker.expectedUserData -ne $pilotProfile) { throw 'Isolated profile marker mismatch' }
foreach ($pilotItem in @($pilotProfile,(Join-Path $pilotProfile 'data.json'))) {
  if ((Get-Item -LiteralPath $pilotItem).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked profile forbidden' }
}
$pilotPrivateRoot = [IO.Path]::GetFullPath($launchManifest.privateRoot)
if (-not $pilotProfile.StartsWith($pilotPrivateRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Profile escaped protected root' }
$pilotAcl = Get-Acl -LiteralPath $pilotPrivateRoot
if (-not $pilotAcl.AreAccessRulesProtected) { throw 'Private root permissions are not protected' }
$pilotAllowedSids = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
foreach ($pilotRule in $pilotAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($pilotRule.AccessControlType -eq 'Allow' -and $pilotRule.IdentityReference.Value -notin $pilotAllowedSids) { throw 'Unexpected access to private root' }
}
if ((Get-FileHash -LiteralPath $pilotExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $launchManifest.sha256) { throw 'Pilot executable checksum mismatch' }
$pilotTemp = Join-Path $pilotProfile 'tmp'
[IO.Directory]::CreateDirectory($pilotTemp) | Out-Null
$pilotStart = [Diagnostics.ProcessStartInfo]::new()
$pilotStart.FileName = $pilotExecutable
$pilotStart.WorkingDirectory = Split-Path -Parent $pilotExecutable
$pilotStart.UseShellExecute = $false
$pilotStart.ArgumentList.Add('--user-data-dir=' + $pilotProfile)
$pilotStart.Environment.Remove('ELECTRON_RUN_AS_NODE') | Out-Null
foreach ($pilotEnvName in @($pilotStart.Environment.Keys)) {
  if ($pilotEnvName -match '(?i)(API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET[_-]?KEY)$') { $pilotStart.Environment.Remove($pilotEnvName) | Out-Null }
}
$pilotStart.Environment['TEMP'] = $pilotTemp
$pilotStart.Environment['TMP'] = $pilotTemp
$pilotProcess = [Diagnostics.Process]::Start($pilotStart)
if (-not $pilotProcess) { throw 'Pilot did not start' }
Write-Output 'Isolated offline pilot started. Production data and AI credentials are not used.'
