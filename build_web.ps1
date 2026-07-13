Write-Host "Building Flutter Web App..." -ForegroundColor Cyan
$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$flutterRoot = Join-Path $projectRoot "BulkaAndroid"
$webOutput = Join-Path $projectRoot "public\app"

Push-Location $flutterRoot
# Prefer the SkWasm renderer on browsers with WasmGC support (including
# current iOS Safari), while Flutter keeps the JavaScript/CanvasKit build as a
# compatibility fallback for older devices.
flutter build web --wasm --release --base-href "/app/"
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
