param (
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

Write-Host "Building IikoBonusPlugin..."

# Ensure we have dotnet CLI or MSBuild available.
# dotnet build works perfectly for SDK-style .NET Framework projects.
try {
    dotnet build "IikoBonusPlugin\IikoBonusPlugin.csproj" -c $Configuration
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE"
    }
}
catch {
    Write-Host "Failed to build. Error: $_" -ForegroundColor Red
    Write-Host "Please check the error messages above." -ForegroundColor Yellow
    Pause
    exit 1
}

$OutputPath = "IikoBonusPlugin\bin\$Configuration\net472"

Write-Host "`nBuild successful! The plugin DLL can be found at:" -ForegroundColor Green
Write-Host "$OutputPath\IikoBonusPlugin.dll" -ForegroundColor Cyan

Write-Host "`nTo install it in iikoFront:" -ForegroundColor Yellow
Write-Host "1. Copy IikoBonusPlugin.dll and Newtonsoft.Json.dll to C:\Program Files\iiko\iikoRMS\Front.Net\Plugins\IikoBonusPlugin\"
Write-Host "2. Restart iikoFront."

Pause
