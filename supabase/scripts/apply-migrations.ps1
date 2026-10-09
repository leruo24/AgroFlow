<#
.SYNOPSIS
    Puts a range of AgroFlow migrations on the clipboard, in order, ready to
    paste into the Supabase SQL editor.

.DESCRIPTION
    This project has no migration runner. Migrations are applied by hand in
    the Supabase SQL editor, which is a deliberate choice - the database holds
    real farm data and nothing should rewrite it unattended - but it is also
    how 0033 to 0036 came to be missed. Nothing said so, and the first anybody
    knew was a farmer's report failing with a bare 500.

    This does not fix that by applying anything. It fixes the part that caused
    it: picking the right files, in the right order, without missing one.
    It concatenates them with a clear separator per file so you can see what
    you are about to run and where an error came from.

    IT APPLIES NOTHING AND CONNECTS TO NOTHING. It reads .sql files and writes
    to the clipboard. You still paste and run it yourself, and you still read
    what you are running.

.PARAMETER From
    First migration number, inclusive. Accepts 34 or 0034.

.PARAMETER To
    Last migration number, inclusive. Defaults to the highest on disk.

.PARAMETER OutFile
    Write to this file instead of the clipboard. Useful when the range is
    large enough that pasting is unwieldy, or on a machine with no clipboard.

.EXAMPLE
    .\supabase\scripts\apply-migrations.ps1 -From 34 -To 36

    The three that were missed. Copies 0034, 0035 and 0036 to the clipboard.

.EXAMPLE
    .\supabase\scripts\apply-migrations.ps1 -From 38

    Everything from 0038 to the newest file - the usual "catch me up" case
    after pulling.

.EXAMPLE
    .\supabase\scripts\apply-migrations.ps1 -From 1 -OutFile .\all-migrations.sql

    The whole history to a file, for a fresh database.

.NOTES
    AFTERWARDS, CHECK IT WORKED. Run docs\ops\verify-migrations.sql in the same
    editor: one row, one column per migration, every value should be 1. The
    API reports the same thing for 0027 onwards under "Database schema" in
    GET /api/admin/health.

    The numbering has holes - 0014, 0015, 0022 and 0023 do not exist. A range
    that spans them is fine; they are simply not in the output.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [int]$From,

    [int]$To = 9999,

    [string]$OutFile
)

$ErrorActionPreference = 'Stop'

# Relative to this script, not to the caller's working directory, so it works
# from anywhere.
$migrationsDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'migrations'

if (-not (Test-Path $migrationsDir)) {
    throw "Migrations folder not found at $migrationsDir"
}

$files =
    Get-ChildItem -Path $migrationsDir -Filter '*.sql' |
    Where-Object { $_.Name -match '^(\d{4})_' } |
    ForEach-Object {
        [pscustomobject]@{
            Number = [int]$Matches[1]
            File   = $_
        }
    } |
    Where-Object { $_.Number -ge $From -and $_.Number -le $To } |
    Sort-Object Number

if (-not $files) {
    Write-Warning "No migrations found between $From and $To."
    return
}

$builder = [System.Text.StringBuilder]::new()

$null = $builder.AppendLine("-- AgroFlow migrations $($files[0].Number.ToString('0000')) to $($files[-1].Number.ToString('0000'))")
$null = $builder.AppendLine("-- $($files.Count) file(s), in order. Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
$null = $builder.AppendLine('--')
$null = $builder.AppendLine('-- Run this in the Supabase SQL editor, then run docs\ops\verify-migrations.sql')
$null = $builder.AppendLine('-- to confirm. Every file here is written to be safe to re-run.')
$null = $builder.AppendLine()

foreach ($entry in $files) {
    $null = $builder.AppendLine("-- ===== $($entry.File.Name) =====")
    $null = $builder.AppendLine()
    $null = $builder.AppendLine((Get-Content -Path $entry.File.FullName -Raw))
    $null = $builder.AppendLine()
}

$sql = $builder.ToString()

if ($OutFile) {
    # UTF8 explicitly: Set-Content defaults to the system ANSI codepage, and
    # several of these files carry non-ASCII characters in their comments.
    $sql | Out-File -FilePath $OutFile -Encoding utf8
    Write-Host "Wrote $($files.Count) migration(s) to $OutFile" -ForegroundColor Green
}
else {
    Set-Clipboard -Value $sql
    Write-Host "Copied $($files.Count) migration(s) to the clipboard:" -ForegroundColor Green
}

foreach ($entry in $files) {
    Write-Host "  $($entry.File.Name)"
}

Write-Host ''
Write-Host 'Next: paste into the Supabase SQL editor and run it.' -ForegroundColor Cyan
Write-Host 'Then run docs\ops\verify-migrations.sql - every column should be 1.' -ForegroundColor Cyan
