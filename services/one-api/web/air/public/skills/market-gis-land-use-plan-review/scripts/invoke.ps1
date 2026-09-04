param(
    [Parameter(Mandatory = $true)][Alias('GeoJsonFile')][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [int]$Blxsw = 4,
    [string]$BaseUrl = ''
)

& (Join-Path $PSScriptRoot 'invoke-implementation.ps1') @PSBoundParameters
exit $LASTEXITCODE
