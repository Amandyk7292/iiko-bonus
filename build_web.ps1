Write-Host "Building Flutter Web App..." -ForegroundColor Cyan
cd BulkaAndroid
flutter build web --release --base-href "/app/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Flutter build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}
cd ..

Write-Host "Copying files to public/app..." -ForegroundColor Cyan
if (Test-Path "public/app") {
    Remove-Item -Recurse -Force "public/app"
}
New-Item -ItemType Directory -Force -Path "public/app" | Out-Null
Copy-Item -Path "BulkaAndroid/build/web/*" -Destination "public/app" -Recurse

Write-Host "Done! You can now commit and push the changes to GitHub." -ForegroundColor Green
