#Requires -Version 7.0
<#
.SYNOPSIS
    Orchestrates a debug-only "golden batch" evaluation run of the on-device
    wildlifePipeline (YOLO detect -> native crop -> MiewID v4.1 embedding ->
    full cosine match) against a curated set of post-cutoff reference photos.

.DESCRIPTION
    This script never touches production observation/sync data -- it only
    talks to the debug-signed app's private `batch/` directory via
    `adb`/`run-as`, which the app's DEBUG-ONLY golden batch evaluator
    (src/services/goldenBatchEvaluator) watches for on startup.

    Dataset selection:
      1. For each configured elephant folder under -DatasetRoot, only files
         physically present in that elephant's `<folder>\test\` subfolder are
         candidates (the dataset's own enrollment/test split).
      2. Of those, only files whose EXIF capture date/time (read from the
         dataset's own pre-built `_build\exif_all.json` cache -- this script
         does NOT re-derive EXIF itself) falls ON OR AFTER -CutoffIso are
         selected ("actual post-cutoff test files").
    Both conditions are required. Supply the cutoff and folder groups for
    the dataset and enrollment snapshot being evaluated.

    Known/unknown + stable-ID mapping:
      - Known elephants (-KnownElephants) are resolved to a pack stable ID by
        reading EVERY installed pack's `embeddings/index.json` directly off
        the device (never hardcoded), normalizing individual display names by
        stripping trailing parenthetical annotations before a
        case-insensitive match. A known elephant that
        fails to resolve is a hard error -- it indicates the installed pack
        changed and the mapping needs attention.
            - Unknown elephants (-UnknownElephants) are always written
        with a null expectedStableId regardless of any accidental pack match,
                modelling the open-set / not-in-pack case. The caller must verify
                that these groups are not enrolled in the installed pack.

    Never logs image content, GPS, auth tokens, or secrets -- only file
    names, folder names, counts, and status/summary JSON produced by the
    evaluator itself (which contains none of those things either).

.PARAMETER DatasetRoot
    Root of the evaluation dataset. Must contain a
    `_build\exif_all.json` cache and, for every configured
    elephant, a `<name>\test\` subfolder.

.PARAMETER OutputDir
    Where to write this run's pulled results (status.json, detections.jsonl,
    summary.csv, run-metadata.json) and a local copy of the manifest that was
    staged. Created if it does not exist.

.PARAMETER DeviceSerial
    Explicit adb device serial to target. Required except for a dry run.

.PARAMETER Package
    Debug application ID whose private files/ dir hosts the evaluator's
    batch/ directory. Defaults to the elebook debug build.

.PARAMETER CutoffIso
    Inclusive cutoff date (ISO-8601, UTC) -- only files with an EXIF capture
    date on or after this instant are selected as "post-cutoff test files".

.PARAMETER KnownElephants
    Dataset folder names that ARE installed in the on-device pack (their
    stable ID is resolved and asserted known).

.PARAMETER UnknownElephants
    Dataset folder names that are NOT installed in the on-device pack
    (open-set probes; always written with a null expectedStableId).

.PARAMETER MatchThreshold
    Optional cosine-similarity threshold override forwarded to the manifest;
    omitted uses the evaluator's own default.

.PARAMETER TimeoutSeconds
    Bounded wall-clock timeout while polling status.json for completion.

.PARAMETER PollIntervalSeconds
    Delay between status.json polls.

.PARAMETER RunId
    Optional explicit run id (must be filesystem/path safe, no separators).
    Defaults to a timestamped id.

.PARAMETER DryRun
    Build and validate the manifest and print selection counts, then exit
    WITHOUT touching the device at all (no staging, no trigger, no polling).
    Useful for validating dataset selection/pack mapping in isolation.

.PARAMETER KeepDeviceStaging
    Skip the final device-side staging cleanup (for debugging only). The
    device's `batch/results/<runId>/` audit trail is always left in place
    regardless of this switch.

.EXAMPLE
    .\scripts\run-golden-batch.ps1 `
        -DatasetRoot 'C:\datasets\evaluation' `
        -OutputDir 'C:\results\evaluation' `
        -DeviceSerial '<adb-serial>' `
        -CutoffIso '2026-01-01T00:00:00Z' `
        -KnownElephants 'Individual001' `
        -UnknownElephants 'Individual002'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DatasetRoot,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [string]$DeviceSerial,

    [string]$Package = 'org.ganesha.elebook.dev',

    [Parameter(Mandatory = $true)]
    [string]$CutoffIso,

    [string[]]$KnownElephants = @(),

    [string[]]$UnknownElephants = @(),

    [double]$MatchThreshold,

    [int]$TimeoutSeconds = 3600,

    [int]$PollIntervalSeconds = 5,

    [string]$RunId,

    [switch]$DryRun,

    [switch]$KeepDeviceStaging
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

function Write-Info {
    param([string]$Message)
    Write-Host "[golden-batch] $Message"
}

function Write-WarningLine {
    param([string]$Message)
    Write-Warning "[golden-batch] $Message"
}

function Assert-SafeRunId {
    param([string]$Value)
    if ($Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
        throw "RunId '$Value' must be 1-80 characters and contain only letters, digits, '.', '_' or '-'."
    }
}

function Assert-SafeAndroidPackage {
    param([string]$Value)
    if ($Value -notmatch '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$') {
        throw "Package '$Value' is not a safe Android application ID."
    }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Value)
    [System.IO.File]::WriteAllText(
        $Path,
        $Value,
        [System.Text.UTF8Encoding]::new($false)
    )
}

# adb/run-as JSON payloads only ever contain file names, folder names,
# stable IDs, scores, timings, and error strings -- never image bytes, GPS,
# tokens, or secrets, so it is safe to write them straight through here.
function Invoke-Adb {
    param([string[]]$Arguments)
    $output = & adb -s $DeviceSerial @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "adb $($Arguments -join ' ') failed (exit $LASTEXITCODE): $output"
    }
    return $output
}

function Invoke-RunAs {
    param([string[]]$Arguments)
    return Invoke-Adb -Arguments (@('shell', 'run-as', $Package) + $Arguments)
}

# Pull one device-private file to a local path using exec-out (binary-safe,
# unlike `adb shell ... cat > file`, which mangles line endings on Windows).
function Copy-DeviceFileToLocal {
    param([string]$DevicePath, [string]$LocalPath)
    $localDir = Split-Path -Parent $LocalPath
    if ($localDir -and -not (Test-Path $localDir)) {
        New-Item -ItemType Directory -Path $localDir -Force | Out-Null
    }
    & adb -s $DeviceSerial exec-out run-as $Package cat $DevicePath > $LocalPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to pull '$DevicePath' from device (exit $LASTEXITCODE)."
    }
}

function Test-DeviceFileExists {
    param([string]$DevicePath)
    & adb -s $DeviceSerial shell run-as $Package test -e $DevicePath 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# ---------------------------------------------------------------------------
# Dataset selection: _build/exif_all.json + <folder>/test/ intersection
# ---------------------------------------------------------------------------

# Normalizes the dataset's "yyyy:MM:dd HH:mm:ss" EXIF datetime string into a
# .NET DateTime. Returns $null (never throws) for missing/malformed values so
# a single bad EXIF record can't abort the whole run.
function ConvertFrom-ExifDateTime {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }
    try {
        $datePart = $Value.Substring(0, 10) -replace ':', '-'
        $timePart = $Value.Substring(11)
        return [datetime]::Parse("$datePart $timePart", [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return $null
    }
}

# Loads the dataset's own EXIF cache (built by its existing build.py/exif.py
# pipeline) and keys every record by "<folder>/<fileName>" for fast lookup.
# This script deliberately does NOT re-derive EXIF data itself.
function Read-ExifAllCache {
    param([string]$DatasetRoot)

    $cachePath = Join-Path $DatasetRoot '_build\exif_all.json'
    if (-not (Test-Path $cachePath)) {
        throw "Expected EXIF cache not found at '$cachePath'. This script reads the dataset's own _build/exif_all.json rather than re-deriving EXIF; regenerate it with the dataset's build pipeline first."
    }

    Write-Info "Reading EXIF cache: $cachePath"
    $records = Get-Content -Path $cachePath -Raw | ConvertFrom-Json

    $lookup = @{}
    foreach ($record in $records) {
        if (-not $record.ele -or -not $record.file) {
            continue
        }
        $parsed = ConvertFrom-ExifDateTime -Value $record.dt
        if ($null -eq $parsed) {
            continue
        }
        $key = "$($record.ele)/$($record.file)"
        $lookup[$key] = $parsed
    }
    return $lookup
}

# Selects the files for one elephant folder: physically present in
# `<folder>\test\` AND EXIF-dated on/after the cutoff. Returns an array of
# { LocalPath, FileName, CaptureDateIso } -- empty (with a warning) if the
# `test` subfolder is missing rather than throwing, so one folder's dataset
# layout drifting doesn't necessarily abort a run covering other folders.
function Get-PostCutoffTestFiles {
    param(
        [string]$DatasetRoot,
        [string]$Folder,
        [hashtable]$ExifLookup,
        [datetime]$Cutoff
    )

    $testDir = Join-Path $DatasetRoot "$Folder\test"
    if (-not (Test-Path $testDir)) {
        Write-WarningLine "No 'test' subfolder for '$Folder' at '$testDir' -- skipping."
        return @()
    }

    $selected = @()
    foreach ($file in Get-ChildItem -Path $testDir -File) {
        $key = "$Folder/$($file.Name)"
        $captureDate = $ExifLookup[$key]
        if ($null -eq $captureDate) {
            Write-WarningLine "No EXIF date for '$key' -- excluding (cannot prove post-cutoff)."
            continue
        }
        if ($captureDate -lt $Cutoff) {
            continue
        }
        $selected += [pscustomobject]@{
            LocalPath      = $file.FullName
            FileName       = $file.Name
            CaptureDateIso = $captureDate.ToString('yyyy-MM-ddTHH:mm:ss')
        }
    }
    return $selected
}

# ---------------------------------------------------------------------------
# Installed pack index -> stable ID resolution (read straight off the device)
# ---------------------------------------------------------------------------

# Strips a trailing parenthetical annotation and normalizes case and spacing.
function Get-NormalizedIndividualName {
    param([string]$Name)
    if (-not $Name) {
        return $null
    }
    $stripped = $Name -replace '\s*\([^\)]*\)\s*$', ''
    return $stripped.Trim().ToLowerInvariant()
}

# Reads every installed pack's embeddings/index.json directly off the device
# (never hardcoded / never read from app source) and returns a normalized
# individual-name -> stable ID map merged across all installed packs.
function Get-InstalledPackNameIndex {
    param([string]$LocalTempDir)

    $packsRoot = 'files/embedding_packs'
    if (-not (Test-DeviceFileExists -DevicePath $packsRoot)) {
        throw "No installed packs found at '$packsRoot' on the device -- is the debug pack installed?"
    }

    $packDirs = @(Invoke-RunAs -Arguments @('find', $packsRoot, '-mindepth', '1', '-maxdepth', '1', '-type', 'd') |
        Where-Object { $_ -and $_.Trim().Length -gt 0 })

    $nameIndex = @{}
    $individualCount = 0
    foreach ($packDir in $packDirs) {
        $indexFiles = @(Invoke-RunAs -Arguments @('find', $packDir, '-name', 'index.json') |
            Where-Object { $_ -and $_.Trim().Length -gt 0 })

        foreach ($indexFile in $indexFiles) {
            $localCopy = Join-Path $LocalTempDir ([guid]::NewGuid().ToString() + '.json')
            Copy-DeviceFileToLocal -DevicePath $indexFile -LocalPath $localCopy
            $parsed = Get-Content -Path $localCopy -Raw | ConvertFrom-Json
            Remove-Item -Path $localCopy -Force -ErrorAction SilentlyContinue

            foreach ($individual in $parsed.individuals) {
                $individualCount += 1
                $normalized = Get-NormalizedIndividualName -Name $individual.name
                if (-not $normalized) {
                    continue
                }
                if ($nameIndex.ContainsKey($normalized) -and $nameIndex[$normalized] -ne $individual.id) {
                    Write-WarningLine "Ambiguous individual name '$normalized' maps to multiple stable IDs across installed packs; keeping the first match."
                    continue
                }
                $nameIndex[$normalized] = $individual.id
            }
        }
    }

    Write-Info "Resolved $($nameIndex.Count) unique individual names from $individualCount pack entries across $($packDirs.Count) installed pack(s)."
    return $nameIndex
}

# ---------------------------------------------------------------------------
# Manifest construction
# ---------------------------------------------------------------------------

# PowerShell's ConvertTo-Json collapses a single-element array into a bare
# object unless explicitly guarded -- always emit a JSON array here even for
# a 0- or 1-item manifest (e.g. a -DryRun smoke test).
function ConvertTo-JsonArraySafe {
    param([array]$Items, [int]$Depth = 8)
    if ($null -eq $Items -or $Items.Count -eq 0) {
        return '[]'
    }
    $json = ConvertTo-Json -InputObject $Items -Depth $Depth
    if ($Items.Count -eq 1 -and -not $json.TrimStart().StartsWith('[')) {
        return "[$json]"
    }
    return $json
}

function New-GoldenBatchManifest {
    param(
        [string]$RunId,
        [string]$DatasetRoot,
        [string]$CutoffIso,
        [string[]]$KnownElephants,
        [string[]]$UnknownElephants,
        [hashtable]$ExifLookup,
        [hashtable]$PackNameIndex,
        [datetime]$CutoffDate,
        [Nullable[double]]$MatchThreshold
    )

    $items = @()
    $stableIdByFolder = @{}
    $countsByFolder = [ordered]@{}

    foreach ($folder in $KnownElephants) {
        $normalized = Get-NormalizedIndividualName -Name $folder
        if (-not $PackNameIndex.ContainsKey($normalized)) {
            throw "Known elephant '$folder' did not resolve to a stable ID in the installed pack index (normalized: '$normalized'). Refusing to build a manifest with an unresolvable known individual."
        }
        $stableIdByFolder[$folder] = $PackNameIndex[$normalized]
    }
    foreach ($folder in $UnknownElephants) {
        $stableIdByFolder[$folder] = $null
    }

    $allFolders = @($KnownElephants) + @($UnknownElephants)
    foreach ($folder in $allFolders) {
        $knownStatus = if ($KnownElephants -contains $folder) { 'known' } else { 'unknown' }
        $selectedFiles = Get-PostCutoffTestFiles -DatasetRoot $DatasetRoot -Folder $folder -ExifLookup $ExifLookup -Cutoff $CutoffDate
        $countsByFolder[$folder] = $selectedFiles.Count

        foreach ($selected in $selectedFiles) {
            $items += [pscustomobject]@{
                LocalPath      = $selected.LocalPath
                # Must match the actual on-device staging layout produced by
                # Send-StagedFiles: files/batch/staged/<RunId>/<folder>/<file>.
                # The production evaluator resolves stagedPath relative to
                # files/batch/staged/ directly, so the RunId segment must be
                # included here or every item fails with "Staged file not found".
                stagedPath     = "$RunId/$folder/$($selected.FileName)"
                expectedFolder = $folder
                expectedName   = $selected.FileName
                expectedStableId = $stableIdByFolder[$folder]
                knownStatus    = $knownStatus
                captureDateIso = $selected.CaptureDateIso
                cutoffIso      = $CutoffIso
            }
        }
    }

    if ($items.Count -eq 0) {
        throw 'No post-cutoff test files were selected for any configured folder -- refusing to build an empty manifest.'
    }

    Write-Info 'Selected post-cutoff test files by folder:'
    foreach ($folder in $countsByFolder.Keys) {
        Write-Info "  $folder`: $($countsByFolder[$folder])"
    }
    Write-Info "  TOTAL: $($items.Count)"

    $request = [ordered]@{
        formatVersion = '1'
        runId         = $RunId
        createdAt     = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        items         = @($items | ForEach-Object {
            [ordered]@{
                stagedPath        = $_.stagedPath
                expectedFolder    = $_.expectedFolder
                expectedName      = $_.expectedName
                expectedStableId  = $_.expectedStableId
                knownStatus       = $_.knownStatus
                captureDateIso    = $_.captureDateIso
                cutoffIso         = $_.cutoffIso
            }
        })
    }
    if ($PSBoundParameters.ContainsKey('MatchThreshold') -and $null -ne $MatchThreshold) {
        $request['matchThreshold'] = $MatchThreshold
    }

    return [pscustomobject]@{
        Request = $request
        Items   = $items # includes LocalPath, needed for staging
    }
}

# ---------------------------------------------------------------------------
# Device staging / trigger / poll / pull
# ---------------------------------------------------------------------------

# Mirrors only the selected files into a local temp tree of
# "<folder>/<fileName>", then pushes that whole tree in one `adb push` and
# copies it into the app-private staging dir in one `run-as cp -r`.
function Send-StagedFiles {
    param(
        [array]$Items,
        [string]$RunId,
        [string]$LocalStageRoot,
        [string]$DeviceTmpDir
    )

    if (Test-Path $LocalStageRoot) {
        Remove-Item -Path $LocalStageRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $LocalStageRoot -Force | Out-Null

    foreach ($item in $Items) {
        $destDir = Join-Path $LocalStageRoot $item.expectedFolder
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -Path $item.LocalPath -Destination (Join-Path $destDir $item.expectedName) -Force
    }

    Write-Info "Pushing $($Items.Count) staged file(s) to device:$DeviceTmpDir ..."
    Invoke-Adb -Arguments @('shell', 'rm', '-rf', $DeviceTmpDir) | Out-Null
    Invoke-Adb -Arguments @('push', $LocalStageRoot, $DeviceTmpDir) | Out-Null

    Invoke-RunAs -Arguments @('mkdir', '-p', "files/batch/staged/$RunId") | Out-Null
    Invoke-RunAs -Arguments @('cp', '-r', "$DeviceTmpDir/.", "files/batch/staged/$RunId") | Out-Null

    # The intermediate world-readable copy in /data/local/tmp is cleaned up
    # immediately -- only the app-private copy under files/batch/staged/
    # needs to survive until the run consumes it.
    Invoke-Adb -Arguments @('shell', 'rm', '-rf', $DeviceTmpDir) | Out-Null
}

function Send-RunRequest {
    param([string]$RunId, [string]$RequestJson, [string]$LocalTempDir, [string]$DeviceTmpDir)

    $localRequestPath = Join-Path $LocalTempDir 'request.json'
    Write-Utf8NoBom -Path $localRequestPath -Value $RequestJson

    Invoke-Adb -Arguments @('push', $localRequestPath, "$DeviceTmpDir/request.json") | Out-Null
    Invoke-RunAs -Arguments @('cp', "$DeviceTmpDir/request.json", 'files/batch/request.json') | Out-Null
    Invoke-Adb -Arguments @('shell', 'rm', '-f', "$DeviceTmpDir/request.json") | Out-Null
}

# The evaluator only ever checks for a request on app startup (no persistent
# watcher), so a fresh process must be forced for the trigger to be seen.
function Start-AppFresh {
    Invoke-Adb -Arguments @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 1
    Invoke-Adb -Arguments @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
}

# Bounded poll of status.json. Returns the final parsed status object.
# Throws on timeout (callers still get a chance to pull whatever partial
# results exist in a `finally` block before this propagates).
function Wait-ForRunCompletion {
    param([string]$RunId, [int]$TimeoutSeconds, [int]$PollIntervalSeconds, [string]$LocalTempDir)

    $statusDevicePath = "files/batch/results/$RunId/status.json"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastState = $null

    while ((Get-Date) -lt $deadline) {
        if (Test-DeviceFileExists -DevicePath $statusDevicePath) {
            $localStatusPath = Join-Path $LocalTempDir 'status-poll.json'
            try {
                Copy-DeviceFileToLocal -DevicePath $statusDevicePath -LocalPath $localStatusPath
                $status = Get-Content -Path $localStatusPath -Raw | ConvertFrom-Json
                if ($status.state -ne $lastState) {
                    Write-Info "Run '$RunId' status: $($status.state) ($($status.processedItems)/$($status.totalItems) processed, $($status.errorItems) item error(s))"
                    $lastState = $status.state
                }
                if ($status.state -eq 'completed' -or $status.state -eq 'failed') {
                    return $status
                }
            } catch {
                Write-WarningLine "Transient error reading status.json, retrying: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds $PollIntervalSeconds
    }

    throw "Timed out after $TimeoutSeconds second(s) waiting for run '$RunId' to complete."
}

function Receive-RunResults {
    param([string]$RunId, [string]$OutputDir)

    $runOutputDir = Join-Path $OutputDir $RunId
    New-Item -ItemType Directory -Path $runOutputDir -Force | Out-Null

    $files = @('status.json', 'detections.jsonl', 'summary.csv', 'run-metadata.json', 'request.json')
    foreach ($file in $files) {
        $devicePath = "files/batch/results/$RunId/$file"
        if (Test-DeviceFileExists -DevicePath $devicePath) {
            Copy-DeviceFileToLocal -DevicePath $devicePath -LocalPath (Join-Path $runOutputDir $file)
            Write-Info "Pulled $file -> $runOutputDir\$file"
        } else {
            Write-WarningLine "Expected result file '$file' was not present on the device for run '$RunId'."
        }
    }
    return $runOutputDir
}

function Remove-DeviceStaging {
    param([string]$RunId)
    Invoke-RunAs -Arguments @('rm', '-rf', "files/batch/staged/$RunId") | Out-Null
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if (-not $DryRun -and [string]::IsNullOrWhiteSpace($DeviceSerial)) {
    throw 'DeviceSerial is required unless DryRun is selected.'
}

if (-not $RunId) {
    $RunId = "golden-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
}
Assert-SafeRunId -Value $RunId
Assert-SafeAndroidPackage -Value $Package

if (-not (Test-Path $DatasetRoot)) {
    throw "DatasetRoot '$DatasetRoot' does not exist."
}
$cutoffDate = [datetime]::Parse($CutoffIso, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal)

$localTempDir = Join-Path ([System.IO.Path]::GetTempPath()) "golden-batch-$RunId"
New-Item -ItemType Directory -Path $localTempDir -Force | Out-Null
$localStageRoot = Join-Path $localTempDir 'staged'
$deviceTmpDir = "/data/local/tmp/golden-batch-$RunId"

Write-Info "Run ID: $RunId"
Write-Info "Dataset root: $DatasetRoot"
Write-Info "Cutoff (inclusive): $($cutoffDate.ToString('u'))"

$terminalStatusReached = $false
try {
    $exifLookup = Read-ExifAllCache -DatasetRoot $DatasetRoot

    if (-not $DryRun) {
        Write-Info "Checking adb device '$DeviceSerial' is connected..."
        $devices = Invoke-Adb -Arguments @('devices')
        if (-not ($devices -match [regex]::Escape($DeviceSerial))) {
            throw "Device '$DeviceSerial' not found in 'adb devices' output."
        }
    }

    $packNameIndex = if ($DryRun) {
        # In a dry run we still want to validate known-elephant resolution
        # end-to-end without requiring a connected device, so allow the
        # caller to skip pack resolution only when no device is reachable.
        try {
            Get-InstalledPackNameIndex -LocalTempDir $localTempDir
        } catch {
            Write-WarningLine "Could not resolve installed pack index for dry run (no device?): $($_.Exception.Message)"
            @{}
        }
    } else {
        Get-InstalledPackNameIndex -LocalTempDir $localTempDir
    }

    $manifestArgs = @{
        RunId            = $RunId
        DatasetRoot      = $DatasetRoot
        CutoffIso        = $CutoffIso
        KnownElephants   = $KnownElephants
        UnknownElephants = $UnknownElephants
        ExifLookup       = $exifLookup
        PackNameIndex    = $packNameIndex
        CutoffDate       = $cutoffDate
    }
    if ($PSBoundParameters.ContainsKey('MatchThreshold')) {
        $manifestArgs['MatchThreshold'] = $MatchThreshold
    }
    $manifest = New-GoldenBatchManifest @manifestArgs
    $requestJson = ConvertTo-Json -InputObject $manifest.Request -Depth 8

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    $localManifestPath = Join-Path $OutputDir "$RunId.manifest.json"
    if (Test-Path $localManifestPath) {
        throw "Refusing to reuse run '$RunId': local manifest already exists."
    }
    Write-Utf8NoBom -Path $localManifestPath -Value $requestJson
    Write-Info "Manifest written locally to $localManifestPath"

    if ($DryRun) {
        Write-Info 'Dry run requested -- stopping before any device interaction.'
        return
    }

    $existingDevicePaths = @(
        'files/batch/request.json',
        "files/batch/staged/$RunId",
        "files/batch/results/$RunId"
    )
    foreach ($existingPath in $existingDevicePaths) {
        if (Test-DeviceFileExists -DevicePath $existingPath) {
            throw "Refusing to reuse run '$RunId': device path '$existingPath' already exists."
        }
    }
    if (Test-Path (Join-Path $OutputDir $RunId)) {
        throw "Refusing to reuse run '$RunId': local output directory already exists."
    }

    Send-StagedFiles -Items $manifest.Items -RunId $RunId -LocalStageRoot $localStageRoot -DeviceTmpDir $deviceTmpDir
    Send-RunRequest -RunId $RunId -RequestJson $requestJson -LocalTempDir $localTempDir -DeviceTmpDir $deviceTmpDir

    Write-Info "Launching '$Package' to trigger the one-shot evaluator run..."
    Start-AppFresh

    $finalStatus = $null
    try {
        $finalStatus = Wait-ForRunCompletion -RunId $RunId -TimeoutSeconds $TimeoutSeconds -PollIntervalSeconds $PollIntervalSeconds -LocalTempDir $localTempDir
        $terminalStatusReached = $true
    } finally {
        # Pull whatever exists even on timeout/failure so partial progress
        # (per the evaluator's incremental-flush design) is never lost.
        $runOutputDir = Receive-RunResults -RunId $RunId -OutputDir $OutputDir
    }

    if ($finalStatus.state -eq 'failed') {
        Write-WarningLine "Run '$RunId' FAILED: $($finalStatus.lastError)"
        Write-Info "Partial results (if any) were pulled to $runOutputDir"
        exit 1
    }

    Write-Info "Run '$RunId' completed. Results pulled to $runOutputDir"
    $metadataPath = Join-Path $runOutputDir 'run-metadata.json'
    if (Test-Path $metadataPath) {
        $metadata = Get-Content -Path $metadataPath -Raw | ConvertFrom-Json
        Write-Info 'Summary:'
        $metadata.summary.PSObject.Properties | ForEach-Object {
            Write-Info "  $($_.Name): $($_.Value)"
        }
    }
} finally {
    if (-not $DryRun -and -not $KeepDeviceStaging -and $terminalStatusReached) {
        try {
            Remove-DeviceStaging -RunId $RunId
            Write-Info "Cleaned up device staging directory files/batch/staged/$RunId"
        } catch {
            Write-WarningLine "Failed to clean up device staging directory: $($_.Exception.Message)"
        }
    } elseif (-not $DryRun -and -not $KeepDeviceStaging -and -not $terminalStatusReached) {
        Write-WarningLine "Run did not reach a terminal status; leaving device staging intact to avoid corrupting a still-running evaluator."
    }
    if (Test-Path $localTempDir) {
        Remove-Item -Path $localTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
