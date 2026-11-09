param(
    [Parameter(Mandatory = $true)][string]$Plan,
    [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$data = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json

$mockup = [string]$data.mockup
if (-not (Test-Path -LiteralPath $mockup)) { throw "mockup not found: $mockup" }

$image = [System.Drawing.Image]::FromFile($mockup)
$canvas = New-Object System.Drawing.Bitmap($image.Width, $image.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.DrawImage($image, 0, 0, $image.Width, $image.Height)
$g.Dispose()

$bitmap = $canvas
$offsetX = if ($data.offset) { [float]$data.offset[0] } else { 0 }
$offsetY = if ($data.offset) { [float]$data.offset[1] } else { 0 }

$g2 = [System.Drawing.Graphics]::FromImage($bitmap)
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

function To-Color([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return [System.Drawing.Color]::White }
    $v = $s.Trim()
    if (-not $v.StartsWith('#')) { $v = '#' + $v }
    $hex = $v.Substring(1)
    if ($hex.Length -eq 6) {
        return [System.Drawing.Color]::FromArgb(255,
            [Convert]::ToInt32($hex.Substring(0, 2), 16),
            [Convert]::ToInt32($hex.Substring(2, 2), 16),
            [Convert]::ToInt32($hex.Substring(4, 2), 16))
    }
    if ($hex.Length -eq 8) {
        return [System.Drawing.Color]::FromArgb(
            [Convert]::ToInt32($hex.Substring(0, 2), 16),
            [Convert]::ToInt32($hex.Substring(2, 2), 16),
            [Convert]::ToInt32($hex.Substring(4, 2), 16),
            [Convert]::ToInt32($hex.Substring(6, 2), 16))
    }
    return [System.Drawing.Color]::White
}

foreach ($node in @($data.nodes)) {
    $x = $offsetX + [float]$node.x
    $y = $offsetY + [float]$node.y
    $w = [float]$node.w
    $h = [float]$node.h
    $pen = New-Object System.Drawing.Pen((To-Color $node.color), 1)
    $g2.DrawRectangle($pen, $x, $y, $w, $h)
    $pen.Dispose()
    if ($node.label) {
        $b = New-Object System.Drawing.SolidBrush((To-Color $node.color))
        $g2.DrawString([string]$node.label, $font, $b, ($x + 1), ($y + 1))
        $b.Dispose()
    }
}
$font.Dispose()
$g2.Dispose()

# component outline
if ($data.width -and $data.height) {
    $g3 = [System.Drawing.Graphics]::FromImage($bitmap)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 0, 0), 1)
    $g3.DrawRectangle($pen, $offsetX, $offsetY, [float]$data.width, [float]$data.height)
    $pen.Dispose()
    $g3.Dispose()
}

if ($data.crop -and @($data.crop).Count -eq 4) {
    $x0 = [int]$data.crop[0]; $y0 = [int]$data.crop[1]; $x1 = [int]$data.crop[2]; $y1 = [int]$data.crop[3]
    $rect = New-Object System.Drawing.Rectangle($x0, $y0, ($x1 - $x0), ($y1 - $y0))
    $cropped = $bitmap.Clone($rect, $bitmap.PixelFormat)
    $bitmap.Dispose()
    $bitmap = $cropped
}

$zoom = if ($data.zoom) { [double]$data.zoom } else { 1.0 }
if ($zoom -ne 1.0) {
    $zw = [int][Math]::Round($bitmap.Width * $zoom)
    $zh = [int][Math]::Round($bitmap.Height * $zoom)
    $resized = New-Object System.Drawing.Bitmap($zw, $zh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gr = [System.Drawing.Graphics]::FromImage($resized)
    $gr.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gr.DrawImage($bitmap, 0, 0, $zw, $zh)
    $gr.Dispose()
    $bitmap.Dispose()
    $bitmap = $resized
}

$dir = [System.IO.Path]::GetDirectoryName($Out)
if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$image.Dispose()
Write-Output "rendered $Out"
