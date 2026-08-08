#requires -Version 7.0
#requires -RunAsAdministrator

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
    [Parameter(Mandatory)]
    [System.Management.Automation.PSCredential]$Credential,
    [string]$RecoveryRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Bulka Recovery'),
    [ValidatePattern('^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')]
    [string]$DailyAt = '03:45',
    [ValidateRange(7, 365)]
    [int]$RetentionDays = 30,
    [string]$TaskName = 'Bulka Authenticated Offsite Backup v3',
    [switch]$Replace
)

$ErrorActionPreference = 'Stop'
$backupScript = Join-Path $PSScriptRoot 'backup-offsite-windows.ps1'
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
foreach ($pathValue in @(
    $backupScript,
    $EscrowPublicKeyPath,
    $SigningPrivateKeyPath,
    $SigningPublicKeyPath
)) {
    if (-not (Test-Path -LiteralPath $pathValue -PathType Leaf)) {
        throw "Required file is missing: $pathValue"
    }
    $pathInfo = Get-Item -LiteralPath $pathValue -Force
    if ($pathInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Task key paths must not be reparse points: $pathValue"
    }
}
foreach ($argumentValue in @(
    $backupScript,
    $EscrowPublicKeyPath,
    $SigningPrivateKeyPath,
    $SigningPublicKeyPath,
    $RecoveryRoot,
    $TaskName
)) {
    if ($argumentValue -match '["\r\n]') {
        throw 'Task paths and names must not contain quotes or line breaks.'
    }
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and -not $Replace) {
    throw "Scheduled task already exists. Inspect it first, then rerun with -Replace: $TaskName"
}

$resolvedBackupScript = (Resolve-Path -LiteralPath $backupScript).Path
$resolvedPublicKey = (Resolve-Path -LiteralPath $EscrowPublicKeyPath).Path
$resolvedSigningPrivateKey = (Resolve-Path -LiteralPath $SigningPrivateKeyPath).Path
$resolvedSigningPublicKey = (Resolve-Path -LiteralPath $SigningPublicKeyPath).Path
$actionArguments = @(
    '-NoLogo'
    '-NoProfile'
    '-NonInteractive'
    '-ExecutionPolicy Bypass'
    "-File `"$resolvedBackupScript`""
    "-EscrowPublicKeyPath `"$resolvedPublicKey`""
    "-ExpectedEncryptionKeyFingerprintSha256 $ExpectedEncryptionKeyFingerprintSha256"
    "-SigningPrivateKeyPath `"$resolvedSigningPrivateKey`""
    "-SigningPublicKeyPath `"$resolvedSigningPublicKey`""
    "-ExpectedSigningKeyFingerprintSha256 $ExpectedSigningKeyFingerprintSha256"
    "-RecoveryRoot `"$RecoveryRoot`""
    "-RetentionDays $RetentionDays"
) -join ' '
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $actionArguments
$triggerTime = [datetime]::Today.Add([TimeSpan]::ParseExact($DailyAt, 'hh\:mm', $null))
$trigger = New-ScheduledTaskTrigger -Daily -At $triggerTime
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6)
$principal = New-ScheduledTaskPrincipal `
    -UserId $Credential.UserName `
    -LogonType Password `
    -RunLevel Highest
$definition = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Creates and sender-signs a complete encrypted Bulka off-site recovery set.'

$password = ([Net.NetworkCredential]::new('', $Credential.Password)).Password
try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -InputObject $definition `
        -User $Credential.UserName `
        -Password $password `
        -Force:$Replace | Out-Null
} finally {
    $password = $null
}

Get-ScheduledTask -TaskName $TaskName |
    Select-Object TaskName, State, @{Name = 'RunAs'; Expression = { $_.Principal.UserId } }
Write-Host 'Task registered but not started. Configure the signing passphrase secret, verify SSH BatchMode, and run one supervised backup.'
