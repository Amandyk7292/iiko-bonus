[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$OutputDirectory,
    [string]$ProductionConfig
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$projectDirectory = Join-Path $root 'IikoBonusPlugin'
$project = Join-Path $projectDirectory 'IikoBonusPlugin.csproj'

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $root 'IikoBonusPlugin_Ready'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

function Read-AppSettings([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Config file not found: $Path"
    }
    [xml]$xml = Get-Content -LiteralPath $Path -Raw
    $settings = @{}
    foreach ($item in $xml.configuration.appSettings.add) {
        $settings[[string]$item.key] = [string]$item.value
    }
    return $settings
}

function Assert-ProductionConfig([string]$Path) {
    $settings = Read-AppSettings $Path
    $url = $settings['IIKO_LOYALTY_API_BASE_URL']
    $token = $settings['IIKO_LOYALTY_API_TOKEN']
    $uri = $null
    if (
        -not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or
        $uri.Query -or
        $uri.Fragment -or
        $uri.UserInfo
    ) {
        throw 'IIKO_LOYALTY_API_BASE_URL must be an absolute HTTPS URL.'
    }
    if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 32 -or $token -match '(?i)replace|change-me|secret-here') {
        throw 'IIKO_LOYALTY_API_TOKEN must contain the real production secret (at least 32 characters).'
    }
    $discountName = $settings['IIKO_LOYALTY_DISCOUNT_TYPE_NAME']
    $discountId = $settings['IIKO_LOYALTY_DISCOUNT_TYPE_ID']
    if ([string]::IsNullOrWhiteSpace($discountName) -and [string]::IsNullOrWhiteSpace($discountId)) {
        throw 'Configure IIKO_LOYALTY_DISCOUNT_TYPE_NAME or IIKO_LOYALTY_DISCOUNT_TYPE_ID.'
    }
    $parsedDiscountId = [Guid]::Empty
    if ($discountId -and -not [Guid]::TryParse($discountId, [ref]$parsedDiscountId)) {
        throw 'IIKO_LOYALTY_DISCOUNT_TYPE_ID must be a valid UUID when specified.'
    }
}

dotnet build $project -c $Configuration
if ($LASTEXITCODE -ne 0) {
    throw "iiko plugin build failed with exit code $LASTEXITCODE"
}

$buildDirectory = Join-Path $projectDirectory "bin\$Configuration"
$pluginDll = Join-Path $buildDirectory 'Resto.Front.Api.IikoBonusPlugin.dll'
$manifest = Join-Path $projectDirectory 'Manifest.xml'
$templateConfig = Join-Path $projectDirectory 'Resto.Front.Api.IikoBonusPlugin.dll.config.example'

foreach ($requiredFile in @($pluginDll, $manifest, $templateConfig)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required build artifact not found: $requiredFile"
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
foreach ($staleArtifact in @(
    'Resto.Front.Api.IikoBonusPlugin.dll',
    'Resto.Front.Api.IikoBonusPlugin.dll.config',
    'Resto.Front.Api.IikoBonusPlugin.dll.sha256',
    'Resto.Front.Api.IikoBonusPlugin.pdb',
    'Resto.Front.Api.V9.dll'
)) {
    Remove-Item -LiteralPath (Join-Path $OutputDirectory $staleArtifact) -Force -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath $pluginDll -Destination (Join-Path $OutputDirectory 'Resto.Front.Api.IikoBonusPlugin.dll') -Force
Copy-Item -LiteralPath $manifest -Destination (Join-Path $OutputDirectory 'Manifest.xml') -Force

$targetConfig = Join-Path $OutputDirectory 'Resto.Front.Api.IikoBonusPlugin.dll.config'
if ($ProductionConfig) {
    $ProductionConfig = [IO.Path]::GetFullPath($ProductionConfig)
    Assert-ProductionConfig $ProductionConfig
    Copy-Item -LiteralPath $ProductionConfig -Destination $targetConfig -Force
    $configMode = 'production config'
}
else {
    Copy-Item -LiteralPath $templateConfig -Destination $targetConfig -Force
    $configMode = 'safe template config'
}

[xml]$manifestXml = Get-Content -LiteralPath (Join-Path $OutputDirectory 'Manifest.xml') -Raw
if (
    $manifestXml.Manifest.FileName -ne 'Resto.Front.Api.IikoBonusPlugin.dll' -or
    $manifestXml.Manifest.TypeName -ne 'Resto.Front.Api.IikoBonusPlugin.PluginEntry' -or
    $manifestXml.Manifest.ApiVersion -ne 'V9' -or
    $manifestXml.Manifest.LicenseModuleId -ne '21016318'
) {
    throw 'Manifest.xml does not match the Bulka Bonus V9 plugin contract.'
}
[xml](Get-Content -LiteralPath $targetConfig -Raw) | Out-Null

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $OutputDirectory 'Resto.Front.Api.IikoBonusPlugin.dll')).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $OutputDirectory 'Resto.Front.Api.IikoBonusPlugin.dll.sha256') -Value "$hash  Resto.Front.Api.IikoBonusPlugin.dll" -Encoding ascii

Write-Host "iiko plugin package built: $OutputDirectory"
Write-Host "Configuration: $configMode"
Write-Host "SHA256: $hash"
if (-not $ProductionConfig) {
    Write-Warning 'The package contains no API token and cannot authenticate until a production config is supplied.'
}
