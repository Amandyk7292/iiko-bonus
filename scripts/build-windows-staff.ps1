[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$RuntimeCacheDirectory,
    [string]$VisualCppDirectory = 'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30133',
    [string]$WindowsSdkDirectory = 'C:\Program Files (x86)\Windows Kits\10',
    [string]$WindowsSdkVersion = '10.0.19041.0',
    [string]$InnoCompiler,
    [switch]$SkipDownload,
    [switch]$LaunchersOnly
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$sourceDirectory = Join-Path $repositoryRoot 'desktop\windows'
$lockPath = Join-Path $sourceDirectory 'runtime-lock.json'

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
    if (-not $resolved.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path must remain inside the verified workspace directory: $resolved"
    }
    return $resolved
}

function Assert-PlainFileName([string]$Name) {
    if (-not $Name -or $Name -ne [IO.Path]::GetFileName($Name) -or $Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        throw 'The runtime lock contains an invalid cache filename.'
    }
}

function Assert-OfficialUrl([string]$Url, [string]$ExpectedPrefix) {
    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or
        $uri.UserInfo -or $uri.Fragment -or $uri.Query -or
        -not $Url.StartsWith($ExpectedPrefix, [StringComparison]::Ordinal)) {
        throw 'The runtime lock must use the pinned official HTTPS source.'
    }
}

function Get-VerifiedCacheFile([string]$Url, [string]$Name, [string]$Sha256, [long]$ExpectedLength = 0) {
    Assert-PlainFileName $Name
    if ($Sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw "Missing pinned SHA256 for $Name" }
    $target = Assert-ChildPath (Join-Path $RuntimeCacheDirectory $Name) $RuntimeCacheDirectory
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        if ($SkipDownload) { throw "Verified cache file is missing: $target" }
        $partial = $target + '.partial-' + [Guid]::NewGuid().ToString('N')
        Write-Host "Downloading pinned official file: $Name"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
        $downloadHash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($downloadHash -ne $Sha256.ToLowerInvariant()) { throw "SHA256 mismatch for downloaded $Name. The partial file is preserved." }
        if ($ExpectedLength -gt 0 -and (Get-Item -LiteralPath $partial).Length -ne $ExpectedLength) {
            throw "Downloaded size mismatch for $Name. The partial file is preserved."
        }
        Move-Item -LiteralPath $partial -Destination $target
    }
    $actualHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $Sha256.ToLowerInvariant()) { throw "SHA256 mismatch for cached $Name. The existing cache file is preserved." }
    if ($ExpectedLength -gt 0 -and (Get-Item -LiteralPath $target).Length -ne $ExpectedLength) { throw "Cached size mismatch for $Name" }
    return $target
}

function Expand-VerifiedArchive([string]$ArchivePath, [string]$Destination) {
    $destinationPath = Assert-ChildPath $Destination $buildRoot
    if (Test-Path -LiteralPath $destinationPath) { throw 'Archive extraction requires a new destination.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $paths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $entries = New-Object 'System.Collections.Generic.List[object]'
        [long]$totalLength = 0
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('/', '\')
            if ([string]::IsNullOrWhiteSpace($name) -or [IO.Path]::IsPathRooted($name) -or $name.Contains(':')) {
                throw 'The ZIP contains an unsafe absolute or alternate-stream path.'
            }
            $destinationFile = Assert-ChildPath (Join-Path $destinationPath $name) $destinationPath
            if (-not $paths.Add($destinationFile.TrimEnd('\'))) { throw 'The ZIP contains duplicate destination paths.' }
            $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
            if ($unixType -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400) -ne 0) { throw 'ZIP symbolic links and reparse points are not allowed.' }
            $totalLength += $entry.Length
            if ($totalLength -gt 4GB -or $entries.Count -ge 100000) { throw 'The ZIP exceeds the runtime extraction limits.' }
            $entries.Add([pscustomobject]@{ Entry = $entry; Path = $destinationFile; Directory = $name.EndsWith('\') })
        }
        [IO.Directory]::CreateDirectory($destinationPath) | Out-Null
        foreach ($item in $entries) {
            if ($item.Directory) { [IO.Directory]::CreateDirectory($item.Path) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($item.Path)) | Out-Null
            $inputStream = $item.Entry.Open()
            $outputStream = [IO.File]::Open($item.Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $inputStream.CopyTo($outputStream) }
            finally { $outputStream.Dispose(); $inputStream.Dispose() }
        }
    }
    finally { $archive.Dispose() }
}

function Assert-LauncherBinary([string]$Path, [string]$Architecture, [string]$Dumpbin) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    if ([BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x4550) { throw 'Launcher is not a Windows PE binary.' }
    $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
    $expectedMachine = if ($Architecture -eq 'x86') { 0x14c } else { 0x8664 }
    if ($machine -ne $expectedMachine) { throw 'Launcher machine architecture mismatch.' }
    $optionalHeader = $peOffset + 24
    $subsystemMajor = [BitConverter]::ToUInt16($bytes, $optionalHeader + 48)
    $subsystemMinor = [BitConverter]::ToUInt16($bytes, $optionalHeader + 50)
    if ($subsystemMajor -ne 6 -or $subsystemMinor -ne 1) { throw 'Launcher does not target the Windows 7 subsystem.' }
    $directoryOffset = if ($Architecture -eq 'x86') { 96 } else { 112 }
    $clrAddress = [BitConverter]::ToUInt32($bytes, $optionalHeader + $directoryOffset + (14 * 8))
    if ($clrAddress -ne 0) { throw 'Launcher must be native, without a CLR dependency.' }
    $importOutput = (& $Dumpbin /nologo /imports $Path 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect launcher dependencies.' }
    $importLog = Join-Path $buildRoot "launcher-$Architecture-imports.txt"
    [IO.File]::WriteAllText($importLog, $importOutput, [Text.Encoding]::UTF8)
    $libraries = @([regex]::Matches($importOutput, '(?im)^\s+([a-z0-9_.-]+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Sort-Object -Unique)
    if (-not $libraries.Count) { throw 'No launcher imports were found during verification.' }
    $allowed = @('kernel32.dll', 'user32.dll', 'shell32.dll', 'advapi32.dll', 'ole32.dll', 'gdi32.dll', 'comdlg32.dll')
    foreach ($library in $libraries) {
        if ($library -notin $allowed) { throw "Unexpected launcher dependency, incompatible with standalone Windows 7 launch: $library" }
    }
    return [pscustomobject]@{
        architecture = $Architecture; machine = ('0x{0:x}' -f $machine); subsystem = '6.1'
        clr = $false; importedLibraries = $libraries
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

if (-not $OutputDirectory) {
    $buildName = 'windows-staff-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $OutputDirectory = Join-Path $repositoryRoot "outputs\$buildName"
}
$buildRoot = Assert-ChildPath $OutputDirectory $repositoryRoot
if (Test-Path -LiteralPath $buildRoot) { throw 'The output directory already exists. Choose a new directory to preserve previous builds.' }
if (-not $RuntimeCacheDirectory) { $RuntimeCacheDirectory = Join-Path $repositoryRoot 'outputs\windows-staff-runtime-cache' }
$RuntimeCacheDirectory = [IO.Path]::GetFullPath($RuntimeCacheDirectory)
if (-not $InnoCompiler) {
    $candidateCompilers = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe')
    )
    $InnoCompiler = $candidateCompilers | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
$sdkInclude = Join-Path $WindowsSdkDirectory "Include\$WindowsSdkVersion"
$sdkLibrary = Join-Path $WindowsSdkDirectory "Lib\$WindowsSdkVersion"
$resourceCompiler = Join-Path $WindowsSdkDirectory "bin\$WindowsSdkVersion\x64\rc.exe"
$requiredFiles = @(
    (Join-Path $sourceDirectory 'BulkaStaff.cpp'), (Join-Path $sourceDirectory 'BulkaStaff.rc'),
    (Join-Path $sourceDirectory 'BulkaStaff.manifest'), (Join-Path $sourceDirectory 'app.ico'),
    $resourceCompiler,
    (Join-Path $VisualCppDirectory 'bin\Hostx64\x86\cl.exe'),
    (Join-Path $VisualCppDirectory 'bin\Hostx64\x64\cl.exe')
)
if (-not $LaunchersOnly) { $requiredFiles += $lockPath; $requiredFiles += $InnoCompiler }
foreach ($requiredFile in $requiredFiles) {
    if (-not $requiredFile -or -not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Required build component is missing: $requiredFile" }
}

New-Item -ItemType Directory -Path $buildRoot | Out-Null
$launcherChecks = @()
foreach ($architecture in @('x86', 'x64')) {
    $payloadDirectory = Assert-ChildPath (Join-Path $buildRoot "payload\$architecture") $buildRoot
    New-Item -ItemType Directory -Path $payloadDirectory -Force | Out-Null
    $resourcePath = Join-Path $payloadDirectory 'BulkaStaff.res'
    $resourceArguments = @('/nologo', '/c65001', "/fo$resourcePath", "/I$sourceDirectory", "/I$sdkInclude\um", "/I$sdkInclude\shared", (Join-Path $sourceDirectory 'BulkaStaff.rc'))
    Push-Location $sourceDirectory
    try { & $resourceCompiler @resourceArguments }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "Resource compilation failed for $architecture" }
    $compilerDirectory = Join-Path $VisualCppDirectory "bin\Hostx64\$architecture"
    $compiler = Join-Path $compilerDirectory 'cl.exe'
    $launcherPath = Join-Path $payloadDirectory 'BulkaStaff.exe'
    $compilerArguments = @(
        '/nologo', '/O1', '/MT', '/W4', '/WX', '/EHsc', '/utf-8', '/std:c++14',
        '/DUNICODE', '/D_UNICODE', '/DWINVER=0x0601', '/D_WIN32_WINNT=0x0601',
        "/I$VisualCppDirectory\include", "/I$sdkInclude\um", "/I$sdkInclude\shared", "/I$sdkInclude\ucrt",
        "/Fo$payloadDirectory\BulkaStaff.obj", "/Fe$launcherPath",
        (Join-Path $sourceDirectory 'BulkaStaff.cpp'), $resourcePath,
        '/link', "/LIBPATH:$VisualCppDirectory\lib\$architecture", "/LIBPATH:$sdkLibrary\um\$architecture", "/LIBPATH:$sdkLibrary\ucrt\$architecture",
        '/SUBSYSTEM:WINDOWS,6.01', '/DYNAMICBASE', '/NXCOMPAT', '/INCREMENTAL:NO', '/MANIFEST:NO',
        'kernel32.lib', 'user32.lib', 'shell32.lib', 'ole32.lib', 'advapi32.lib'
    )
    if ($architecture -eq 'x64') { $compilerArguments += '/HIGHENTROPYVA' }
    & $compiler @compilerArguments 2>&1 | Tee-Object -FilePath (Join-Path $buildRoot "launcher-$architecture-build.txt") | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "Native launcher compilation failed for $architecture" }
    $launcherChecks += Assert-LauncherBinary $launcherPath $architecture (Join-Path $compilerDirectory 'dumpbin.exe')
}

$report = [ordered]@{
    application = 'Bulka Staff'; version = '1.0.1'; url = 'https://bulka.com.kz/?desktop=1'
    builtAt = (Get-Date).ToUniversalTime().ToString('o'); workspace = $repositoryRoot
    minimumWindows = '6.1'; userProfile = '%LOCALAPPDATA%\Bulka\Staff\Profile'
    launchers = $launcherChecks; launcherOnly = [bool]$LaunchersOnly
    runtimeArchitecture = 'x86'; x64WindowsUsesWOW64 = $true
    testedOnWindows7Hardware = $false; signed = $false
}
if ($LaunchersOnly) {
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $buildRoot 'build-report.json') -Encoding UTF8
    Write-Host "Native launchers compiled and verified: $buildRoot"
    return
}

$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
if ($lock.schemaVersion -ne 1 -or $lock.runtime.name -ne 'Supermium' -or $lock.runtime.releaseTag -notmatch '^v[0-9]+-r[0-9]+$') {
    throw 'Unsupported runtime lock schema or unpinned release tag.'
}
$releasePrefix = 'https://github.com/win32ss/supermium/releases/download/' + $lock.runtime.releaseTag + '/'
$licensePrefix = 'https://raw.githubusercontent.com/win32ss/supermium/' + $lock.runtime.releaseTag + '/'
Assert-OfficialUrl $lock.runtime.licenseUrl $licensePrefix
New-Item -ItemType Directory -Path $RuntimeCacheDirectory -Force | Out-Null
$licensePath = Get-VerifiedCacheFile $lock.runtime.licenseUrl $lock.runtime.licenseFileName $lock.runtime.licenseSha256
$runtimeChecks = @()
# One verified 32-bit browser runs on x86 Windows and under WOW64 on x64 Windows.
# Keep the x64 lock entry as source history; it is not packaged in this release.
foreach ($architecture in @('x86')) {
    $runtime = $lock.architectures.$architecture
    Assert-OfficialUrl $runtime.url $releasePrefix
    if ($runtime.archiveFileName -notmatch '\.zip$') { throw 'Only pinned runtime ZIP archives are supported.' }
    Write-Host "Verifying packaged runtime: $architecture"
    $archivePath = Get-VerifiedCacheFile $runtime.url $runtime.archiveFileName $runtime.sha256 $runtime.sizeBytes
    $extractDirectory = Join-Path $buildRoot "extracted\$architecture"
    Expand-VerifiedArchive $archivePath $extractDirectory
    $browserSource = Assert-ChildPath (Join-Path $extractDirectory $runtime.executableRelativePath) $extractDirectory
    if (-not (Test-Path -LiteralPath $browserSource -PathType Leaf)) { throw "Browser executable missing after verified extraction: $architecture" }
    $browserBytes = [IO.File]::ReadAllBytes($browserSource)
    $browserPeOffset = [BitConverter]::ToInt32($browserBytes, 0x3c)
    if ($browserPeOffset -lt 0 -or $browserPeOffset + 6 -gt $browserBytes.Length -or
        [BitConverter]::ToUInt32($browserBytes, $browserPeOffset) -ne 0x4550 -or
        [BitConverter]::ToUInt16($browserBytes, $browserPeOffset + 4) -ne 0x14c) {
        throw 'The common runtime must be a native x86 PE executable.'
    }
    $runtimeSource = [IO.Path]::GetDirectoryName($browserSource)
    $runtimeDestination = Assert-ChildPath (Join-Path $buildRoot "payload\$architecture\runtime") $buildRoot
    New-Item -ItemType Directory -Path $runtimeDestination | Out-Null
    Get-ChildItem -LiteralPath $runtimeSource -Force | Copy-Item -Destination $runtimeDestination -Recurse -Force
    Copy-Item -LiteralPath $licensePath -Destination (Join-Path $runtimeDestination 'LICENSE-Supermium.txt')
    $runtimeChecks += [pscustomobject]@{
        architecture = $architecture; machine = '0x14c'; archive = $runtime.archiveFileName; archiveSha256 = $runtime.sha256
        sourceUrl = $runtime.url; browserVersion = (Get-Item -LiteralPath $browserSource).VersionInfo.FileVersion
        runtimeDirectory = $runtimeDestination
    }
}
Copy-Item -LiteralPath $lockPath -Destination (Join-Path $buildRoot 'runtime-lock.json')
$licenseText = [IO.File]::ReadAllText($licensePath)
$notices = @"
Bulka Staff 1.0.1
Browser runtime: $($lock.runtime.name) $($lock.runtime.version) / $($lock.runtime.browserVersion)
Official release: $($lock.runtime.releaseUrl)
Corresponding source: $($lock.runtime.sourceUrl)
Original license: $($lock.runtime.licenseUrl)
Third-party notices are retained in the bundled Chromium resources (chrome://credits).

$licenseText
"@
[IO.File]::WriteAllText((Join-Path $buildRoot 'distribution-notices.txt'), $notices, [Text.Encoding]::UTF8)
$installerArguments = @('/Qp', "/DBuildRoot=$buildRoot", (Join-Path $sourceDirectory 'BulkaStaff.iss'))
& $InnoCompiler @installerArguments 2>&1 | Tee-Object -FilePath (Join-Path $buildRoot 'installer-build.txt') | Write-Host
if ($LASTEXITCODE -ne 0) { throw 'Universal Windows installer compilation failed.' }
$installerPath = Join-Path $buildRoot 'release\Bulka-Staff-Setup-1.0.1-Universal.exe'
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw 'The compiler did not produce the expected installer.' }
$installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = $installerPath + '.sha256'
[IO.File]::WriteAllText($checksumPath, "$installerHash  $([IO.Path]::GetFileName($installerPath))`r`n", [Text.Encoding]::ASCII)
$report.runtime = $runtimeChecks
$report.installer = [ordered]@{ path = $installerPath; sha256 = $installerHash; sizeBytes = (Get-Item -LiteralPath $installerPath).Length }
$reportPath = Join-Path $buildRoot 'release\build-report.json'
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Universal installer built: $installerPath"
Write-Host "SHA256: $installerHash"
Write-Host "Verification report: $reportPath"
