#requires -Version 7.0

param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$EscrowPublicKeyPath,
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-f0-9]{64}$')]
    [string]$ExpectedEncryptionKeyFingerprintSha256,
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$SigningPrivateKeyPath,
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$SigningPublicKeyPath,
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-f0-9]{64}$')]
    [string]$ExpectedSigningKeyFingerprintSha256,
    [string]$RecoveryRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Bulka Recovery'),
    [int]$RetentionDays = 30
)

$ErrorActionPreference = 'Stop'
if ($RetentionDays -lt 7 -or $RetentionDays -gt 365) {
    throw 'RetentionDays must be between 7 and 365.'
}
foreach ($keyPath in @($EscrowPublicKeyPath, $SigningPrivateKeyPath, $SigningPublicKeyPath)) {
    if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
        throw "Required backup key is missing: $keyPath"
    }
    $keyInfo = Get-Item -LiteralPath $keyPath -Force
    if (
        $keyInfo.PSIsContainer -or
        ($keyInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)
    ) {
        throw "Backup keys must be regular files, not directories or reparse points: $keyPath"
    }
}
if (-not $env:LOCALAPPDATA) {
    throw 'LOCALAPPDATA is required for private backup staging.'
}

$RecoveryRoot = [IO.Path]::GetFullPath($RecoveryRoot)
$recoveryLeaf = [IO.Path]::GetFileName($RecoveryRoot.TrimEnd('\'))
$forbiddenRecoveryRoots = @(
    [IO.Path]::GetPathRoot($RecoveryRoot),
    [Environment]::GetFolderPath('UserProfile'),
    [Environment]::GetFolderPath('MyDocuments'),
    $env:LOCALAPPDATA
) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
if (
    $forbiddenRecoveryRoots -contains $RecoveryRoot.TrimEnd('\') -or
    $recoveryLeaf -notmatch '(?i)^(?=.*bulka)(?=.*(?:backup|recovery)).+$'
) {
    throw 'RecoveryRoot must be a dedicated child directory named for Bulka backup/recovery.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$storageScript = Join-Path $PSScriptRoot 'backup-supabase-storage.js'
$encryptScript = Join-Path $PSScriptRoot 'encrypt-backup-file.js'
$fingerprintScript = Join-Path $PSScriptRoot 'backup-key-fingerprint.js'
$signScript = Join-Path $PSScriptRoot 'sign-backup-manifest.js'
$verifyScript = Join-Path $PSScriptRoot 'verify-backup-set.js'
$encryptedRoot = Join-Path $RecoveryRoot 'Encrypted Backups'
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$stagingParent = Join-Path $env:LOCALAPPDATA 'Bulka Backup\Staging'
$stagingRoot = Join-Path $stagingParent $runId
$stagingStorageRoot = Join-Path $stagingRoot 'storage'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$identitySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$resolvedPublicKey = (Resolve-Path -LiteralPath $EscrowPublicKeyPath).Path
$resolvedSigningPrivateKey = (Resolve-Path -LiteralPath $SigningPrivateKeyPath).Path
$resolvedSigningPublicKey = (Resolve-Path -LiteralPath $SigningPublicKeyPath).Path
$createdArtifacts = [Collections.Generic.List[string]]::new()
$productionEnv = $null
$backupCompleted = $false
$encryptedSetComplete = $false

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)][string]$FileName,
        [Parameter(Mandatory)][string[]]$Arguments,
        [AllowEmptyString()][string]$StandardInput = '',
        [string]$WorkingDirectory = $projectRoot
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FileName
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) {
        $startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Could not start $FileName."
    }
    if ($StandardInput.Length -gt 0) {
        $process.StandardInput.Write($StandardInput)
    }
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $errorOutput = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "$FileName failed with exit code $($process.ExitCode): $errorOutput"
    }
    return $output
}

function Test-ChildPath {
    param(
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$Child
    )

    $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
    $resolvedChild = [IO.Path]::GetFullPath($Child)
    return $resolvedChild.StartsWith(
        "$resolvedParent\",
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Protect-PrivateDirectory {
    param([Parameter(Mandatory)][string]$Path)

    if (Test-Path -LiteralPath $Path) {
        $existing = Get-Item -LiteralPath $Path -Force
        if (
            -not $existing.PSIsContainer -or
            ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)
        ) {
            throw "Protected backup path must be a real directory, not a file or reparse point: $Path"
        }
    }
    [IO.Directory]::CreateDirectory($Path) | Out-Null
    & icacls.exe $Path '/inheritance:r' '/grant:r' `
        "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not protect directory ACL: $Path"
    }
}

function Assert-ProtectedSigningPrivateKey {
    param([Parameter(Mandatory)][string]$Path)

    if (
        (Test-ChildPath -Parent $projectRoot -Child $Path) -or
        (Test-ChildPath -Parent $RecoveryRoot -Child $Path) -or
        (Test-ChildPath -Parent $stagingParent -Child $Path)
    ) {
        throw 'Signing private key must be outside the repository, recovery, and staging directories.'
    }
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
        throw 'Signing private-key ACL inheritance must be disabled.'
    }
    $allowedSids = @($identitySid, 'S-1-5-18', 'S-1-5-32-544')
    $ownerSid = $acl.GetOwner(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    if ($allowedSids -notcontains $ownerSid) {
        throw 'Signing private-key owner is not the task identity, SYSTEM, or Administrators.'
    }
    $rules = $acl.GetAccessRules(
        $true,
        $true,
        [System.Security.Principal.SecurityIdentifier]
    )
    foreach ($rule in $rules) {
        if (
            $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $allowedSids -notcontains $rule.IdentityReference.Value
        ) {
            throw 'Signing private-key ACL grants access outside the task identity, SYSTEM, or Administrators.'
        }
    }
}

function Get-BackupKeyInfo {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Purpose
    )

    $output = Invoke-CapturedProcess `
        -FileName 'node.exe' `
        -Arguments @($fingerprintScript, "--key=$Path", "--purpose=$Purpose")
    $info = $output | ConvertFrom-Json
    if (
        $info.purpose -ne $Purpose -or
        $info.fingerprintSha256 -notmatch '^[a-f0-9]{64}$' -or
        -not $info.algorithm
    ) {
        throw "Backup key inspection returned invalid metadata for $Purpose."
    }
    return $info
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Value
    )

    if (Test-Path -LiteralPath $Path) {
        throw "Refusing to overwrite metadata: $Path"
    }
    $partial = "$Path.partial-$PID-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText(
            $partial,
            (($Value | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
            [Text.UTF8Encoding]::new($false)
        )
        [IO.File]::Move($partial, $Path, $false)
    } finally {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
}

function Protect-BackupStream {
    param(
        [Parameter(Mandatory)][string]$InputPath,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][string]$BackupType,
        [Parameter(Mandatory)][string]$SourceName,
        [AllowEmptyString()][string]$StandardInput = ''
    )

    $output = Invoke-CapturedProcess `
        -FileName 'node.exe' `
        -Arguments @(
            $encryptScript,
            "--input=$InputPath",
            "--output=$OutputPath",
            "--public-key=$resolvedPublicKey",
            "--type=$BackupType",
            "--source-name=$SourceName"
        ) `
        -StandardInput $StandardInput
    if (
        (Test-Path -LiteralPath $OutputPath -PathType Leaf) -and
        -not $script:createdArtifacts.Contains($OutputPath)
    ) {
        $script:createdArtifacts.Add($OutputPath)
    }
    $metadata = $output | ConvertFrom-Json
    if (
        $metadata.schemaVersion -ne 1 -or
        $metadata.algorithm -ne 'RSA-OAEP-SHA256+AES-256-GCM' -or
        $metadata.backupType -ne $BackupType -or
        $metadata.encryptedFile -ne [IO.Path]::GetFileName($OutputPath) -or
        $metadata.keyFingerprintSha256 -ne $ExpectedEncryptionKeyFingerprintSha256 -or
        $metadata.selfTestAuthenticatedDecrypt -ne $true -or
        $metadata.keyFingerprintSha256 -notmatch '^[a-f0-9]{64}$' -or
        $metadata.plaintextSha256 -notmatch '^[a-f0-9]{64}$' -or
        $metadata.encryptedSha256 -notmatch '^[a-f0-9]{64}$'
    ) {
        throw "Encryption helper returned invalid metadata for $BackupType."
    }
    $actualEncryptedHash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).
        Hash.ToLowerInvariant()
    if ($actualEncryptedHash -ne $metadata.encryptedSha256) {
        throw "Encrypted $BackupType checksum verification failed."
    }
    return $metadata
}

function Remove-LegacyRecoveryArtifacts {
    $legacyStorageTargets = @()
    $legacyDatabaseTargets = @()
    $legacyEnvironmentTargets = @()
    $legacyStorageRoot = Join-Path $RecoveryRoot 'Storage Snapshots'
    if (Test-Path -LiteralPath $legacyStorageRoot -PathType Container) {
        $storageRootInfo = Get-Item -LiteralPath $legacyStorageRoot -Force
        if ($storageRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Legacy Storage root must not be a reparse point.'
        }
        $storageEntries = @(Get-ChildItem -LiteralPath $legacyStorageRoot -Force)
        $unknownStorage = @($storageEntries | Where-Object {
            -not $_.PSIsContainer -or
            $_.Name -cnotmatch '^supabase-storage-[0-9]{8}T[0-9]{6}Z(?:\.partial)?$' -or
            ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
        })
        if ($unknownStorage.Count -gt 0) {
            throw 'Legacy backup preflight failed: unrecognized Storage content; nothing was removed.'
        }
        foreach ($snapshot in $storageEntries) {
            $nestedReparsePoints = @(Get-ChildItem -LiteralPath $snapshot.FullName `
                -Force -Recurse -Attributes ReparsePoint -ErrorAction Stop)
            if ($nestedReparsePoints.Count -gt 0) {
                throw 'Legacy backup preflight failed: Storage snapshot contains a reparse point; nothing was removed.'
            }
        }
        $legacyStorageTargets = $storageEntries
    }

    $legacyDatabaseRoot = Join-Path $RecoveryRoot 'Database Dumps'
    if (Test-Path -LiteralPath $legacyDatabaseRoot -PathType Container) {
        $databaseRootInfo = Get-Item -LiteralPath $legacyDatabaseRoot -Force
        if ($databaseRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Legacy database root must not be a reparse point.'
        }
        $databaseEntries = @(Get-ChildItem -LiteralPath $legacyDatabaseRoot -Force)
        $unknownDatabase = @($databaseEntries | Where-Object {
            $_.PSIsContainer -or
            $_.Name -cnotmatch '^bulka-[0-9]{8}T[0-9]{6}Z\.dump(?:\.sha256)?$' -or
            ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
        })
        if ($unknownDatabase.Count -gt 0) {
            throw 'Legacy backup preflight failed: unrecognized database content; nothing was removed.'
        }
        $legacyDatabaseTargets = $databaseEntries
    }

    $environmentCandidates = @(Get-ChildItem -LiteralPath $RecoveryRoot -File -Force |
        Where-Object { $_.Name -cmatch '^production-env-.*\.dpapi(?:\.json)?$' })
    $unknownEnvironment = @($environmentCandidates | Where-Object {
        $_.Name -cnotmatch '^production-env-[0-9]{8}T[0-9]{6}Z\.dpapi(?:\.json)?$' -or
        ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
    })
    if ($unknownEnvironment.Count -gt 0) {
        throw 'Legacy backup preflight failed: unrecognized environment backup; nothing was removed.'
    }
    $legacyEnvironmentTargets = $environmentCandidates

    $forbidden = @(Get-ChildItem -LiteralPath $RecoveryRoot -File -Force -Recurse |
        Where-Object {
            $_.Extension -in @('.dump', '.tar', '.env', '.dpapi') -or
            $_.Name -cmatch '\.dump\.sha256$'
        } |
        Where-Object {
            $insideStorage = (Test-Path -LiteralPath $legacyStorageRoot) -and
                (Test-ChildPath -Parent $legacyStorageRoot -Child $_.FullName)
            $insideDatabase = (Test-Path -LiteralPath $legacyDatabaseRoot) -and
                (Test-ChildPath -Parent $legacyDatabaseRoot -Child $_.FullName)
            $knownEnvironment = $legacyEnvironmentTargets.FullName -contains $_.FullName
            -not ($insideStorage -or $insideDatabase -or $knownEnvironment)
        })
    if ($forbidden.Count -gt 0) {
        throw 'Legacy backup preflight failed: plaintext artifacts exist outside known locations; nothing was removed.'
    }

    foreach ($target in $legacyStorageTargets) {
        if (-not (Test-ChildPath -Parent $legacyStorageRoot -Child $target.FullName)) {
            throw 'Refusing to remove an unsafe legacy Storage snapshot.'
        }
        Remove-Item -LiteralPath $target.FullName -Recurse -Force
    }
    foreach ($target in $legacyDatabaseTargets) {
        if (-not (Test-ChildPath -Parent $legacyDatabaseRoot -Child $target.FullName)) {
            throw 'Refusing to remove an unsafe legacy database dump.'
        }
        Remove-Item -LiteralPath $target.FullName -Force
    }
    foreach ($target in $legacyEnvironmentTargets) {
        if (-not (Test-ChildPath -Parent $RecoveryRoot -Child $target.FullName)) {
            throw 'Refusing to remove an unsafe legacy environment backup.'
        }
        Remove-Item -LiteralPath $target.FullName -Force
    }
    foreach ($legacyRoot in @($legacyStorageRoot, $legacyDatabaseRoot)) {
        if (Test-Path -LiteralPath $legacyRoot) {
            if ((Get-ChildItem -LiteralPath $legacyRoot -Force | Measure-Object).Count -gt 0) {
                throw "Legacy content appeared after preflight: $legacyRoot"
            }
            Remove-Item -LiteralPath $legacyRoot -Force
        }
    }

    $remainingForbidden = @(Get-ChildItem -LiteralPath $RecoveryRoot -File -Force -Recurse |
        Where-Object {
            $_.Extension -in @('.dump', '.tar', '.env', '.dpapi') -or
            $_.Name -cmatch '\.dump\.sha256$'
        })
    if ($remainingForbidden.Count -gt 0) {
        throw 'Plaintext or machine-bound legacy recovery artifacts remain after migration.'
    }
}

function Write-BackupMetadata {
    param(
        [Parameter(Mandatory)][string]$EncryptedPath,
        [Parameter(Mandatory)]$Metadata
    )

    $metadataPath = "$EncryptedPath.metadata.json"
    Write-JsonAtomic -Path $metadataPath -Value $Metadata
    $script:createdArtifacts.Add($metadataPath)
    return $metadataPath
}

function Remove-ExpiredEncryptedBackups {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][datetime]$Cutoff
    )

    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return }
    $safeName = '^(?:(?:production-env|database|supabase-storage)-[0-9]{8}T[0-9]{6}Z\.bulka\.enc(?:\.metadata\.json)?|backup-set-[0-9]{8}T[0-9]{6}Z\.(?:json|signature\.json))$'
    $items = Get-ChildItem -LiteralPath $Root -File -Force |
        Where-Object {
            $_.LastWriteTimeUtc -lt $Cutoff -and $_.Name -cmatch $safeName
        }
    foreach ($item in $items) {
        if (-not (Test-ChildPath -Parent $Root -Child $item.FullName)) {
            throw "Refusing retention cleanup outside $Root."
        }
        Remove-Item -LiteralPath $item.FullName -Force
    }
}

foreach ($requiredScript in @(
    $storageScript,
    $encryptScript,
    $fingerprintScript,
    $signScript,
    $verifyScript
)) {
    if (-not (Test-Path -LiteralPath $requiredScript -PathType Leaf)) {
        throw "Backup helper is missing: $requiredScript"
    }
}

if (-not $env:BULKA_BACKUP_SIGNING_KEY_PASSPHRASE) {
    throw 'BULKA_BACKUP_SIGNING_KEY_PASSPHRASE must come from the task account secret environment.'
}
Assert-ProtectedSigningPrivateKey -Path $resolvedSigningPrivateKey
$encryptionKeyInfo = Get-BackupKeyInfo `
    -Path $resolvedPublicKey `
    -Purpose 'encryption-public'
if ($encryptionKeyInfo.fingerprintSha256 -ne $ExpectedEncryptionKeyFingerprintSha256) {
    throw 'Escrow encryption public key does not match the explicitly pinned fingerprint.'
}
$signingPublicKeyInfo = Get-BackupKeyInfo `
    -Path $resolvedSigningPublicKey `
    -Purpose 'signing-public'
$signingPrivateKeyInfo = Get-BackupKeyInfo `
    -Path $resolvedSigningPrivateKey `
    -Purpose 'signing-private'
if (
    $signingPublicKeyInfo.fingerprintSha256 -ne $ExpectedSigningKeyFingerprintSha256 -or
    $signingPrivateKeyInfo.fingerprintSha256 -ne $ExpectedSigningKeyFingerprintSha256 -or
    $signingPublicKeyInfo.algorithm -ne $signingPrivateKeyInfo.algorithm
) {
    throw 'Signing keys do not match the explicitly pinned fingerprint and algorithm.'
}

Protect-PrivateDirectory -Path $RecoveryRoot
Protect-PrivateDirectory -Path $encryptedRoot
Protect-PrivateDirectory -Path $stagingParent
if (Test-Path -LiteralPath $stagingRoot) {
    throw "Backup staging path already exists: $stagingRoot"
}
Protect-PrivateDirectory -Path $stagingRoot
[IO.Directory]::CreateDirectory($stagingStorageRoot) | Out-Null

try {
    $productionEnv = Invoke-CapturedProcess `
        -FileName 'ssh.exe' `
        -Arguments @('bulka-vps', 'cat /var/www/iiko-bonus/.env')
    $keyCount = ([regex]::Matches(
        $productionEnv,
        '(?m)^[A-Za-z_][A-Za-z0-9_]*='
    )).Count
    if ($keyCount -lt 80) {
        throw "Production environment looks incomplete ($keyCount keys)."
    }

    $environmentPath = Join-Path $encryptedRoot "production-env-$runId.bulka.enc"
    $environmentEncryption = Protect-BackupStream `
        -InputPath '-' `
        -OutputPath $environmentPath `
        -BackupType 'environment' `
        -SourceName 'production.env' `
        -StandardInput $productionEnv
    $environmentMetadataPath = Write-BackupMetadata `
        -EncryptedPath $environmentPath `
        -Metadata ([ordered]@{
            schemaVersion = 1
            backupSet = $runId
            sourceHost = 'bulka-vps'
            sourcePath = '/var/www/iiko-bonus/.env'
            environmentKeys = $keyCount
            encryption = $environmentEncryption
        })

    $storageOutput = Invoke-CapturedProcess `
        -FileName 'node.exe' `
        -Arguments @(
            $storageScript,
            '--env-stdin',
            "--output=$stagingStorageRoot"
        ) `
        -StandardInput $productionEnv
    $storageResult = $storageOutput | ConvertFrom-Json
    $productionEnv = $null
    if (
        -not $storageResult.snapshot -or
        -not (Test-ChildPath -Parent $stagingStorageRoot -Child $storageResult.snapshot) -or
        -not (Test-Path -LiteralPath $storageResult.snapshot -PathType Container)
    ) {
        throw 'Storage backup helper returned an unsafe snapshot path.'
    }
    $storageArchive = Join-Path $stagingRoot "supabase-storage-$runId.tar"
    $snapshotParent = Split-Path -Parent $storageResult.snapshot
    $snapshotName = Split-Path -Leaf $storageResult.snapshot
    Invoke-CapturedProcess `
        -FileName 'tar.exe' `
        -Arguments @('-cf', $storageArchive, '-C', $snapshotParent, $snapshotName) |
        Out-Null
    if (-not (Test-Path -LiteralPath $storageArchive -PathType Leaf)) {
        throw 'Storage archive was not created.'
    }

    $storagePath = Join-Path $encryptedRoot "supabase-storage-$runId.bulka.enc"
    $storageEncryption = Protect-BackupStream `
        -InputPath $storageArchive `
        -OutputPath $storagePath `
        -BackupType 'storage' `
        -SourceName ([IO.Path]::GetFileName($storageArchive))
    $storageMetadataPath = Write-BackupMetadata `
        -EncryptedPath $storagePath `
        -Metadata ([ordered]@{
            schemaVersion = 1
            backupSet = $runId
            source = 'Supabase Storage'
            files = [long]$storageResult.files
            bytes = [long]$storageResult.bytes
            buckets = [long]$storageResult.buckets
            archiveFormat = 'tar'
            encryption = $storageEncryption
        })
    Remove-Item -LiteralPath $storageArchive -Force
    Remove-Item -LiteralPath $storageResult.snapshot -Recurse -Force

    $latestDumpName = (
        Invoke-CapturedProcess `
            -FileName 'ssh.exe' `
            -Arguments @(
                'bulka-vps',
                "find /home/deploy/.bulka-releases/database-backups -maxdepth 1 -type f -name 'bulka-*.dump' -printf '%f\n' | sort | tail -n 1"
            )
    ).Trim()
    if ($latestDumpName -notmatch '^bulka-[0-9]{8}T[0-9]{6}Z\.dump$') {
        throw 'Could not resolve the latest verified database dump.'
    }
    $localDump = Join-Path $stagingRoot $latestDumpName
    $localChecksum = "$localDump.sha256"
    Invoke-CapturedProcess `
        -FileName 'scp.exe' `
        -Arguments @(
            "bulka-vps:/home/deploy/.bulka-releases/database-backups/$latestDumpName",
            $localDump
        ) | Out-Null
    Invoke-CapturedProcess `
        -FileName 'scp.exe' `
        -Arguments @(
            "bulka-vps:/home/deploy/.bulka-releases/database-backups/$latestDumpName.sha256",
            $localChecksum
        ) | Out-Null
    $expectedHash = (
        (Get-Content -LiteralPath $localChecksum -Raw).Trim() -split '\s+'
    )[0].ToLowerInvariant()
    if ($expectedHash -notmatch '^[a-f0-9]{64}$') {
        throw 'Database checksum sidecar is invalid.'
    }
    $actualHash = (Get-FileHash -LiteralPath $localDump -Algorithm SHA256).
        Hash.ToLowerInvariant()
    if ($expectedHash -ne $actualHash) {
        throw 'Copied database dump checksum verification failed.'
    }

    $databasePath = Join-Path $encryptedRoot "database-$runId.bulka.enc"
    $databaseEncryption = Protect-BackupStream `
        -InputPath $localDump `
        -OutputPath $databasePath `
        -BackupType 'database' `
        -SourceName $latestDumpName
    if ($databaseEncryption.plaintextSha256 -ne $expectedHash) {
        throw 'Encrypted database plaintext checksum does not match the verified VPS dump.'
    }
    $databaseMetadataPath = Write-BackupMetadata `
        -EncryptedPath $databasePath `
        -Metadata ([ordered]@{
            schemaVersion = 1
            backupSet = $runId
            sourceHost = 'bulka-vps'
            sourcePath = "/home/deploy/.bulka-releases/database-backups/$latestDumpName"
            sourceSha256 = $expectedHash
            sourceChecksumVerified = $true
            encryption = $databaseEncryption
        })
    Remove-Item -LiteralPath $localDump, $localChecksum -Force

    $fingerprint = [string]$environmentEncryption.keyFingerprintSha256
    if (
        $fingerprint -ne $ExpectedEncryptionKeyFingerprintSha256 -or
        $storageEncryption.keyFingerprintSha256 -ne $fingerprint -or
        $databaseEncryption.keyFingerprintSha256 -ne $fingerprint
    ) {
        throw 'Backup artifacts were not encrypted with the same escrow public key.'
    }

    $environmentMetadataHash = (Get-FileHash `
        -LiteralPath $environmentMetadataPath `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    $storageMetadataHash = (Get-FileHash `
        -LiteralPath $storageMetadataPath `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    $databaseMetadataHash = (Get-FileHash `
        -LiteralPath $databaseMetadataPath `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    $setManifestPath = Join-Path $encryptedRoot "backup-set-$runId.json"
    $setManifest = [ordered]@{
        schemaVersion = 2
        completedAtUtc = [DateTime]::UtcNow.ToString(
            'yyyy-MM-ddTHH:mm:ss.fffZ',
            [Globalization.CultureInfo]::InvariantCulture
        )
        backupSet = $runId
        algorithm = 'RSA-OAEP-SHA256+AES-256-GCM'
        keyFingerprintSha256 = $fingerprint
        signingKeyFingerprintSha256 = $ExpectedSigningKeyFingerprintSha256
        artifacts = @(
            [ordered]@{
                role = 'environment'
                encryptedFile = [IO.Path]::GetFileName($environmentPath)
                metadataFile = [IO.Path]::GetFileName($environmentMetadataPath)
                encryptedSha256 = $environmentEncryption.encryptedSha256
                metadataSha256 = $environmentMetadataHash
            },
            [ordered]@{
                role = 'storage'
                encryptedFile = [IO.Path]::GetFileName($storagePath)
                metadataFile = [IO.Path]::GetFileName($storageMetadataPath)
                encryptedSha256 = $storageEncryption.encryptedSha256
                metadataSha256 = $storageMetadataHash
            },
            [ordered]@{
                role = 'database'
                encryptedFile = [IO.Path]::GetFileName($databasePath)
                metadataFile = [IO.Path]::GetFileName($databaseMetadataPath)
                encryptedSha256 = $databaseEncryption.encryptedSha256
                metadataSha256 = $databaseMetadataHash
            }
        )
    }
    Write-JsonAtomic -Path $setManifestPath -Value $setManifest
    $createdArtifacts.Add($setManifestPath)

    $signaturePath = Join-Path $encryptedRoot "backup-set-$runId.signature.json"
    $signOutput = Invoke-CapturedProcess `
        -FileName 'node.exe' `
        -Arguments @(
            $signScript,
            "--manifest=$setManifestPath",
            "--output=$signaturePath",
            "--private-key=$resolvedSigningPrivateKey",
            "--expected-signing-key-fingerprint=$ExpectedSigningKeyFingerprintSha256"
        )
    if (Test-Path -LiteralPath $signaturePath -PathType Leaf) {
        $createdArtifacts.Add($signaturePath)
    }
    $signResult = $signOutput | ConvertFrom-Json
    if (
        $signResult.signed -ne $true -or
        $signResult.signingKeyFingerprintSha256 -ne $ExpectedSigningKeyFingerprintSha256 -or
        $signResult.signatureFile -ne [IO.Path]::GetFileName($signaturePath)
    ) {
        throw 'Backup signer did not produce the expected detached signature.'
    }

    $verifyOutput = Invoke-CapturedProcess `
        -FileName 'node.exe' `
        -Arguments @(
            $verifyScript,
            "--manifest=$setManifestPath",
            "--signature=$signaturePath",
            "--public-key=$resolvedSigningPublicKey",
            "--expected-signing-key-fingerprint=$ExpectedSigningKeyFingerprintSha256",
            "--expected-encryption-key-fingerprint=$ExpectedEncryptionKeyFingerprintSha256"
        )
    $verification = $verifyOutput | ConvertFrom-Json
    if (
        $verification.valid -ne $true -or
        $verification.artifactsVerified -ne 3 -or
        $verification.signingKeyFingerprintSha256 -ne $ExpectedSigningKeyFingerprintSha256 -or
        $verification.encryptionKeyFingerprintSha256 -ne $ExpectedEncryptionKeyFingerprintSha256
    ) {
        throw 'Immediate signed backup-set verification failed.'
    }
    $encryptedSetComplete = $true

    Remove-LegacyRecoveryArtifacts

    $success = [ordered]@{
        schemaVersion = 3
        completedAtUtc = $setManifest.completedAtUtc
        backupSet = $runId
        manifest = $setManifestPath
        detachedSignature = $signaturePath
        encryptionKeyFingerprintSha256 = $fingerprint
        signingKeyFingerprintSha256 = $ExpectedSigningKeyFingerprintSha256
        signingAlgorithm = $verification.signingAlgorithm
        senderAuthenticityVerified = $true
        environmentKeys = $keyCount
        storageFiles = [long]$storageResult.files
        storageBytes = [long]$storageResult.bytes
        databaseSource = $latestDumpName
        databaseChecksumVerified = $true
    }
    $lastSuccessPath = Join-Path $RecoveryRoot 'last-success.json'
    $lastSuccessPartial = "$lastSuccessPath.partial-$PID-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText(
            $lastSuccessPartial,
            (($success | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
            [Text.UTF8Encoding]::new($false)
        )
        [IO.File]::Move($lastSuccessPartial, $lastSuccessPath, $true)
    } finally {
        Remove-Item -LiteralPath $lastSuccessPartial -Force -ErrorAction SilentlyContinue
    }

    $backupCompleted = $true
    Remove-ExpiredEncryptedBackups `
        -Root $encryptedRoot `
        -Cutoff ([DateTime]::UtcNow.AddDays(-$RetentionDays))
    $success | ConvertTo-Json -Compress
} catch {
    if (-not $encryptedSetComplete) {
        foreach ($artifact in $createdArtifacts) {
            if (Test-ChildPath -Parent $encryptedRoot -Child $artifact) {
                Remove-Item -LiteralPath $artifact -Force -ErrorAction SilentlyContinue
            }
        }
    }
    throw
} finally {
    $productionEnv = $null
    if (Test-Path -LiteralPath $stagingRoot) {
        if (-not (Test-ChildPath -Parent $stagingParent -Child $stagingRoot)) {
            throw 'Refusing to clean an unsafe backup staging path.'
        }
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
    if (-not $backupCompleted) {
        Write-Warning 'Encrypted off-site backup set was not completed.'
    }
}
