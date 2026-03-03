param(
    [string]$ManifestPath = "dispatch/file-manifests.json",
    [string]$StagingRoot = "staging",
    [string]$HarvestRoot = "staging/_harvest",
    [string[]]$Specialists = @(),
    [string]$ResponseFileName = "response.md",
    [string]$CycleId,
    [switch]$AllowEmptyResponses,
    [switch]$KeepStagingResponses
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-FullPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $Path))
}

function Relative-Path {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    $baseFull = [System.IO.Path]::GetFullPath($BaseDir)
    $pathFull = [System.IO.Path]::GetFullPath($Path)

    if ($pathFull.StartsWith($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $pathFull.Substring($baseFull.Length).TrimStart('\', '/')
        if ([string]::IsNullOrWhiteSpace($relative)) {
            return "."
        }

        return $relative -replace "\\", "/"
    }

    return $pathFull
}

$cwd = (Get-Location).Path
$manifestFullPath = Resolve-FullPath -Path $ManifestPath -BaseDir $cwd

if (-not (Test-Path -LiteralPath $manifestFullPath -PathType Leaf)) {
    throw "Manifest not found: $manifestFullPath"
}

$manifestDir = Split-Path -Parent $manifestFullPath
$manifest = Get-Content -LiteralPath $manifestFullPath -Raw | ConvertFrom-Json

if (-not $manifest.specialists) {
    throw "Manifest is missing 'specialists'."
}

$availableSpecialists = @($manifest.specialists.PSObject.Properties.Name)

$normalizedSpecialists = @()
foreach ($specialistEntry in $Specialists) {
    foreach ($token in ([string]$specialistEntry -split ",")) {
        $name = $token.Trim()
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $normalizedSpecialists += $name
        }
    }
}

if ($normalizedSpecialists.Count -eq 0) {
    $normalizedSpecialists = $availableSpecialists
}

$Specialists = $normalizedSpecialists

foreach ($specialist in $Specialists) {
    if ($availableSpecialists -notcontains $specialist) {
        throw "Specialist '$specialist' not found in manifest. Available: $($availableSpecialists -join ', ')"
    }
}

$stagingRootFullPath = Resolve-FullPath -Path $StagingRoot -BaseDir $cwd
if (-not (Test-Path -LiteralPath $stagingRootFullPath -PathType Container)) {
    throw "Staging root does not exist: $stagingRootFullPath"
}

$harvestRootFullPath = Resolve-FullPath -Path $HarvestRoot -BaseDir $cwd
if (-not (Test-Path -LiteralPath $harvestRootFullPath -PathType Container)) {
    New-Item -ItemType Directory -Path $harvestRootFullPath -Force | Out-Null
}

$cyclesRoot = Join-Path $harvestRootFullPath "cycles"
if (-not (Test-Path -LiteralPath $cyclesRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $cyclesRoot -Force | Out-Null
}

if ([string]::IsNullOrWhiteSpace($CycleId)) {
    $CycleId = Get-Date -Format "yyyyMMdd-HHmmss"
}

$existingCycleDirs = Get-ChildItem -LiteralPath $cyclesRoot -Directory | Sort-Object Name
$completedCycleDirs = $existingCycleDirs | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName "HARVEST_SUMMARY.md") -PathType Leaf
}
$previousCycleDir = $completedCycleDirs | Select-Object -Last 1

$cycleDir = Join-Path $cyclesRoot $CycleId
if (Test-Path -LiteralPath $cycleDir -PathType Container) {
    throw "Cycle directory already exists: $cycleDir"
}

New-Item -ItemType Directory -Path $cycleDir -Force | Out-Null
$responsesDir = Join-Path $cycleDir "responses"
$diffsDir = Join-Path $cycleDir "diffs"
New-Item -ItemType Directory -Path $responsesDir -Force | Out-Null
New-Item -ItemType Directory -Path $diffsDir -Force | Out-Null

$latestDir = Join-Path $harvestRootFullPath "latest"
if (-not (Test-Path -LiteralPath $latestDir -PathType Container)) {
    New-Item -ItemType Directory -Path $latestDir -Force | Out-Null
}

$gitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)

$summaryRows = @()
$stagingResponses = @()
foreach ($specialist in $Specialists) {
    $responsePath = Join-Path (Join-Path $stagingRootFullPath $specialist) $ResponseFileName
    if (-not (Test-Path -LiteralPath $responsePath -PathType Leaf)) {
        throw "Missing response file for '$specialist': $responsePath"
    }

    $responseContent = Get-Content -LiteralPath $responsePath -Raw
    $responseContentNormalized = ($responseContent -replace "`r`n", "`n").Trim()
    $responseTemplateNormalized = @(
        "<!-- response-template -->"
        "# $specialist Review Response"
        ""
        "Paste the full specialist output in markdown format."
    ) -join "`n"

    if (-not $AllowEmptyResponses -and [string]::IsNullOrWhiteSpace($responseContentNormalized)) {
        throw "Response file is empty for '$specialist': $responsePath"
    }

    if (-not $AllowEmptyResponses -and $responseContentNormalized -eq $responseTemplateNormalized.Trim()) {
        throw "Response file for '$specialist' still contains the untouched template: $responsePath"
    }

    $stagingResponses += [PSCustomObject]@{
        Specialist = $specialist
        Path = $responsePath
    }

    $archivedResponsePath = Join-Path $responsesDir "$specialist.md"
    Set-Content -LiteralPath $archivedResponsePath -Value $responseContent -Encoding UTF8

    $latestResponsePath = Join-Path $latestDir "$specialist.md"
    Set-Content -LiteralPath $latestResponsePath -Value $responseContent -Encoding UTF8

    $status = "new"
    $diffPath = Join-Path $diffsDir "$specialist.diff"
    $previousResponsePath = $null
    if ($previousCycleDir) {
        $candidate = Join-Path (Join-Path $previousCycleDir.FullName "responses") "$specialist.md"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $previousResponsePath = $candidate
        }
    }

    if ($previousResponsePath) {
        if ($gitAvailable) {
            $gitCommandLine = 'git --no-pager -c core.safecrlf=false -c core.autocrlf=false diff --no-index -- "{0}" "{1}" 2>&1' -f $previousResponsePath, $archivedResponsePath
            $diffOutput = & cmd /c $gitCommandLine
            $diffExitCode = $LASTEXITCODE
            $diffText = if ($diffOutput -is [System.Array]) { $diffOutput -join "`n" } else { [string]$diffOutput }
            if ($diffExitCode -gt 1) {
                throw "git diff failed for '$specialist' with exit code $diffExitCode.`n$diffText"
            }

            if ($diffExitCode -eq 1) {
                $status = "changed"
                Set-Content -LiteralPath $diffPath -Value $diffText -Encoding UTF8
            }
            else {
                $status = "unchanged"
                Set-Content -LiteralPath $diffPath -Value "No changes detected." -Encoding UTF8
            }
        }
        else {
            $previousLines = Get-Content -LiteralPath $previousResponsePath
            $currentLines = Get-Content -LiteralPath $archivedResponsePath
            $lineDiff = Compare-Object -ReferenceObject $previousLines -DifferenceObject $currentLines
            if ($lineDiff.Count -gt 0) {
                $status = "changed"
                $lineDiff | ForEach-Object {
                    "{0} {1}" -f $_.SideIndicator, $_.InputObject
                } | Set-Content -LiteralPath $diffPath -Encoding UTF8
            }
            else {
                $status = "unchanged"
                Set-Content -LiteralPath $diffPath -Value "No changes detected." -Encoding UTF8
            }
        }
    }
    else {
        Set-Content -LiteralPath $diffPath -Value "No previous cycle response available for '$specialist'." -Encoding UTF8
    }

    $summaryRows += [PSCustomObject]@{
        Specialist = $specialist
        Response = Relative-Path -Path $archivedResponsePath -BaseDir $cwd
        Diff = Relative-Path -Path $diffPath -BaseDir $cwd
        Status = $status
    }
}

$summaryPath = Join-Path $cycleDir "HARVEST_SUMMARY.md"
$summaryLines = @(
    "# Inbound Harvest - $CycleId",
    "",
    "- Harvest timestamp: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")",
    "- Cycle directory: $(Relative-Path -Path $cycleDir -BaseDir $cwd)",
    "- Previous cycle: $(if ($previousCycleDir) { $previousCycleDir.Name } else { "none" })",
    "",
    "## Specialist Responses",
    "",
    "| Specialist | Status | Archived Response | Diff vs Previous |",
    "|---|---|---|---|"
)

foreach ($row in $summaryRows) {
    $summaryLines += "| $($row.Specialist) | $($row.Status) | $($row.Response) | $($row.Diff) |"
}

$summaryLines | Set-Content -LiteralPath $summaryPath -Encoding UTF8

if (-not $KeepStagingResponses) {
    foreach ($stagingResponse in $stagingResponses) {
        $template = @(
            "<!-- response-template -->"
            "# $($stagingResponse.Specialist) Review Response"
            ""
            "Paste the full specialist output in markdown format."
        ) -join "`n"

        Set-Content -LiteralPath $stagingResponse.Path -Value $template -Encoding UTF8
    }
}

Write-Host "Harvested $($summaryRows.Count) specialist response(s) into '$cycleDir'."
Write-Host "Summary: $summaryPath"
Write-Host "Latest responses: $latestDir"
if (-not $KeepStagingResponses) {
    Write-Host "Reset staging response templates for: $($Specialists -join ', ')"
}
