[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BuildDirectory,
    [Parameter(Mandatory=$true)][string]$SigningKeyFile,
    [string]$OutputDirectory
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $OutputDirectory) { $OutputDirectory=Join-Path $root 'public/downloads' }
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$BuildDirectory=[IO.Path]::GetFullPath($BuildDirectory)
$SigningKeyFile=[IO.Path]::GetFullPath($SigningKeyFile)
if ($SigningKeyFile.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep the signing private key outside the repository.'
}
Push-Location $root
try {
    $dirty=@(git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Commit source changes before preparing a signed release.' }
    $untrackedSource=@(git ls-files --others --exclude-standard -- IikoBonusPlugin BulkaPluginUpdater test scripts src supabase docs)
    if ($LASTEXITCODE -ne 0 -or $untrackedSource.Count -ne 0) { throw 'Commit all source inputs before preparing a signed release.' }
    $sourceCommit=(git rev-parse HEAD).Trim()
} finally { Pop-Location }
& (Join-Path $root 'scripts/build-iiko-plugin.ps1') -OutputDirectory $BuildDirectory
if ($LASTEXITCODE -ne 0) { throw 'Fresh release build failed.' }
Push-Location $root
try {
    if ((git rev-parse HEAD).Trim() -ne $sourceCommit -or
        @(git status --porcelain --untracked-files=no).Count -ne 0 -or
        @(git ls-files --others --exclude-standard -- IikoBonusPlugin BulkaPluginUpdater test scripts src supabase docs).Count -ne 0) {
        throw 'Source changed during the build. Commit and build the release again.'
    }
} finally { Pop-Location }
$dll=Join-Path $BuildDirectory 'Resto.Front.Api.IikoBonusPlugin.dll'
$assembly=[Reflection.AssemblyName]::GetAssemblyName($dll)
if ($assembly.Name -ne 'Resto.Front.Api.IikoBonusPlugin') { throw 'Incorrect plugin assembly.' }
$version=$assembly.Version.ToString(3)
$projectVersion=([xml](Get-Content -LiteralPath (Join-Path $root 'IikoBonusPlugin/IikoBonusPlugin.csproj') -Raw)).Project.PropertyGroup.Version
if ($version -ne $projectVersion) { throw 'Plugin assembly version differs from source.' }
$helper=[Reflection.AssemblyName]::GetAssemblyName((Join-Path $BuildDirectory 'BulkaPluginUpdater.exe'))
if ($helper.Name -ne 'BulkaPluginUpdater' -or $helper.Version.ToString(3) -ne $version) { throw 'Updater version differs from plugin.' }
[xml]$manifest=Get-Content -LiteralPath (Join-Path $BuildDirectory 'Manifest.xml') -Raw
if ($manifest.Manifest.FileName -ne 'Resto.Front.Api.IikoBonusPlugin.dll' -or $manifest.Manifest.ApiVersion -ne 'V9Preview7' -or
    $manifest.Manifest.TypeName -ne 'Resto.Front.Api.IikoBonusPlugin.PluginEntry' -or $manifest.Manifest.LicenseModuleId -ne '21016318') {
    throw 'Incompatible iiko plugin manifest.'
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$zip=Join-Path $OutputDirectory "BulkaPlugin-$version-update.zip"
foreach ($artifact in @($zip,($zip+'.sha256'),($zip -replace '\.zip$','.manifest.json'))) {
    if (Test-Path -LiteralPath $artifact) { throw "Versioned release is immutable: $artifact already exists." }
}
$updateStageRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$updateStage=[IO.Path]::GetFullPath((Join-Path $updateStageRoot ('bulka-signed-update-'+[Guid]::NewGuid().ToString('N'))))
if (-not $updateStage.StartsWith($updateStageRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path.' }
New-Item -ItemType Directory -Path $updateStage | Out-Null
try {
    foreach ($name in @('Resto.Front.Api.IikoBonusPlugin.dll','Manifest.xml','BulkaPluginUpdater.exe')) {
        Copy-Item -LiteralPath (Join-Path $BuildDirectory $name) -Destination (Join-Path $updateStage $name)
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($updateStage,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
    node (Join-Path $root 'scripts/sign-iiko-plugin-update.cjs') $updateStage $zip $SigningKeyFile $version $sourceCommit (Join-Path $root 'IikoBonusPlugin/PluginUpdateTrust.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Release signing failed; this package must not be published.' }
    & (Join-Path $root 'test/native-update-package/bin/Release/net472/NativeUpdatePackageTests.exe') --validate-release ($zip -replace '\.zip$','.manifest.json') $zip
    if ($LASTEXITCODE -ne 0) { throw 'Final release verification failed; this package must not be published.' }
} catch {
    foreach ($createdArtifact in @($zip,($zip+'.sha256'),($zip -replace '\.zip$','.manifest.json'))) {
        $resolvedArtifact=[IO.Path]::GetFullPath($createdArtifact)
        if ($resolvedArtifact.StartsWith($OutputDirectory+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and
            (Test-Path -LiteralPath $resolvedArtifact -PathType Leaf) -and
            -not ((Get-Item -LiteralPath $resolvedArtifact).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $resolvedArtifact -Force
        }
    }
    throw
} finally {
    $resolvedUpdateStage=[IO.Path]::GetFullPath($updateStage)
    if ($resolvedUpdateStage.StartsWith($updateStageRoot,[StringComparison]::OrdinalIgnoreCase) -and
        (Get-Item -LiteralPath $resolvedUpdateStage).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Refusing to remove linked staging directory.'
    }
    if ($resolvedUpdateStage.StartsWith($updateStageRoot,[StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedUpdateStage -Recurse -Force }
}
