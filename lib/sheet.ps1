param(
    [Parameter(Mandatory = $true)][string]$Plan,
    [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-FontFamily {
    foreach ($name in @('Microsoft YaHei UI', 'Microsoft YaHei', 'SimHei', 'Segoe UI', 'Arial')) {
        try { return (New-Object System.Drawing.FontFamily($name)) } catch { }
    }
    return (New-Object System.Drawing.FontFamily('Arial'))
}

$data = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$cell = if ($data.cell) { [int]$data.cell } else { 150 }
$cols = if ($data.columns) { [int]$data.columns } else { 6 }
$items = @($data.items)
if ($items.Count -eq 0) { throw 'no items for contact sheet' }
$rows = [Math]::Ceiling($items.Count / $cols)
$pad = 10
$headerH = if ($data.title) { 34 } else { 0 }
$cellH = $cell + 34
$w = $cols * $cell + $pad * 2
$h = $rows * $cellH + $pad * 2 + $headerH

$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(28, 30, 36))

$fontFamily = Get-FontFamily
$labelFont = New-Object System.Drawing.Font($fontFamily, 11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$subFont = New-Object System.Drawing.Font($fontFamily, 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$titleFont = New-Object System.Drawing.Font($fontFamily, 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 235, 240))
$dim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 155, 165))
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 190, 255))
$sf = New-Object System.Drawing.StringFormat
$sf.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
$sf.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap

if ($data.title) {
    $g.DrawString([string]$data.title, $titleFont, $white, [float]$pad, [float]($pad - 2))
}

$i = 0
foreach ($item in $items) {
    $col = $i % $cols
    $row = [Math]::Floor($i / $cols)
    $x = $pad + $col * $cell
    $y = $pad + $headerH + $row * $cellH
    $thumb = New-Object System.Drawing.RectangleF(($x + 4), ($y + 4), ($cell - 8), ($cell - 12))

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 255, 255, 255), 1)
    $g.DrawRectangle($pen, $thumb.X, $thumb.Y, $thumb.Width, $thumb.Height)
    $pen.Dispose()

    if ($item.kind -eq 'image' -and $item.file -and (Test-Path -LiteralPath ([string]$item.file))) {
        try {
            $bytes = [System.IO.File]::ReadAllBytes([string]$item.file)
            $ms = New-Object System.IO.MemoryStream(, $bytes)
            $img = [System.Drawing.Image]::FromStream($ms, $true, $true)
            $sw = ($thumb.Width - 12) / [double]$img.Width
            $sh = ($thumb.Height - 12) / [double]$img.Height
            $s = [Math]::Min($sw, $sh)
            if ($s -gt 1) { $s = 1 }
            $dw = $img.Width * $s; $dh = $img.Height * $s
            $dx = $thumb.X + ($thumb.Width - $dw) / 2
            $dy = $thumb.Y + ($thumb.Height - $dh) / 2
            $dest = New-Object System.Drawing.RectangleF($dx, $dy, $dw, $dh)
            $g.DrawImage($img, $dest)
            $img.Dispose()
            $ms.Dispose()
        } catch {
            $g.DrawString('decode error', $subFont, $dim, $thumb, $sf)
        }
    } elseif ($item.kind -eq 'component') {
        $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 120, 190, 255))
        $g.FillRectangle($b, $thumb)
        $b.Dispose()
        $sfc = New-Object System.Drawing.StringFormat
        $sfc.Alignment = [System.Drawing.StringAlignment]::Center
        $sfc.LineAlignment = [System.Drawing.StringAlignment]::Center
        $g.DrawString('component', $subFont, $accent, $thumb, $sfc)
        $sfc.Dispose()
    }

    $ly = $thumb.Y + $thumb.Height + 3
    $ly2 = $ly + 14
    $lx = [float]($x + 4)
    $lw = [float]($cell - 8)
    $line1 = if ($item.label) { [string]$item.label } else { '' }
    $line2 = if ($item.sub) { [string]$item.sub } else { '' }
    $rect1 = New-Object System.Drawing.RectangleF($lx, $ly, $lw, [float]14)
    $rect2 = New-Object System.Drawing.RectangleF($lx, $ly2, $lw, [float]13)
    $g.DrawString($line1, $labelFont, $white, $rect1, $sf)
    $g.DrawString($line2, $subFont, $dim, $rect2, $sf)
    $i += 1
}

$dir = [System.IO.Path]::GetDirectoryName($Out)
if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$labelFont.Dispose()
$subFont.Dispose()
$titleFont.Dispose()
$white.Dispose()
$dim.Dispose()
$accent.Dispose()
$sf.Dispose()
Write-Output "rendered $Out"
