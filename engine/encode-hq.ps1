# HTML → PNG (lossless master) → WebP + transparent video
#
# Intermediate pick: animated WebP (lossless) over APNG
#   - same 8-bit alpha quality
#   - usually smaller than APNG
# Final video: near-lossless VP9 WebM + ProRes 4444 MOV

param(
  [string]$FramesDir = "renders\frames",
  [int]$Fps = 60,
  [switch]$SkipCapture
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path","User")
$env:HYPERFRAMES_SKIP_SKILLS = "1"

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name not found on PATH"
  }
}

Require-Cmd ffmpeg
Require-Cmd ffprobe

New-Item -ItemType Directory -Force -Path "renders" | Out-Null
New-Item -ItemType Directory -Force -Path $FramesDir | Out-Null

if (-not $SkipCapture) {
  Write-Host "`n[1/4] Capturing lossless PNG sequence @ ${Fps}fps..." -ForegroundColor Cyan
  Get-ChildItem $FramesDir -Filter "*.png" -ErrorAction SilentlyContinue | Remove-Item -Force
  npx --yes hyperframes@0.7.106 render `
    --format png-sequence `
    --fps $Fps `
    --quality high `
    --output $FramesDir
}

$pngs = Get-ChildItem $FramesDir -Filter "*.png" | Sort-Object Name
if ($pngs.Count -lt 2) { throw "No PNG frames found in $FramesDir" }

# Detect naming pattern used by HyperFrames
$sample = $pngs[0].Name
Write-Host "Found $($pngs.Count) frames (sample: $sample)" -ForegroundColor Green

# HyperFrames typically writes frame_000001.png or similar
$pattern = Join-Path $FramesDir $sample
if ($sample -match '^(.+?)(\d+)(\.png)$') {
  $prefix = $Matches[1]
  $digits = $Matches[2].Length
  $ffmpegInput = Join-Path $FramesDir ($prefix + "%0${digits}d.png")
} else {
  throw "Unexpected frame name pattern: $sample"
}

$webpOut = "renders\aether-lossless.webp"
$webmOut = "renders\aether-hq.webm"
$movOut  = "renders\aether-hq.mov"

Write-Host "`n[2/4] Encoding lossless animated WebP..." -ForegroundColor Cyan
ffmpeg -y -framerate $Fps -i $ffmpegInput `
  -c:v libwebp_anim -lossless 1 -compression_level 6 -loop 0 `
  -pix_fmt yuva420p `
  $webpOut

Write-Host "`n[3/4] Encoding near-lossless transparent WebM (VP9 CRF 8, speed 0)..." -ForegroundColor Cyan
# Pass 1
ffmpeg -y -framerate $Fps -i $ffmpegInput `
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 8 `
  -quality good -speed 4 -row-mt 1 -tile-columns 2 `
  -pass 1 -an -f null NUL

# Pass 2
ffmpeg -y -framerate $Fps -i $ffmpegInput `
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 8 `
  -quality good -speed 0 -row-mt 1 -tile-columns 2 `
  -auto-alt-ref 0 `
  -metadata:s:v:0 alpha_mode=1 `
  -pass 2 -an `
  $webmOut

Write-Host "`n[4/4] Encoding ProRes 4444 MOV (editor master)..." -ForegroundColor Cyan
ffmpeg -y -framerate $Fps -i $ffmpegInput `
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le `
  -vendor apl0 `
  $movOut

$movLiteOut = "renders\aether-hq-lite.mov"
$qtrleOut = "renders\aether-qtrle.mov"

Write-Host "`n[4b] Smaller alpha MOVs (lite ProRes + qtrle)..." -ForegroundColor Cyan
ffmpeg -y -framerate $Fps -i $ffmpegInput `
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le `
  -qscale:v 12 -vendor apl0 `
  $movLiteOut

ffmpeg -y -framerate $Fps -i $ffmpegInput `
  -c:v qtrle -pix_fmt argb `
  $qtrleOut

Write-Host "`n=== DONE ===" -ForegroundColor Green
Get-ChildItem renders\aether-lossless.webp, renders\aether-hq.webm, renders\aether-hq.mov, renders\aether-hq-lite.mov, renders\aether-qtrle.mov -ErrorAction SilentlyContinue |
  ForEach-Object {
    $mb = [math]::Round($_.Length / 1MB, 2)
    Write-Host ("{0,-28} {1,8} MB" -f $_.Name, $mb)
  }

Write-Host "`nVerify alpha:" -ForegroundColor Cyan
ffprobe -v error -show_entries stream_tags=ALPHA_MODE -show_entries stream=codec_name,pix_fmt -of default=noprint_wrappers=1 $webmOut
