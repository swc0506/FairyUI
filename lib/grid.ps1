param(
    [Parameter(Mandatory = $true)][string]$Image,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Step = 50,
    [int]$LabelEvery = 100,
    [double]$Scale = 1.0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if ($Step -lt 10) { $Step = 10 }
if ($LabelEvery -lt $Step) { $LabelEvery = $Step }

$bytes = [System.IO.File]::ReadAllBytes($Image)
$ms = New-Object System.IO.MemoryStream(, $bytes)
$src = [System.Drawing.Image]::FromStream($ms, $true, $true)

$w = [int][Math]::Round($src.Width * $Scale)
$h = [int][Math]::Round($src.Height * $Scale)

$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.DrawImage($src, 0, 0, $w, $h)

$minor = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(48, 255, 255, 255), 1)
$major = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 120, 200, 255), 1)
$edge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(160, 120, 200, 255), 2)

$font = New-Object System.Drawing.Font('Consolas', 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
$boxBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(170, 20, 22, 30))

for ($x = 0; $x -le $src.Width; $x += $Step) {
    $px = [float]($x * $Scale)
    $pen = if (($x % $LabelEvery) -eq 0) { $major } else { $minor }
    $g.DrawLine($pen, $px, 0, $px, $h)
}
for ($y = 0; $y -le $src.Height; $y += $Step) {
    $py = [float]($y * $Scale)
    $pen = if (($y % $LabelEvery) -eq 0) { $major } else { $minor }
    $g.DrawLine($pen, 0, $py, $w, $py)
}

# Coordinate labels: x along the top, y along the left.
for ($x = 0; $x -le $src.Width; $x += $LabelEvery) {
    $px = [float]($x * $Scale)
    $label = [string]$x
    $size = $g.MeasureString($label, $font)
    $bx = [Math]::Min([float]$px + 2, [float]$w - $size.Width - 4)
    $g.FillRectangle($boxBrush, $bx, 2, $size.Width + 2, $size.Height)
    $g.DrawString($label, $font, $textBrush, $bx + 1, 2)
}
for ($y = $LabelEvery; $y -le $src.Height; $y += $LabelEvery) {
    $py = [float]($y * $Scale)
    $label = [string]$y
    $size = $g.MeasureString($label, $font)
    $g.FillRectangle($boxBrush, 2, $py + 2, $size.Width + 2, $size.Height)
    $g.DrawString($label, $font, $textBrush, 3, $py + 2)
}

$g.DrawRectangle($edge, 1, 1, $w - 2, $h - 2)

$dir = [System.IO.Path]::GetDirectoryName($Out)
if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$src.Dispose()
$ms.Dispose()
$minor.Dispose()
$major.Dispose()
$edge.Dispose()
$font.Dispose()
$textBrush.Dispose()
$boxBrush.Dispose()
Write-Output "grid $Out"
