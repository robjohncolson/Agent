param(
    [Parameter(Mandatory = $true)][string]$TaskDescription,
    [string]$TaskType,
    [ValidateSet("review", "audit", "brainstorm")][string]$TaskMode,
    [int]$TopN = 3,
    [double]$MinScore = 0.35,
    [switch]$IncludeTerminalSpecialists,
    [string]$SourceRoot = ".",
    [string]$ProfilesDir = "profiles",
    [string]$RoutingConfigPath = "dispatch/routing-rules.json",
    [string]$TemplateConfigPath = "dispatch/prompt-templates.json",
    [string]$ManifestOutPath = "dispatch/file-manifests.generated.json",
    [string]$PlanOutPath = "dispatch/routing-plan.generated.json",
    [string]$PromptOutputDir = "dispatch/generated-prompts"
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

function Get-RelativePathString {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$TargetPath
    )

    $baseFull = [System.IO.Path]::GetFullPath($BasePath)
    $targetFull = [System.IO.Path]::GetFullPath($TargetPath)

    $separator = [string][System.IO.Path]::DirectorySeparatorChar
    if (-not $baseFull.EndsWith($separator)) {
        $baseFull = "$baseFull$separator"
    }
    if ((Test-Path -LiteralPath $targetFull -PathType Container) -and (-not $targetFull.EndsWith($separator))) {
        $targetFull = "$targetFull$separator"
    }

    $baseUri = New-Object System.Uri($baseFull)
    $targetUri = New-Object System.Uri($targetFull)
    $relativeUri = $baseUri.MakeRelativeUri($targetUri)
    $relativePath = [System.Uri]::UnescapeDataString($relativeUri.ToString())
    return ($relativePath -replace "/", [System.IO.Path]::DirectorySeparatorChar)
}

function Get-MapValue {
    param(
        [Parameter(Mandatory = $false)]$Map,
        [Parameter(Mandatory = $true)][string]$Key
    )

    if ($null -eq $Map) {
        return $null
    }

    if ($Map -is [System.Collections.IDictionary]) {
        if ($Map.Contains($Key)) {
            return $Map[$Key]
        }
        return $null
    }

    $prop = $Map.PSObject.Properties | Where-Object { $_.Name -eq $Key } | Select-Object -First 1
    if ($null -eq $prop) {
        return $null
    }
    return $prop.Value
}

function Convert-ToStringArray {
    param([Parameter(Mandatory = $false)]$Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return @()
        }
        return @($Value)
    }

    return @(
        $Value |
            ForEach-Object { [string]$_ } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}

function Normalize-Text {
    param([Parameter(Mandatory = $false)][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }
    return $Value.ToLowerInvariant()
}

function Merge-UniqueStrings {
    param([object[]]$Collections = @())

    if ($null -eq $Collections) {
        return @()
    }

    $set = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($collection in $Collections) {
        foreach ($item in (Convert-ToStringArray -Value $collection)) {
            $normalized = ($item -replace "\\", "/").Trim()
            if ([string]::IsNullOrWhiteSpace($normalized)) {
                continue
            }
            $null = $set.Add($normalized)
        }
    }

    return @($set | Sort-Object)
}

function Test-AnyWildcardMatch {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Patterns
    )

    if ($Patterns.Count -eq 0) {
        return $false
    }

    foreach ($pattern in $Patterns) {
        if ([string]::IsNullOrWhiteSpace($pattern)) {
            continue
        }
        if ($Path -like $pattern) {
            return $true
        }
    }

    return $false
}

function Get-TermOverlapScore {
    param(
        [Parameter(Mandatory = $true)][string]$Term,
        [Parameter(Mandatory = $true)][string]$TaskText
    )

    $normalizedTerm = Normalize-Text -Value $Term
    if ([string]::IsNullOrWhiteSpace($normalizedTerm)) {
        return 0.0
    }

    if ($TaskText.Contains($normalizedTerm)) {
        return 1.0
    }

    $tokens = @(
        $normalizedTerm -split "[^a-z0-9]+" |
            Where-Object { $_.Length -ge 3 }
    )

    if ($tokens.Count -eq 0) {
        return 0.0
    }

    $matchCount = 0
    foreach ($token in $tokens) {
        if ($TaskText.Contains($token)) {
            $matchCount++
        }
    }

    return ($matchCount / [double]$tokens.Count)
}

function Resolve-TaskType {
    param(
        [Parameter(Mandatory = $false)][string]$ExplicitTaskType,
        [Parameter(Mandatory = $true)][string]$Description,
        [Parameter(Mandatory = $true)]$Config
    )

    $taskTypeMap = Get-MapValue -Map $Config -Key "task_types"
    if ($null -eq $taskTypeMap) {
        throw "Routing config is missing 'task_types'."
    }

    $knownTaskTypes = @($taskTypeMap.PSObject.Properties.Name)
    if (-not [string]::IsNullOrWhiteSpace($ExplicitTaskType)) {
        if ($knownTaskTypes -notcontains $ExplicitTaskType) {
            throw "Unknown task type '$ExplicitTaskType'. Available values: $($knownTaskTypes -join ', ')"
        }
        return $ExplicitTaskType
    }

    $text = Normalize-Text -Value $Description
    $bestType = "general-review"
    $bestScore = -1

    foreach ($taskTypeProp in $taskTypeMap.PSObject.Properties) {
        $taskTypeName = [string]$taskTypeProp.Name
        $rule = $taskTypeProp.Value
        $keywords = Convert-ToStringArray -Value (Get-MapValue -Map $rule -Key "keywords")

        $score = 0
        foreach ($keyword in $keywords) {
            if ($text.Contains((Normalize-Text -Value $keyword))) {
                $score++
            }
        }

        if ($score -gt $bestScore) {
            $bestType = $taskTypeName
            $bestScore = $score
        }
    }

    if ($bestScore -le 0) {
        return "general-review"
    }

    return $bestType
}

function Resolve-TaskMode {
    param(
        [Parameter(Mandatory = $false)][string]$ExplicitTaskMode,
        [Parameter(Mandatory = $true)][string]$Description,
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$TaskRule
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitTaskMode)) {
        return $ExplicitTaskMode
    }

    $text = Normalize-Text -Value $Description
    $modeMap = Get-MapValue -Map $Config -Key "task_mode_inference"
    $bestMode = ""
    $bestScore = -1

    foreach ($modeProp in $modeMap.PSObject.Properties) {
        $modeName = [string]$modeProp.Name
        $keywords = Convert-ToStringArray -Value $modeProp.Value
        $score = 0
        foreach ($keyword in $keywords) {
            if ($text.Contains((Normalize-Text -Value $keyword))) {
                $score++
            }
        }
        if ($score -gt $bestScore) {
            $bestMode = $modeName
            $bestScore = $score
        }
    }

    if ($bestScore -le 0) {
        $defaultMode = [string](Get-MapValue -Map $TaskRule -Key "default_mode")
        if (-not [string]::IsNullOrWhiteSpace($defaultMode)) {
            return $defaultMode
        }
        return "review"
    }

    return $bestMode
}

function Get-DispatchKeyFromProfileId {
    param(
        [Parameter(Mandatory = $true)][string]$ProfileId,
        [Parameter(Mandatory = $false)]$AliasMap
    )

    $alias = Get-MapValue -Map $AliasMap -Key $ProfileId
    if ($null -ne $alias -and -not [string]::IsNullOrWhiteSpace([string]$alias)) {
        return [string]$alias
    }

    return $ProfileId
}

function Get-ProfileIdFromDispatchKey {
    param(
        [Parameter(Mandatory = $true)][string]$DispatchKey,
        [Parameter(Mandatory = $false)]$AliasMap,
        [Parameter(Mandatory = $true)][string[]]$KnownProfileIds
    )

    foreach ($profileId in $KnownProfileIds) {
        $alias = Get-DispatchKeyFromProfileId -ProfileId $profileId -AliasMap $AliasMap
        if ($alias -eq $DispatchKey) {
            return $profileId
        }
    }

    if ($KnownProfileIds -contains $DispatchKey) {
        return $DispatchKey
    }

    return $null
}

function Get-ProfileScore {
    param(
        [Parameter(Mandatory = $true)]$Profile,
        [Parameter(Mandatory = $true)][string]$DispatchKey,
        [Parameter(Mandatory = $true)][string]$TaskTypeName,
        [Parameter(Mandatory = $true)][string]$TaskText,
        [Parameter(Mandatory = $true)]$TaskRule
    )

    $profileId = [string]$Profile.id
    $profileType = [string]$Profile.type

    $fitMap = Get-MapValue -Map $TaskRule -Key "specialist_fit"
    $ruleFit = 0.2
    $fitValue = Get-MapValue -Map $fitMap -Key $profileId
    if ($null -eq $fitValue) {
        $fitValue = Get-MapValue -Map $fitMap -Key $DispatchKey
    }
    if ($null -ne $fitValue) {
        $ruleFit = [double]$fitValue
    }

    $bestForTerms = Convert-ToStringArray -Value $Profile.best_for
    $bestForScore = 0.0
    foreach ($term in $bestForTerms) {
        $termScore = Get-TermOverlapScore -Term $term -TaskText $TaskText
        if ($termScore -gt $bestForScore) {
            $bestForScore = $termScore
        }
    }

    $avoidTerms = Convert-ToStringArray -Value $Profile.avoid_for
    $avoidScore = 0.0
    foreach ($term in $avoidTerms) {
        $termScore = Get-TermOverlapScore -Term $term -TaskText $TaskText
        if ($termScore -gt $avoidScore) {
            $avoidScore = $termScore
        }
    }

    $strengthConfidence = 0.0
    $evidenceScore = 0.0
    $topStrength = ""
    $topStrengthConfidence = 0.0

    $strengths = @($Profile.strengths)
    if ($strengths.Count -gt 0) {
        $sortedStrengths = @(
            $strengths |
                Sort-Object -Property @{ Expression = { [double]$_.confidence }; Descending = $true }
        )
        $takeCount = [Math]::Min(3, $sortedStrengths.Count)

        $confidenceSum = 0.0
        $observationSum = 0.0
        for ($i = 0; $i -lt $takeCount; $i++) {
            $confidenceSum += [double]$sortedStrengths[$i].confidence
            $observationCount = Get-MapValue -Map $sortedStrengths[$i] -Key "observation_count"
            if ($null -ne $observationCount) {
                $observationSum += [double]$observationCount
            }
        }

        $strengthConfidence = $confidenceSum / [double]$takeCount
        $evidenceScore = [Math]::Min(1.0, (($observationSum / [double]$takeCount) / 3.0))

        $topStrength = [string](Get-MapValue -Map $sortedStrengths[0] -Key "trait")
        $topStrengthConfidence = [double](Get-MapValue -Map $sortedStrengths[0] -Key "confidence")
    }

    $rawScore = (0.55 * $ruleFit) + (0.25 * $bestForScore) + (0.20 * $strengthConfidence)
    $confidenceWeighted = $rawScore * (0.85 + (0.15 * $evidenceScore))
    $confidenceWeighted = $confidenceWeighted - (0.50 * $avoidScore)
    $finalScore = [Math]::Max(0.0, [Math]::Min(1.0, $confidenceWeighted))

    $rationale = New-Object "System.Collections.Generic.List[string]"
    if ($ruleFit -ge 0.7) {
        $rationale.Add("High task-type rule fit ($("{0:N2}" -f $ruleFit)).")
    } elseif ($ruleFit -ge 0.45) {
        $rationale.Add("Moderate task-type rule fit ($("{0:N2}" -f $ruleFit)).")
    }
    if ($bestForScore -ge 0.6) {
        $rationale.Add("Strong best_for overlap with task context ($("{0:N2}" -f $bestForScore)).")
    } elseif ($bestForScore -ge 0.3) {
        $rationale.Add("Some best_for overlap with task context ($("{0:N2}" -f $bestForScore)).")
    }
    if (-not [string]::IsNullOrWhiteSpace($topStrength)) {
        $rationale.Add("Top strength: '$topStrength' ($("{0:N2}" -f $topStrengthConfidence) confidence).")
    }
    if ($avoidScore -ge 0.5) {
        $rationale.Add("Avoid_for overlap penalty applied ($("{0:N2}" -f $avoidScore)).")
    }

    return [pscustomobject]@{
        profile_id             = $profileId
        profile_name           = [string]$Profile.name
        profile_type           = $profileType
        dispatch_key           = $DispatchKey
        final_score            = $finalScore
        task_rule_fit          = $ruleFit
        best_for_overlap       = $bestForScore
        strength_confidence    = $strengthConfidence
        evidence_score         = $evidenceScore
        avoid_overlap          = $avoidScore
        top_strength           = $topStrength
        top_strength_confidence = $topStrengthConfidence
        rationale              = @($rationale)
    }
}

function Get-FileCatalog {
    param([Parameter(Mandatory = $true)][string]$SourceRootPath)

    $rootFull = [System.IO.Path]::GetFullPath($SourceRootPath)
    $entries = New-Object "System.Collections.Generic.List[object]"

    $files = Get-ChildItem -LiteralPath $rootFull -Recurse -File
    foreach ($file in $files) {
        $relativePath = Get-RelativePathString -BasePath $rootFull -TargetPath $file.FullName
        $relativeForward = ($relativePath -replace "\\", "/")
        $entries.Add([pscustomobject]@{
            relative_path = $relativeForward
            full_path     = $file.FullName
        })
    }

    return @($entries.ToArray())
}

function Select-FilesForSpecialist {
    param(
        [Parameter(Mandatory = $true)][object[]]$Catalog,
        [Parameter(Mandatory = $true)][string[]]$IncludeGlobs,
        [Parameter(Mandatory = $true)][string[]]$ExcludeGlobs,
        [Parameter(Mandatory = $true)][int]$MaxFiles
    )

    $selected = @(
        $Catalog |
            Where-Object {
                $relativePath = [string]$_.relative_path
                $includePass = $true
                if ($IncludeGlobs.Count -gt 0) {
                    $includePass = Test-AnyWildcardMatch -Path $relativePath -Patterns $IncludeGlobs
                }
                $excludePass = -not (Test-AnyWildcardMatch -Path $relativePath -Patterns $ExcludeGlobs)
                $includePass -and $excludePass
            } |
            Sort-Object -Property relative_path
    )

    if ($selected.Count -eq 0) {
        $fallback = @(
            $Catalog |
                Where-Object {
                    $relativePath = [string]$_.relative_path
                    if (Test-AnyWildcardMatch -Path $relativePath -Patterns $ExcludeGlobs) {
                        return $false
                    }
                    return ($relativePath -match "\.(md|py|r|R|js|ts|tsx|json|toml|ya?ml|css|scss|html|ps1|sh|conf|ini)$") -or
                        ($relativePath -match "(^|/)Dockerfile$") -or
                        ($relativePath -match "(^|/)railway\.toml$") -or
                        ($relativePath -match "(^|/)supervisord\.conf$")
                } |
                Sort-Object -Property relative_path
        )
        $selected = $fallback
    }

    if ($MaxFiles -gt 0 -and $selected.Count -gt $MaxFiles) {
        return @($selected | Select-Object -First $MaxFiles)
    }

    return @($selected)
}

function Render-Template {
    param(
        [Parameter(Mandatory = $true)][string]$Template,
        [Parameter(Mandatory = $true)][hashtable]$Values
    )

    $rendered = $Template
    foreach ($key in $Values.Keys) {
        $placeholder = "{{${key}}}"
        $rendered = $rendered.Replace($placeholder, [string]$Values[$key])
    }
    return $rendered
}

if ($TopN -lt 1) {
    throw "TopN must be >= 1."
}
if ($MinScore -lt 0 -or $MinScore -gt 1) {
    throw "MinScore must be between 0 and 1."
}

$cwd = (Get-Location).Path

$sourceRootFull = Resolve-FullPath -Path $SourceRoot -BaseDir $cwd
if (-not (Test-Path -LiteralPath $sourceRootFull -PathType Container)) {
    throw "SourceRoot does not exist: $sourceRootFull"
}

$profilesDirFull = Resolve-FullPath -Path $ProfilesDir -BaseDir $cwd
if (-not (Test-Path -LiteralPath $profilesDirFull -PathType Container)) {
    throw "Profiles directory not found: $profilesDirFull"
}

$routingConfigFull = Resolve-FullPath -Path $RoutingConfigPath -BaseDir $cwd
if (-not (Test-Path -LiteralPath $routingConfigFull -PathType Leaf)) {
    throw "Routing config not found: $routingConfigFull"
}

$templateConfigFull = Resolve-FullPath -Path $TemplateConfigPath -BaseDir $cwd
if (-not (Test-Path -LiteralPath $templateConfigFull -PathType Leaf)) {
    throw "Prompt template config not found: $templateConfigFull"
}

$manifestOutFull = Resolve-FullPath -Path $ManifestOutPath -BaseDir $cwd
$manifestOutDir = Split-Path -Parent $manifestOutFull
if (-not (Test-Path -LiteralPath $manifestOutDir -PathType Container)) {
    New-Item -ItemType Directory -Path $manifestOutDir -Force | Out-Null
}

$planOutFull = Resolve-FullPath -Path $PlanOutPath -BaseDir $cwd
$planOutDir = Split-Path -Parent $planOutFull
if (-not (Test-Path -LiteralPath $planOutDir -PathType Container)) {
    New-Item -ItemType Directory -Path $planOutDir -Force | Out-Null
}

$promptOutputFull = Resolve-FullPath -Path $PromptOutputDir -BaseDir $cwd
if (Test-Path -LiteralPath $promptOutputFull -PathType Container) {
    Get-ChildItem -LiteralPath $promptOutputFull -File -Filter "*.md" | Remove-Item -Force
} else {
    New-Item -ItemType Directory -Path $promptOutputFull -Force | Out-Null
}

$routingConfig = Get-Content -LiteralPath $routingConfigFull -Raw | ConvertFrom-Json
$templateConfig = Get-Content -LiteralPath $templateConfigFull -Raw | ConvertFrom-Json

$profileFiles = Get-ChildItem -LiteralPath $profilesDirFull -Filter "*.json" -File | Sort-Object -Property Name
$profiles = @()
foreach ($profileFile in $profileFiles) {
    $profile = Get-Content -LiteralPath $profileFile.FullName -Raw | ConvertFrom-Json
    if ($null -eq (Get-MapValue -Map $profile -Key "id")) {
        continue
    }
    $profiles += $profile
}

if ($profiles.Count -eq 0) {
    throw "No profiles found in $profilesDirFull"
}

$profilesById = @{}
foreach ($profile in $profiles) {
    $profilesById[[string]$profile.id] = $profile
}

$aliasMap = Get-MapValue -Map $routingConfig -Key "specialist_aliases"
$resolvedTaskType = Resolve-TaskType -ExplicitTaskType $TaskType -Description $TaskDescription -Config $routingConfig
$taskTypeMap = Get-MapValue -Map $routingConfig -Key "task_types"
$taskRule = Get-MapValue -Map $taskTypeMap -Key $resolvedTaskType
if ($null -eq $taskRule) {
    throw "Task rule not found for task type '$resolvedTaskType'."
}

$resolvedTaskMode = Resolve-TaskMode -ExplicitTaskMode $TaskMode -Description $TaskDescription -Config $routingConfig -TaskRule $taskRule
$taskText = Normalize-Text -Value "$resolvedTaskType $TaskDescription"

$scoredProfiles = @()
foreach ($profile in $profiles) {
    $profileId = [string]$profile.id
    $dispatchKey = Get-DispatchKeyFromProfileId -ProfileId $profileId -AliasMap $aliasMap
    $scoredProfiles += Get-ProfileScore -Profile $profile -DispatchKey $dispatchKey -TaskTypeName $resolvedTaskType -TaskText $taskText -TaskRule $taskRule
}

$scoredProfiles = @(
    $scoredProfiles |
        Sort-Object -Property @{ Expression = { [double]$_.final_score }; Descending = $true },
                               @{ Expression = { [double]$_.strength_confidence }; Descending = $true },
                               @{ Expression = { [string]$_.profile_id }; Descending = $false }
)

$recommended = @($scoredProfiles | Where-Object { $_.final_score -ge $MinScore } | Select-Object -First $TopN)
if ($recommended.Count -lt $TopN) {
    foreach ($candidate in $scoredProfiles) {
        if (($recommended | ForEach-Object { $_.profile_id }) -contains $candidate.profile_id) {
            continue
        }
        $recommended += $candidate
        if ($recommended.Count -ge $TopN) {
            break
        }
    }
}

$recommendedProfileIds = @($recommended | ForEach-Object { [string]$_.profile_id })
$recommendedWebUiKeys = @(
    $recommended |
        Where-Object { $_.profile_type -eq "webui" } |
        ForEach-Object { [string]$_.dispatch_key }
)

if ($recommendedWebUiKeys.Count -eq 0) {
    $recommendedWebUiKeys = @(
        $scoredProfiles |
            Where-Object { $_.profile_type -eq "webui" } |
            Select-Object -First 1 |
            ForEach-Object { [string]$_.dispatch_key }
    )
}

$catalog = Get-FileCatalog -SourceRootPath $sourceRootFull

$dispatchWebUiOrder = Convert-ToStringArray -Value (Get-MapValue -Map $routingConfig -Key "dispatch_webui_order")
if ($dispatchWebUiOrder.Count -eq 0) {
    $dispatchWebUiOrder = @("gemini", "chatgpt", "deepseek", "grok")
}

$knownProfileIds = @($profilesById.Keys)
$dispatchTargets = New-Object "System.Collections.Generic.List[object]"
foreach ($dispatchKey in $dispatchWebUiOrder) {
    $profileId = Get-ProfileIdFromDispatchKey -DispatchKey $dispatchKey -AliasMap $aliasMap -KnownProfileIds $knownProfileIds
    if ($null -eq $profileId) {
        continue
    }
    $dispatchTargets.Add([pscustomobject]@{
        dispatch_key = $dispatchKey
        profile_id   = $profileId
    })
}

if ($IncludeTerminalSpecialists) {
    foreach ($candidate in $recommended | Where-Object { $_.profile_type -eq "terminal" }) {
        $dispatchKey = [string]$candidate.dispatch_key
        if (($dispatchTargets | ForEach-Object { $_.dispatch_key }) -contains $dispatchKey) {
            continue
        }
        $dispatchTargets.Add([pscustomobject]@{
            dispatch_key = $dispatchKey
            profile_id   = [string]$candidate.profile_id
        })
    }
}

$globalExclude = Convert-ToStringArray -Value (Get-MapValue -Map $routingConfig -Key "global_exclude_globs")
$manifestSpecialists = [ordered]@{}
$dispatchSummary = @()

$dispatchManifestDefaults = Get-MapValue -Map $routingConfig -Key "dispatch_manifest_defaults"
$manifestDefaultsMap = Get-MapValue -Map $routingConfig -Key "specialist_manifest_defaults"
$taskOverrideMap = Get-MapValue -Map $taskRule -Key "specialist_manifest_overrides"
$sharedContextGlobs = Convert-ToStringArray -Value (Get-MapValue -Map $taskRule -Key "shared_context_globs")
$focusMap = Get-MapValue -Map $taskRule -Key "prompt_focus_by_specialist"
$templateSpecialistsMap = Get-MapValue -Map $templateConfig -Key "specialists"
$fallbackTemplate = [string](Get-MapValue -Map $templateConfig -Key "fallback_template")

$evidence = Get-MapValue -Map $routingConfig -Key "evidence"
$obsIds = @((Get-MapValue -Map $evidence -Key "observation_ids") | ForEach-Object { "#$_" })
$evidenceNote = "Evidence: $((Get-MapValue -Map $evidence -Key "profile_count")) profiles, $($obsIds -join ", "), confirmed review cycles: $((Get-MapValue -Map $evidence -Key "confirmed_review_cycles"))."

foreach ($target in $dispatchTargets) {
    $dispatchKey = [string]$target.dispatch_key
    $profileId = [string]$target.profile_id
    $profile = $profilesById[$profileId]
    $scoreData = $scoredProfiles | Where-Object { $_.profile_id -eq $profileId } | Select-Object -First 1

    $defaultRule = Get-MapValue -Map $manifestDefaultsMap -Key $profileId
    if ($null -eq $defaultRule) {
        $defaultRule = Get-MapValue -Map $manifestDefaultsMap -Key $dispatchKey
    }

    $overrideRule = Get-MapValue -Map $taskOverrideMap -Key $profileId
    if ($null -eq $overrideRule) {
        $overrideRule = Get-MapValue -Map $taskOverrideMap -Key $dispatchKey
    }

    $includeGlobs = Merge-UniqueStrings -Collections @(
        (Convert-ToStringArray -Value (Get-MapValue -Map $defaultRule -Key "include_globs")),
        (Convert-ToStringArray -Value (Get-MapValue -Map $overrideRule -Key "include_globs")),
        $sharedContextGlobs
    )

    $excludeGlobs = Merge-UniqueStrings -Collections @(
        $globalExclude,
        (Convert-ToStringArray -Value (Get-MapValue -Map $defaultRule -Key "exclude_globs")),
        (Convert-ToStringArray -Value (Get-MapValue -Map $overrideRule -Key "exclude_globs"))
    )

    $maxFiles = 30
    $overrideMax = Get-MapValue -Map $overrideRule -Key "max_files"
    $defaultMax = Get-MapValue -Map $defaultRule -Key "max_files"
    if ($null -ne $overrideMax) {
        $maxFiles = [int]$overrideMax
    } elseif ($null -ne $defaultMax) {
        $maxFiles = [int]$defaultMax
    }

    $selectedEntries = Select-FilesForSpecialist -Catalog $catalog -IncludeGlobs $includeGlobs -ExcludeGlobs $excludeGlobs -MaxFiles $maxFiles
    $selectedFiles = @($selectedEntries | ForEach-Object { [string]$_.relative_path })

    $templateKey = $dispatchKey
    $templateSet = Get-MapValue -Map $templateSpecialistsMap -Key $templateKey
    if ($null -eq $templateSet) {
        $templateKey = $profileId
        $templateSet = Get-MapValue -Map $templateSpecialistsMap -Key $templateKey
    }

    $modeTemplate = ""
    if ($null -ne $templateSet) {
        $modeTemplate = [string](Get-MapValue -Map $templateSet -Key $resolvedTaskMode)
    }
    if ([string]::IsNullOrWhiteSpace($modeTemplate)) {
        $modeTemplate = $fallbackTemplate
    }

    $focusText = [string](Get-MapValue -Map $focusMap -Key $profileId)
    if ([string]::IsNullOrWhiteSpace($focusText)) {
        $focusText = [string](Get-MapValue -Map $focusMap -Key $dispatchKey)
    }
    if ([string]::IsNullOrWhiteSpace($focusText)) {
        $focusText = "Focus on high-signal findings and concrete, prioritized guidance."
    }

    $fileListText = "- (No files matched. Add files manually.)"
    if ($selectedFiles.Count -gt 0) {
        $fileListText = ($selectedFiles | ForEach-Object { "- $_" }) -join [Environment]::NewLine
    }

    $rationaleText = ""
    if ($null -ne $scoreData) {
        $rationaleText = ($scoreData.rationale -join " ")
    }

    $renderedPrompt = Render-Template -Template $modeTemplate -Values @{
        TASK_TYPE        = $resolvedTaskType
        TASK_MODE        = $resolvedTaskMode
        TASK_DESCRIPTION = $TaskDescription
        SPECIALIST_FOCUS = $focusText
        FILE_COUNT       = $selectedFiles.Count
        FILE_LIST        = $fileListText
        EVIDENCE_NOTE    = $evidenceNote
        ROUTING_RATIONALE = $rationaleText
    }

    $promptOutputPath = Join-Path $promptOutputFull "$dispatchKey.md"
    Set-Content -LiteralPath $promptOutputPath -Value $renderedPrompt -Encoding UTF8

    $promptRelativeToManifest = Get-RelativePathString -BasePath $manifestOutDir -TargetPath $promptOutputPath
    $promptRelativeToManifest = $promptRelativeToManifest -replace "\\", "/"

    $manifestEntry = [ordered]@{
        prompt_path = $promptRelativeToManifest
        files       = @($selectedFiles)
    }

    $dispatchDefaults = Get-MapValue -Map $dispatchManifestDefaults -Key $dispatchKey
    $createRTxtValue = Get-MapValue -Map $dispatchDefaults -Key "create_r_txt_copies"
    if ($null -ne $createRTxtValue) {
        $manifestEntry["create_r_txt_copies"] = [bool]$createRTxtValue
    }

    $manifestSpecialists[$dispatchKey] = $manifestEntry

    $dispatchSummary += [pscustomobject]@{
        dispatch_key = $dispatchKey
        profile_id   = $profileId
        profile_name = [string]$profile.name
        recommended  = ($recommendedWebUiKeys -contains $dispatchKey)
        score        = if ($null -ne $scoreData) { [Math]::Round([double]$scoreData.final_score, 4) } else { 0.0 }
        file_count   = $selectedFiles.Count
        prompt_path  = $promptRelativeToManifest
    }
}

$sourceRootRelativeToManifest = Get-RelativePathString -BasePath $manifestOutDir -TargetPath $sourceRootFull
if ([string]::IsNullOrWhiteSpace($sourceRootRelativeToManifest) -or $sourceRootRelativeToManifest -eq ".") {
    $sourceRootRelativeToManifest = "."
}
$sourceRootRelativeToManifest = $sourceRootRelativeToManifest -replace "\\", "/"

$manifestObject = [ordered]@{
    source_root = $sourceRootRelativeToManifest
    specialists = $manifestSpecialists
}

$manifestJson = $manifestObject | ConvertTo-Json -Depth 12
Set-Content -LiteralPath $manifestOutFull -Value $manifestJson -Encoding UTF8

$rankingRows = @(
    $scoredProfiles |
        ForEach-Object {
            [ordered]@{
                profile_id              = [string]$_.profile_id
                profile_name            = [string]$_.profile_name
                profile_type            = [string]$_.profile_type
                dispatch_key            = [string]$_.dispatch_key
                final_score             = [Math]::Round([double]$_.final_score, 4)
                task_rule_fit           = [Math]::Round([double]$_.task_rule_fit, 4)
                best_for_overlap        = [Math]::Round([double]$_.best_for_overlap, 4)
                strength_confidence     = [Math]::Round([double]$_.strength_confidence, 4)
                evidence_score          = [Math]::Round([double]$_.evidence_score, 4)
                avoid_overlap           = [Math]::Round([double]$_.avoid_overlap, 4)
                top_strength            = [string]$_.top_strength
                top_strength_confidence = [Math]::Round([double]$_.top_strength_confidence, 4)
                rationale               = @($_.rationale)
            }
        }
)

$planObject = [ordered]@{
    version            = 1
    generated_at       = (Get-Date).ToString("o")
    task_description   = $TaskDescription
    task_type          = $resolvedTaskType
    task_mode          = $resolvedTaskMode
    source_root        = $sourceRootFull
    scoring_model      = [ordered]@{
        formula             = "(0.55*task_rule_fit + 0.25*best_for_overlap + 0.20*strength_confidence) * (0.85 + 0.15*evidence_score) - (0.50*avoid_overlap)"
        min_score_threshold = $MinScore
        top_n               = $TopN
    }
    evidence           = $evidence
    recommended_specialists = @($recommendedProfileIds)
    recommended_webui  = @($recommendedWebUiKeys)
    rankings           = $rankingRows
    dispatch_targets   = @($dispatchSummary)
    manifest_path      = (Get-RelativePathString -BasePath $cwd -TargetPath $manifestOutFull) -replace "\\", "/"
    prompt_output_dir  = (Get-RelativePathString -BasePath $cwd -TargetPath $promptOutputFull) -replace "\\", "/"
}

$planJson = $planObject | ConvertTo-Json -Depth 16
Set-Content -LiteralPath $planOutFull -Value $planJson -Encoding UTF8

Write-Host "Task type: $resolvedTaskType"
Write-Host "Task mode: $resolvedTaskMode"
Write-Host "Recommended specialists:"
foreach ($specialist in $recommended) {
    Write-Host ("  - {0} ({1:N3})" -f $specialist.profile_id, $specialist.final_score)
}
Write-Host "Generated routing plan: $planOutFull"
Write-Host "Generated manifest: $manifestOutFull"
Write-Host "Generated prompts in: $promptOutputFull"
