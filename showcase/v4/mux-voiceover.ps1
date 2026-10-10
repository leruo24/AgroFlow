<#
  AgroFlow showcase v4: put the team's own voice-over on the finished picture.

  Drop one WAV per line into showcase/v4/vo-team/, named exactly as in assets/vo/cue-sheet.csv
  (s01_leruo.wav, s02_olwethu.wav, ... s14a_luba.wav, s14b_leruo.wav, s14c_philisile.wav,
  s14d_olwethu.wav). Each recording starts with about 1 s of silence, so it is placed 1 s before
  its line's start time. Every clip is levelled to -16 LUFS. A clip that runs past its slot is
  NOT cut: you get a warning listing it, so you can re-record or read it faster.

  Needs ffmpeg and ffprobe 5.1 or newer on the PATH.
  Run from anywhere:  powershell -ExecutionPolicy Bypass -File showcase\v4\mux-voiceover.ps1
#>
param(
  [string]$Video = (Join-Path $PSScriptRoot "..\renders\AgroFlow_v4_NOVOICE.mp4"),
  [string]$VoDir = (Join-Path $PSScriptRoot "vo-team"),
  [string]$Out = (Join-Path $PSScriptRoot "..\renders\INF3003W_Team02_ShowcaseDemo_v4.mp4"),
  [double]$LeadSilence = 1.0
)
$ErrorActionPreference = "Stop"
$inv = [System.Globalization.CultureInfo]::InvariantCulture

foreach ($tool in "ffmpeg", "ffprobe") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool was not found on the PATH." }
}
if (-not (Test-Path $Video)) { throw "Picture not found: $Video" }

function Get-Duration([string]$path) {
  $d = & ffprobe -v error -show_entries format=duration -of csv=p=0 "$path"
  return [double]::Parse($d.Trim(), $inv)
}

$cues = Import-Csv (Join-Path $PSScriptRoot "assets\vo\cue-sheet.csv")
$videoLen = Get-Duration $Video
$inputs = @(); $filters = @(); $labels = @(); $missing = @(); $long = @(); $n = 0

foreach ($c in $cues) {
  $wav = Join-Path $VoDir ($c.id + ".wav")
  if (-not (Test-Path $wav)) { $missing += $c.id; continue }
  $start = [double]::Parse($c.start, $inv) - $LeadSilence
  if ($start -lt 0) { $start = 0 }
  $limit = [double]::Parse($c.limit, $inv)
  $len = Get-Duration $wav
  $end = $start + $len
  if ($end -gt $limit + 0.05) {
    $long += ("{0}  ({1}): ends at {2:0.00} s, its slot ends at {3:0.00} s - {4:0.00} s too long" -f $c.id, $c.speaker, $end, $limit, ($end - $limit))
  }
  $n++
  $inputs += @("-i", $wav)
  $ms = [int][math]::Round($start * 1000)
  $filters += ("[{0}:a]aformat=sample_rates=48000:channel_layouts=mono,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,adelay={1}:all=1[a{0}]" -f $n, $ms)
  $labels += "[a$n]"
}

if ($missing.Count -gt 0) { Write-Warning ("No recording yet for: " + ($missing -join ", ")) }
if ($n -eq 0) { throw "No WAV files found in $VoDir." }

$mix = ($labels -join "") + ("amix=inputs={0}:normalize=0:dropout_transition=0,apad,atrim=0:{1},aformat=channel_layouts=stereo[vo]" -f $n, $videoLen.ToString($inv))
$graph = ($filters + $mix) -join ";"

& ffmpeg -y -v error -i "$Video" @inputs -filter_complex $graph -map 0:v -map "[vo]" `
  -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -t $videoLen.ToString($inv) "$Out"
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed." }

Write-Host "Written: $Out"
Write-Host ("{0} of {1} lines placed." -f $n, $cues.Count)
if ($long.Count -gt 0) {
  Write-Warning "These recordings run past their slot (nothing was cut; re-record or read a little faster):"
  $long | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "Every recording fits its slot."
}
