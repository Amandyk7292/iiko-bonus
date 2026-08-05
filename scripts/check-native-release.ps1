param(
  [string]$ApiBaseUrl = 'https://bulka.com.kz',
  [switch]$SkipNetwork,
  [switch]$SkipSigning
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'BulkaAndroid'
$errors = [System.Collections.Generic.List[string]]::new()

function Require-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    $errors.Add("${Label} is missing: $Path")
  }
}

function Require-Minimum-Version(
  [string]$Path,
  [string]$Pattern,
  [string]$Label,
  [version]$Minimum
) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  $matches = [regex]::Matches(
    (Get-Content -LiteralPath $Path -Raw),
    $Pattern
  )
  if ($matches.Count -eq 0) {
    $errors.Add("${Label}: deployment target is missing")
    return
  }

  foreach ($match in $matches) {
    try {
      $version = [version]$match.Groups['version'].Value
      if ($version -lt $Minimum) {
        $errors.Add("${Label}: deployment target $version is below $Minimum")
      }
    } catch {
      $errors.Add("${Label}: deployment target is invalid")
    }
  }
}

Require-File (Join-Path $app 'android\app\google-services.json') 'Firebase Android config'
Require-File (Join-Path $app 'ios\Runner\GoogleService-Info.plist') 'Firebase iOS config'
if (-not $SkipSigning) {
  Require-File (Join-Path $app 'android\key.properties') 'Android release signing config'
}
Require-File (Join-Path $app 'ios\Runner\RunnerRelease.entitlements') 'iOS release entitlements'
Require-File (Join-Path $app 'ios\Runner\PrivacyInfo.xcprivacy') 'iOS privacy manifest'
Require-File (Join-Path $app 'ios\Podfile') 'iOS Podfile'
Require-File (Join-Path $app 'ios\Flutter\AppFrameworkInfo.plist') 'iOS Flutter framework metadata'
Require-File (Join-Path $app 'ios\Runner.xcodeproj\project.pbxproj') 'iOS Xcode project'

$minimumIosVersion = [version]'15.0'
Require-Minimum-Version `
  (Join-Path $app 'ios\Podfile') `
  'platform\s+:ios,\s*[''"](?<version>\d+(?:\.\d+)*)[''"]' `
  'iOS Podfile' `
  $minimumIosVersion
Require-Minimum-Version `
  (Join-Path $app 'ios\Flutter\AppFrameworkInfo.plist') `
  '<key>MinimumOSVersion</key>\s*<string>(?<version>\d+(?:\.\d+)*)</string>' `
  'iOS Flutter framework metadata' `
  $minimumIosVersion
Require-Minimum-Version `
  (Join-Path $app 'ios\Runner.xcodeproj\project.pbxproj') `
  'IPHONEOS_DEPLOYMENT_TARGET\s*=\s*(?<version>\d+(?:\.\d+)*);' `
  'iOS Xcode project' `
  $minimumIosVersion

$keyPropertiesPath = Join-Path $app 'android\key.properties'
if (-not $SkipSigning -and (Test-Path -LiteralPath $keyPropertiesPath)) {
  $properties = @{}
  Get-Content -LiteralPath $keyPropertiesPath | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.+?)\s*$') { $properties[$matches[1]] = $matches[2] }
  }
  foreach ($key in 'storeFile','storePassword','keyAlias','keyPassword') {
    if (-not $properties[$key] -or $properties[$key] -match 'replace-with') {
      $errors.Add("android/key.properties: configure $key")
    }
  }
  if ($properties.storeFile) {
    $storePath = Join-Path (Join-Path $app 'android') $properties.storeFile
    if (-not (Test-Path -LiteralPath $storePath -PathType Leaf)) {
      $errors.Add("Android keystore was not found: $storePath")
    }
  }
}

if (-not $SkipNetwork) {
  try {
    $aasa = Invoke-RestMethod -Uri "$ApiBaseUrl/.well-known/apple-app-site-association" -TimeoutSec 15
    if (-not $aasa.applinks.details -or $aasa.applinks.details.Count -lt 1) {
      $errors.Add('APPLE_TEAM_ID is not published: AASA details is empty')
    } else {
      $paths = @($aasa.applinks.details | ForEach-Object { @($_.paths) })
      if ($paths -notcontains '/catalog/*') {
        $errors.Add('AASA does not allow /catalog/* Universal Links')
      }
    }
  } catch {
    $errors.Add("AASA is unavailable: $($_.Exception.Message)")
  }
  try {
    $assetLinks = @(Invoke-RestMethod -Uri "$ApiBaseUrl/.well-known/assetlinks.json" -TimeoutSec 15)
    if ($assetLinks.Count -lt 1) {
      $errors.Add('ANDROID_APP_SHA256_CERT_FINGERPRINTS is not published: assetlinks.json is empty')
    }
  } catch {
    $errors.Add("assetlinks.json is unavailable: $($_.Exception.Message)")
  }
  try {
    $health = Invoke-RestMethod -Uri "$ApiBaseUrl/healthz" -TimeoutSec 15
    if ($health.status -ne 'ok') { $errors.Add("Backend health: $($health.status)") }
  } catch {
    $errors.Add("Backend health is unavailable: $($_.Exception.Message)")
  }
}

if ($errors.Count) {
  Write-Host "NATIVE RELEASE BLOCKED ($($errors.Count))" -ForegroundColor Red
  $errors | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host 'NATIVE RELEASE CONFIG OK' -ForegroundColor Green
