param(
    [string]$ManifestPath = "dispatch/file-manifests.json",
    [string]$StagingRoot = "staging",
    [string[]]$Specialists = @("gemini", "chatgpt", "deepseek", "grok"),
    [switch]$AllowResponseDiscard
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

$sourceRootValue = if ($manifest.source_root) { [string]$manifest.source_root } else { "." }
$sourceRoot = Resolve-FullPath -Path $sourceRootValue -BaseDir $manifestDir

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Source root does not exist: $sourceRoot"
}

$stagingRootFullPath = Resolve-FullPath -Path $StagingRoot -BaseDir $cwd
if (-not (Test-Path -LiteralPath $stagingRootFullPath -PathType Container)) {
    New-Item -ItemType Directory -Path $stagingRootFullPath | Out-Null
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
    throw "No specialists requested."
}

foreach ($specialist in $normalizedSpecialists) {
    $specialistProperty = $manifest.specialists.PSObject.Properties | Where-Object { $_.Name -eq $specialist } | Select-Object -First 1
    if (-not $specialistProperty) {
        throw "Specialist '$specialist' not found in manifest. Available: $($availableSpecialists -join ', ')"
    }

    $specialistConfig = $specialistProperty.Value
    $promptPathValue = if ($specialistConfig.prompt_path) { [string]$specialistConfig.prompt_path } else { "prompts/$specialist.md" }
    $promptFullPath = Resolve-FullPath -Path $promptPathValue -BaseDir $manifestDir

    if (-not (Test-Path -LiteralPath $promptFullPath -PathType Leaf)) {
        throw "Prompt file not found for '$specialist': $promptFullPath"
    }

    $specialistStageDir = Join-Path $stagingRootFullPath $specialist
    if (Test-Path -LiteralPath $specialistStageDir -PathType Container) {
        $existingResponsePath = Join-Path $specialistStageDir "response.md"
        if (-not $AllowResponseDiscard -and (Test-Path -LiteralPath $existingResponsePath -PathType Leaf)) {
            $existingResponseRaw = Get-Content -LiteralPath $existingResponsePath -Raw
            $existingResponseNormalized = ($existingResponseRaw -replace "`r`n", "`n").Trim()
            $responseTemplateNormalized = @(
                "<!-- response-template -->"
                "# $specialist Review Response"
                ""
                "Paste the full specialist output in markdown format."
            ) -join "`n"

            if (-not [string]::IsNullOrWhiteSpace($existingResponseNormalized) -and $existingResponseNormalized -ne $responseTemplateNormalized.Trim()) {
                throw "Existing response file for '$specialist' would be deleted: $existingResponsePath. Run scripts/harvest-responses.ps1 first, or rerun with -AllowResponseDiscard."
            }
        }

        Remove-Item -LiteralPath $specialistStageDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $specialistStageDir | Out-Null

    Copy-Item -LiteralPath $promptFullPath -Destination (Join-Path $specialistStageDir "PROMPT.md") -Force

    $copiedCount = 0
    $geminiTxtMirrorCount = 0
    $stagedEntries = @("PROMPT.md")
    $manifestFiles = @($specialistConfig.files)

    foreach ($relativeFile in $manifestFiles) {
        $relativeFileText = [string]$relativeFile
        if ([string]::IsNullOrWhiteSpace($relativeFileText)) {
            continue
        }

        $normalizedRelativePath = $relativeFileText -replace "/", [System.IO.Path]::DirectorySeparatorChar
        $sourceFilePath = Resolve-FullPath -Path $normalizedRelativePath -BaseDir $sourceRoot

        if (-not (Test-Path -LiteralPath $sourceFilePath -PathType Leaf)) {
            throw "Missing source file for '$specialist': $normalizedRelativePath (resolved to $sourceFilePath)"
        }

        $destinationFilePath = Join-Path $specialistStageDir $normalizedRelativePath
        $destinationDir = Split-Path -Parent $destinationFilePath
        if (-not (Test-Path -LiteralPath $destinationDir -PathType Container)) {
            New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        }

        Copy-Item -LiteralPath $sourceFilePath -Destination $destinationFilePath -Force
        $copiedCount++
        $stagedEntries += $normalizedRelativePath

        if ($specialist -eq "gemini" -and $specialistConfig.create_r_txt_copies -and ([System.IO.Path]::GetExtension($sourceFilePath) -ieq ".R")) {
            $txtMirrorPath = "$destinationFilePath.txt"
            Copy-Item -LiteralPath $sourceFilePath -Destination $txtMirrorPath -Force
            $geminiTxtMirrorCount++
            $stagedEntries += "$normalizedRelativePath.txt"
        }
    }

    $responseTemplateContent = @(
        "<!-- response-template -->"
        "# $specialist Review Response"
        ""
        "Paste the full specialist output in markdown format."
    ) -join "`n"
    Set-Content -LiteralPath (Join-Path $specialistStageDir "response.md") -Value $responseTemplateContent -Encoding UTF8
    $stagedEntries += "response.md"

    $stagedEntries | Set-Content -LiteralPath (Join-Path $specialistStageDir "STAGED_FILES.txt") -Encoding UTF8

    if ($manifestFiles.Count -eq 0) {
        Write-Warning "No files listed for '$specialist'. Staged PROMPT.md + response.md only."
    }

    Write-Host "[$specialist] staged $copiedCount source file(s) + PROMPT.md + response.md in $specialistStageDir"
    if ($geminiTxtMirrorCount -gt 0) {
        Write-Host "[$specialist] created $geminiTxtMirrorCount Gemini .R.txt mirror file(s)"
    }
}

Write-Host "Done. Drag each specialist's staged files from '$stagingRootFullPath' into the corresponding web UI upload zone."
