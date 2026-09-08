#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptPath = Join-Path $PSScriptRoot '../../scripts/run-golden-batch.ps1'
$parseTokens = $null
$parseErrors = $null
$scriptAst = [System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath, [ref]$parseTokens, [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
    throw "Batch script has $($parseErrors.Count) syntax error(s)."
}

function Assert-Condition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

$parameters = @{}
foreach ($parameterAst in $scriptAst.ParamBlock.Parameters) {
    $parameters[$parameterAst.Name.VariablePath.UserPath] = $parameterAst
}
Assert-Condition ($null -eq $parameters.DeviceSerial.DefaultValue) 'DeviceSerial must not default to a personal device.'
Assert-Condition ($null -eq $parameters.CutoffIso.DefaultValue) 'CutoffIso must be explicit for each evaluation.'
foreach ($parameterName in @('KnownElephants', 'UnknownElephants')) {
    $defaultItems = $parameters[$parameterName].DefaultValue.SafeGetValue()
    Assert-Condition (@($defaultItems).Count -eq 0) "$parameterName must not default to a private dataset."
}

foreach ($functionAst in $scriptAst.EndBlock.Statements) {
    if ($functionAst -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
        . ([scriptblock]::Create($functionAst.Extent.Text))
    }
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "golden-batch-test-$([guid]::NewGuid())"
try {
    $knownDir = Join-Path $tempRoot 'Individual001/test'
    $unknownDir = Join-Path $tempRoot 'Individual002/test'
    New-Item -ItemType Directory -Path $knownDir, $unknownDir -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $knownDir 'before.jpg'), 'synthetic fixture')
    [System.IO.File]::WriteAllText((Join-Path $knownDir 'after.jpg'), 'synthetic fixture')
    [System.IO.File]::WriteAllText((Join-Path $unknownDir 'unknown.jpg'), 'synthetic fixture')
    $manifestArgs = @{
        RunId = 'fixture-run'
        DatasetRoot = $tempRoot
        CutoffIso = '2026-01-01T00:00:00Z'
        CutoffDate = [datetime]'2026-01-01T00:00:00Z'
        KnownElephants = @('Individual001')
        UnknownElephants = @('Individual002')
        ExifLookup = @{
            'Individual001/before.jpg' = [datetime]'2025-12-31T00:00:00Z'
            'Individual001/after.jpg' = [datetime]'2026-01-02T00:00:00Z'
            'Individual002/unknown.jpg' = [datetime]'2026-01-02T00:00:00Z'
        }
        PackNameIndex = @{ individual001 = 'individual-001' }
    }
    $manifest = New-GoldenBatchManifest @manifestArgs
    Assert-Condition ($manifest.Request.items.Count -eq 2) 'Only post-cutoff test files should be selected.'
    $knownItem = $manifest.Request.items | Where-Object knownStatus -eq 'known'
    $unknownItem = $manifest.Request.items | Where-Object knownStatus -eq 'unknown'
    Assert-Condition ($knownItem.expectedStableId -eq 'individual-001') 'Known identity must come from the installed pack.'
    Assert-Condition ($null -eq $unknownItem.expectedStableId) 'Unknown identity must remain undecided.'
    Assert-Condition ($knownItem.stagedPath -eq 'fixture-run/Individual001/after.jpg') 'Staged paths must include the run ID.'
    Assert-Condition ((Get-NormalizedIndividualName 'Individual001 (Group 2)') -eq 'individual001') 'Annotated names must normalize consistently.'

    $missingDeviceError = $null
    try {
        & $scriptPath -DatasetRoot $tempRoot -OutputDir (Join-Path $tempRoot 'results') `
            -CutoffIso '2026-01-01T00:00:00Z' -KnownElephants 'Individual001'
    } catch {
        $missingDeviceError = $_.Exception.Message
    }
    Assert-Condition ($missingDeviceError -eq 'DeviceSerial is required unless DryRun is selected.') 'A live run must require an explicit device before any device operation.'
    Write-Host 'Batch tool checks passed; no device was contacted.'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}