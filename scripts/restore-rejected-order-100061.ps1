param([string]$LedgerPath, [string]$ApiLogPath)
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'iikoFront*','Resto.Front*' -ErrorAction SilentlyContinue) {
    throw 'Close iikoFront before recovery.'
}
if (-not $LedgerPath) { $LedgerPath = Read-Host 'Full path to BulkaAutomaticReceipts.json' }
if (-not $ApiLogPath) { $ApiLogPath = Read-Host 'Full path to api.log' }
$evidence = Get-Content -LiteralPath $ApiLogPath -Raw
if ($evidence -notmatch 'Cancelled submitting edit session[^\r\n]+ConstraintViolationException: Order #257 \(93177814-fc13-4c9a-b932-838b67763dec\) doesn.t have guests') {
    throw 'The log does not prove this specific order creation was cancelled.'
}
$path = (Resolve-Path -LiteralPath $LedgerPath).Path
if ([IO.Path]::GetFileName($path) -ne 'BulkaAutomaticReceipts.json') { throw 'Wrong ledger file.' }
$items = @(Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
$matches = @($items | Where-Object { $_.Key -eq '6cbf5909-2f88-4f9d-ad27-e474c5027485' })
if ($matches.Count -ne 1) { throw 'Expected one record for order 100061.' }
$entry = $matches[0].Value
if ($entry.number -ne 100061 -or $entry.receiptId -or $entry.AssemblyPrinted) { throw 'Record changed; manual reconciliation required.' }
if (-not $entry.CreationStarted) { Write-Output 'Already recovered.'; exit }
$entry.CreationStarted = $false
$backup = $path + '.before-100061-' + [Guid]::NewGuid().ToString('N')
$temp = $path + '.recover-' + [Guid]::NewGuid().ToString('N')
[IO.File]::WriteAllText($temp, (ConvertTo-Json -InputObject $items -Depth 30), [Text.UTF8Encoding]::new($false))
[IO.File]::Replace($temp,$path,$backup)
Write-Output "Recovered only the rejected creation of order 100061. Backup: $backup"
