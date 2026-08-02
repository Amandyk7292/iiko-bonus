Write-Host "Building Flutter Web App..." -ForegroundColor Cyan
$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$flutterRoot = Join-Path $projectRoot "BulkaAndroid"
$webOutput = Join-Path $projectRoot "public\app"
$vapidKey = $env:FIREBASE_WEB_VAPID_KEY
if ([string]::IsNullOrWhiteSpace($vapidKey)) {
    $vapidKey = "BItWENnHyRNy96PDaiO8Ga76xj3R0bc9ybb1WNNrxNiKuAJHjqOrO9Nqi6mZus4WUlQAYeZnAUyDogjSp46tfhI"
}

Push-Location $flutterRoot
# Build the broadly compatible dart2js release. Skipping the optional Wasm
# dry-run keeps routine VPS releases fast; Wasm can still be enabled manually
# for a dedicated performance benchmark when it is actually needed.
flutter build web --release --no-wasm-dry-run --csp -O4 --base-href "/" `
    --dart-define=BULKA_API_BASE_URL=https://bulka.com.kz `
    --dart-define=FIREBASE_WEB_VAPID_KEY=$vapidKey
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Flutter build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}
Pop-Location

Write-Host "Copying files to public/app..." -ForegroundColor Cyan
if (Test-Path $webOutput) {
    Remove-Item -Recurse -Force $webOutput
}
New-Item -ItemType Directory -Force -Path $webOutput | Out-Null
Copy-Item -Path (Join-Path $flutterRoot "build\web\*") -Destination $webOutput -Recurse

Write-Host "Done! You can now commit and push the changes to GitHub." -ForegroundColor Green
