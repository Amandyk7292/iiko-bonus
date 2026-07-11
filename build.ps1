param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

Write-Host "Building IikoBonusPlugin ($Configuration)..."
& dotnet build "IikoBonusPlugin\IikoBonusPlugin.csproj" -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) {
    throw "IikoBonusPlugin build failed with exit code $LASTEXITCODE"
}

# The project deliberately disables target-framework folders, so the output is
# IikoBonusPlugin\bin\<Configuration>, not bin\<Configuration>\net462.
$outputPath = Join-Path "IikoBonusPlugin\bin" $Configuration
$requiredFiles = @(
    "Resto.Front.Api.IikoBonusPlugin.dll",
    "Manifest.xml",
    "Resto.Front.Api.IikoBonusPlugin.dll.config"
)
$missing = $requiredFiles | Where-Object { -not (Test-Path (Join-Path $outputPath $_)) }
if ($missing) {
    throw "Build completed but expected plugin files are missing: $($missing -join ', ')"
}

Write-Host "Build successful. Plugin files:" -ForegroundColor Green
$requiredFiles | ForEach-Object { Write-Host "  $(Join-Path $outputPath $_)" -ForegroundColor Cyan }

Write-Host "`nInstall in iikoFront:" -ForegroundColor Yellow
Write-Host "1. Copy the three files above to the configured iikoFront plugin folder."
Write-Host "2. Keep the real API token only in Resto.Front.Api.IikoBonusPlugin.dll.config."
Write-Host "3. Restart iikoFront and open ‘Бонусы статус’ to check connectivity."
