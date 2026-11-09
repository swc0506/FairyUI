param(
    [Parameter(Mandatory = $true)][string]$Plan,
    [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function To-Color([string]$s, [System.Drawing.Color]$fallback) {
    if ([string]::IsNullOrWhiteSpace($s)) { return $fallback }
    $v = $s.Trim()
    if ($v -eq 'transparent' -or $v -eq 'none') { return [System.Drawing.Color]::Transparent }
    if (-not $v.StartsWith('#')) { $v = '#' + $v }
    $hex = $v.Substring(1)
    if ($hex.Length -eq 3) {
        $r = [Convert]::ToInt32(('' + $hex[0] + $hex[0]), 16)
        $g = [Convert]::ToInt32(('' + $hex[1] + $hex[1]), 16)
        $b = [Convert]::ToInt32(('' + $hex[2] + $hex[2]), 16)
        return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
    }
    if ($hex.Length -eq 6) {
        $r = [Convert]::ToInt32($hex.Substring(0, 2), 16)
        $g = [Convert]::ToInt32($hex.Substring(2, 2), 16)
        $b = [Convert]::ToInt32($hex.Substring(4, 2), 16)
        return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
    }
    if ($hex.Length -eq 8) {
        $a = [Convert]::ToInt32($hex.Substring(0, 2), 16)
        $r = [Convert]::ToInt32($hex.Substring(2, 2), 16)
        $g = [Convert]::ToInt32($hex.Substring(4, 2), 16)
        $b = [Convert]::ToInt32($hex.Substring(6, 2), 16)
        return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
    }
    return $fallback
}

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($r -le 0) {
        $p.AddRectangle((New-Object System.Drawing.RectangleF($x, $y, $w, $h)))
        return $p
    }
    $r = [Math]::Min($r, [Math]::Min($w, $h) / 2)
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Get-FontFamily {
    foreach ($name in @('Microsoft YaHei UI', 'Microsoft YaHei', 'SimHei', 'Segoe UI', 'Arial')) {
        try {
            $ff = New-Object System.Drawing.FontFamily($name)
            if ($ff -ne $null) { return $ff }
        } catch { }
    }
    return (New-Object System.Drawing.FontFamily('Arial'))
}

$data = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$scale = if ($data.scale) { [double]$data.scale } else { 1.0 }
$w = [int][Math]::Round([double]$data.width * $scale)
$h = [int][Math]::Round([double]$data.height * $scale)
if ($w -lt 1 -or $h -lt 1) { throw "invalid canvas size $w x $h" }

$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.ScaleTransform([float]$scale, [float]$scale)

$bg = if ($data.background) { To-Color $data.background ([System.Drawing.Color]::White) } else { [System.Drawing.Color]::White }
$g.Clear($bg)

$imageCache = @{}
$fontFamily = Get-FontFamily

foreach ($node in @($data.nodes)) {
    $x = [float]$node.x; $y = [float]$node.y; $nw = [float]$node.w; $nh = [float]$node.h

    switch ($node.kind) {
        'rect' {
            $fill = To-Color $node.fill ([System.Drawing.Color]::Transparent)
            $corner = if ($node.corner) { [float]$node.corner } else { 0 }
            if ($node.ellipse) {
                if ($fill.A -gt 0) {
                    $b = New-Object System.Drawing.SolidBrush($fill)
                    $g.FillEllipse($b, $x, $y, $nw, $nh)
                    $b.Dispose()
                }
                if ($node.line -and [double]$node.lineWidth -gt 0) {
                    $c = To-Color $node.line ([System.Drawing.Color]::Transparent)
                    $pen = New-Object System.Drawing.Pen($c, [float]$node.lineWidth)
                    $g.DrawEllipse($pen, $x, $y, $nw, $nh)
                    $pen.Dispose()
                }
            } else {
                $path = New-RoundedPath $x $y $nw $nh $corner
                if ($fill.A -gt 0) {
                    $b = New-Object System.Drawing.SolidBrush($fill)
                    $g.FillPath($b, $path)
                    $b.Dispose()
                }
                if ($node.line -and [double]$node.lineWidth -gt 0) {
                    $c = To-Color $node.line ([System.Drawing.Color]::Transparent)
                    $pen = New-Object System.Drawing.Pen($c, [float]$node.lineWidth)
                    $g.DrawPath($pen, $path)
                    $pen.Dispose()
                }
                $path.Dispose()
            }
        }
        'image' {
            $file = [string]$node.file
            if (-not (Test-Path -LiteralPath $file)) {
                $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(160, 200, 60, 60), 1)
                $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
                $g.DrawRectangle($pen, $x, $y, $nw, $nh)
                $pen.Dispose()
                continue
            }
            if (-not $imageCache.ContainsKey($file)) {
                $bytes = [System.IO.File]::ReadAllBytes($file)
                $ms = New-Object System.IO.MemoryStream(, $bytes)
                $imageCache[$file] = [System.Drawing.Image]::FromStream($ms, $true, $true)
            }
            $img = $imageCache[$file]
            $dest = New-Object System.Drawing.RectangleF($x, $y, $nw, $nh)
            $fit = [string]$node.fit
            if ($fit -eq 'contain' -and $img.Width -gt 0 -and $img.Height -gt 0) {
                $s = [Math]::Min($nw / $img.Width, $nh / $img.Height)
                $dw = $img.Width * $s; $dh = $img.Height * $s
                $dest = New-Object System.Drawing.RectangleF(($x + ($nw - $dw) / 2), ($y + ($nh - $dh) / 2), $dw, $dh)
            } elseif ($fit -eq 'cover') {
                $s = [Math]::Max($nw / $img.Width, $nh / $img.Height)
                $dw = $img.Width * $s; $dh = $img.Height * $s
                $dest = New-Object System.Drawing.RectangleF(($x - ($dw - $nw) / 2), ($y - ($dh - $nh) / 2), $dw, $dh)
            }
            $alpha = if ($node.alpha -ne $null) { [double]$node.alpha } else { 1.0 }
            if ($alpha -lt 0.999) {
                $ia = New-Object System.Drawing.Imaging.ImageAttributes
                $cm = New-Object System.Drawing.Imaging.ColorMatrix
                $cm.Matrix33 = [float]$alpha
                $ia.SetColorMatrix($cm)
                $g.DrawImage($img, $dest, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
                $ia.Dispose()
            } else {
                $g.DrawImage($img, $dest)
            }
        }
        'text' {
            $size = if ($node.fontSize) { [float]$node.fontSize } else { 24.0 }
            $style = [System.Drawing.FontStyle]::Regular
            if ($node.bold) { $style = $style -bor [System.Drawing.FontStyle]::Bold }
            if ($node.italic) { $style = $style -bor [System.Drawing.FontStyle]::Italic }
            $font = New-Object System.Drawing.Font($fontFamily, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
            $color = To-Color $node.color ([System.Drawing.Color]::Black)
            $text = [string]$node.text
            if ($node.singleLine) { $text = $text -replace "`r?`n", ' ' }
            $rect = New-Object System.Drawing.RectangleF($x, $y, $nw, $nh)
            $sf = New-Object System.Drawing.StringFormat
            switch ([string]$node.align) {
                'center' { $sf.Alignment = [System.Drawing.StringAlignment]::Center }
                'right' { $sf.Alignment = [System.Drawing.StringAlignment]::Far }
                default { $sf.Alignment = [System.Drawing.StringAlignment]::Near }
            }
            switch ([string]$node.valign) {
                'middle' { $sf.LineAlignment = [System.Drawing.StringAlignment]::Center }
                'bottom' { $sf.LineAlignment = [System.Drawing.StringAlignment]::Far }
                default { $sf.LineAlignment = [System.Drawing.StringAlignment]::Near }
            }
            $sf.Trimming = [System.Drawing.StringTrimming]::None
            $sf.FormatFlags = [System.Drawing.StringFormatFlags]::NoClip
            $brush = New-Object System.Drawing.SolidBrush($color)
            $strokeSize = if ($node.strokeSize) { [float]$node.strokeSize } else { 0 }
            if ($strokeSize -gt 0 -and $node.strokeColor) {
                $sc = To-Color $node.strokeColor ([System.Drawing.Color]::Black)
                $sb = New-Object System.Drawing.SolidBrush($sc)
                for ($dx = -$strokeSize; $dx -le $strokeSize; $dx += $strokeSize) {
                    for ($dy = -$strokeSize; $dy -le $strokeSize; $dy += $strokeSize) {
                        if ($dx -eq 0 -and $dy -eq 0) { continue }
                        $r2 = New-Object System.Drawing.RectangleF(($x + $dx), ($y + $dy), $nw, $nh)
                        $g.DrawString($text, $font, $sb, $r2, $sf)
                    }
                }
                $sb.Dispose()
            }
            $g.DrawString($text, $font, $brush, $rect, $sf)
            $brush.Dispose()
            $sf.Dispose()
            $font.Dispose()
        }
        'placeholder' {
            $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(36, 120, 170, 220))
            $g.FillRectangle($fill, $x, $y, $nw, $nh)
            $fill.Dispose()
            $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 90, 140, 200), 1)
            $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
            $g.DrawRectangle($pen, $x, $y, $nw, $nh)
            $pen.Dispose()
            $label = [string]$node.label
            if ($label.Length -gt 0) {
                $f = New-Object System.Drawing.Font($fontFamily, 11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
                $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 90, 140, 200))
                $sf2 = New-Object System.Drawing.StringFormat
                $sf2.Alignment = [System.Drawing.StringAlignment]::Center
                $sf2.LineAlignment = [System.Drawing.StringAlignment]::Center
                $g.DrawString($label, $f, $b, (New-Object System.Drawing.RectangleF($x, $y, $nw, $nh)), $sf2)
                $sf2.Dispose()
                $b.Dispose()
                $f.Dispose()
            }
        }
    }
}

$dir = [System.IO.Path]::GetDirectoryName($Out)
if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
foreach ($img in $imageCache.Values) { $img.Dispose() }
Write-Output "rendered $Out"
