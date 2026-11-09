param(
    [Parameter(Mandatory = $true)][string]$Plan,
    [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Load-Image([string]$file) {
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ms = New-Object System.IO.MemoryStream(, $bytes)
    return [System.Drawing.Image]::FromStream($ms, $true, $true)
}

function New-32bpp([System.Drawing.Image]$img, [int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose()
    return $bmp
}

$planData = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$mode = [string]$planData.mode

switch ($mode) {
    'crop' {
        $src = Load-Image ([string]$planData.image)
        foreach ($item in @($planData.items)) {
            $x = [int]$item.x; $y = [int]$item.y
            $w = [int]$item.w; $h = [int]$item.h
            $scale = if ($item.scale) { [double]$item.scale } else { 1.0 }
            $dw = [int][Math]::Round($w * $scale)
            $dh = [int][Math]::Round($h * $scale)
            if ($dw -lt 1 -or $dh -lt 1) { throw "invalid crop size for $($item.out)" }
            $bmp = New-Object System.Drawing.Bitmap($dw, $dh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $dst = New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)
            $srcRect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
            $g.DrawImage($src, $dst, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
            $g.Dispose()
            $dir = [System.IO.Path]::GetDirectoryName([string]$item.out)
            if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
            $bmp.Save([string]$item.out, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
        }
        $src.Dispose()
        Write-Output "crops: $((@($planData.items)).Count)"
    }
    'annotate' {
        $src = Load-Image ([string]$planData.image)
        $scale = if ($planData.scale) { [double]$planData.scale } else { 1.0 }
        $w = [int][Math]::Round($src.Width * $scale)
        $h = [int][Math]::Round($src.Height * $scale)
        $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($src, 0, 0, $w, $h)
        $g.ScaleTransform([float]$scale, [float]$scale)
        $font = New-Object System.Drawing.Font('Microsoft YaHei', 12, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $chipBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 20, 22, 30))
        $index = 0
        foreach ($region in @($planData.regions)) {
            $index += 1
            $rx = [float]$region.x; $ry = [float]$region.y
            $rw = [float]$region.w; $rh = [float]$region.h
            $colorHex = if ($region.color) { [string]$region.color } else { '#ff3b30' }
            $hex = $colorHex.TrimStart('#')
            if ($hex.Length -eq 6) { $hex = 'ff' + $hex }
            $a = [Convert]::ToInt32($hex.Substring(0, 2), 16)
            $r = [Convert]::ToInt32($hex.Substring(2, 2), 16)
            $gcol = [Convert]::ToInt32($hex.Substring(4, 2), 16)
            $b = [Convert]::ToInt32($hex.Substring(6, 2), 16)
            $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($a, $r, $gcol, $b), 2)
            $g.DrawRectangle($pen, $rx, $ry, $rw, $rh)
            $pen.Dispose()
            $label = [string]$index
            if ($region.label) { $label = "$index · $($region.label)" }
            elseif ($region.name) { $label = "$index · $($region.name)" }
            $size = $g.MeasureString($label, $font)
            $chipW = [float]($size.Width + 8)
            $chipH = [float]($size.Height + 2)
            $chipX = [float]([Math]::Max(0, $rx))
            $chipY = [float]([Math]::Max(0, $ry - $chipH))
            $g.FillRectangle($chipBrush, $chipX, $chipY, $chipW, $chipH)
            $g.DrawString($label, $font, $textBrush, $chipX + 4, $chipY)
        }
        $font.Dispose(); $textBrush.Dispose(); $chipBrush.Dispose()
        $dir = [System.IO.Path]::GetDirectoryName($Out)
        if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
        $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose(); $src.Dispose()
        Write-Output "annotated $Out"
    }
    'palette' {
        $src = Load-Image ([string]$planData.image)
        $step = if ($planData.step) { [int]$planData.step } else { 4 }
        if ($step -lt 1) { $step = 1 }
        $rects = @()
        if ($planData.regions) { $rects = @($planData.regions) }
        elseif ($planData.rect) { $rects = @([pscustomobject]@{ x = $planData.rect[0]; y = $planData.rect[1]; w = $planData.rect[2]; h = $planData.rect[3] }) }
        else { $rects = @([pscustomobject]@{ x = 0; y = 0; w = $src.Width; h = $src.Height }) }

        $counts = @{}
        $samples = 0
        foreach ($rc in $rects) {
            $x0 = [Math]::Max(0, [int]$rc.x); $y0 = [Math]::Max(0, [int]$rc.y)
            $x1 = [Math]::Min($src.Width, [int]$rc.x + [int]$rc.w)
            $y1 = [Math]::Min($src.Height, [int]$rc.y + [int]$rc.h)
            for ($y = $y0; $y -lt $y1; $y += $step) {
                for ($x = $x0; $x -lt $x1; $x += $step) {
                    $c = $src.GetPixel($x, $y)
                    if ($c.A -lt 8) { continue }
                    $key = '{0:x2}{1:x2}{2:x2}' -f $c.R, $c.G, $c.B
                    if ($counts.ContainsKey($key)) { $counts[$key] += 1 } else { $counts[$key] = 1 }
                    $samples += 1
                }
            }
        }
        $top = if ($planData.top) { [int]$planData.top } else { 8 }
        $colors = @()
        foreach ($kv in ($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First $top)) {
            $colors += [pscustomobject]@{
                hex = '#' + $kv.Key
                count = $kv.Value
                pct = [Math]::Round(($kv.Value / [double]$samples) * 100, 2)
            }
        }
        $result = [pscustomobject]@{
            width = $src.Width
            height = $src.Height
            samples = $samples
            colors = $colors
        }
        $dir = [System.IO.Path]::GetDirectoryName($Out)
        if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
        $json = $result | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
        $src.Dispose()
        Write-Output "palette $Out"
    }
    'diff' {
        $a = Load-Image ([string]$planData.a)
        $b = Load-Image ([string]$planData.b)
        $w = $a.Width; $h = $a.Height
        $bmpA = New-32bpp $a $w $h
        $bmpB = New-32bpp $b $w $h
        $heat = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

        Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class FairyDiff {
    public static double[] Compare(Bitmap a, Bitmap b, Bitmap heat, int threshold) {
        int w = a.Width, h = a.Height;
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData da = a.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData db = b.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData dh = heat.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try {
            int stride = da.Stride;
            byte[] pa = new byte[stride * h];
            byte[] pb = new byte[stride * h];
            byte[] ph = new byte[stride * h];
            Marshal.Copy(da.Scan0, pa, 0, pa.Length);
            Marshal.Copy(db.Scan0, pb, 0, pb.Length);
            double sum = 0; int max = 0; long changed = 0;
            for (int y = 0; y < h; y++) {
                int row = y * stride;
                for (int x = 0; x < w; x++) {
                    int i = row + x * 4;
                    int ba = pa[i], ga = pa[i + 1], ra = pa[i + 2];
                    int bb = pb[i], gb = pb[i + 1], rb = pb[i + 2];
                    int dr = Math.Abs(ra - rb), dg = Math.Abs(ga - gb), dbv = Math.Abs(ba - bb);
                    int d = Math.Max(dr, Math.Max(dg, dbv));
                    sum += d;
                    if (d > max) max = d;
                    if (d > threshold) changed++;
                    int gray = (ra + ga + ba) / 3;
                    int basev = (int)(gray * 0.35);
                    int red = Math.Min(255, basev + d * 2);
                    ph[i] = (byte)0;
                    ph[i + 1] = (byte)(basev / 2);
                    ph[i + 2] = (byte)red;
                    ph[i + 3] = 255;
                }
            }
            Marshal.Copy(ph, 0, dh.Scan0, ph.Length);
            double total = (double)w * h;
            return new double[] { sum / total, max, changed / total * 100.0 };
        } finally {
            a.UnlockBits(da); b.UnlockBits(db); heat.UnlockBits(dh);
        }
    }
}
"@ -ReferencedAssemblies System.Drawing
        $metrics = [FairyDiff]::Compare($bmpA, $bmpB, $heat, [int]$planData.threshold)
        $heatPath = if ($planData.heatmap) { [string]$planData.heatmap } else { $Out }
        $metricsPath = if ($planData.metrics) { [string]$planData.metrics } else { "$Out.json" }
        $dir = [System.IO.Path]::GetDirectoryName($heatPath)
        if (-not [string]::IsNullOrEmpty($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
        $heat.Save($heatPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $result = [pscustomobject]@{
            width = $w
            height = $h
            meanDiff = [Math]::Round($metrics[0], 3)
            maxDiff = [int]$metrics[1]
            changedPct = [Math]::Round($metrics[2], 3)
            threshold = [int]$planData.threshold
            heatmap = $heatPath
        }
        $json = $result | ConvertTo-Json -Depth 4
        [System.IO.File]::WriteAllText($metricsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        $heat.Dispose(); $bmpA.Dispose(); $bmpB.Dispose(); $a.Dispose(); $b.Dispose()
        Write-Output "diff $heatPath"
    }
    default { throw "unknown vision mode: $mode" }
}
