param(
    [Parameter(Mandatory = $true)][string]$Plan,
    [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

$data = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$imagePath = [string]$data.image
if (-not (Test-Path -LiteralPath $imagePath)) { throw "image not found: $imagePath" }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = $null
    if ($data.lang) {
        try {
            $lang = New-Object Windows.Globalization.Language([string]$data.lang)
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
        } catch { $engine = $null }
    }
    if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if ($null -eq $engine) { throw 'no OCR recognizer language available on this machine' }

    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    foreach ($line in $result.Lines) {
        $minX = [double]::MaxValue
        $minY = [double]::MaxValue
        $maxX = 0.0
        $maxY = 0.0
        $wordCount = 0
        foreach ($word in $line.Words) {
            $r = $word.BoundingRect
            $minX = [Math]::Min($minX, [double]$r.X)
            $minY = [Math]::Min($minY, [double]$r.Y)
            $maxX = [Math]::Max($maxX, [double]$r.X + [double]$r.Width)
            $maxY = [Math]::Max($maxY, [double]$r.Y + [double]$r.Height)
            $wordCount += 1
        }
        if ($minX -eq [double]::MaxValue) { continue }
        $text = [string]$line.Text
        $text = [regex]::Replace($text, '(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])', '')
        $h = $maxY - $minY
        $lines += [pscustomobject]@{
            text = $text
            rect = @([int][Math]::Round($minX), [int][Math]::Round($minY), [int][Math]::Round($maxX - $minX), [int][Math]::Round($h))
            fontSize = [int][Math]::Round($h * 1.1)
            words = $wordCount
        }
    }

    $textAll = ($lines | ForEach-Object { $_.text }) -join "`n"
    $payload = [pscustomobject]@{
        width = $bitmap.PixelWidth
        height = $bitmap.PixelHeight
        lang = $engine.RecognizerLanguage.LanguageTag
        count = $lines.Count
        lines = $lines
        text = $textAll
    }
    $json = $payload | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "ocr $($lines.Count) line(s)"
} finally {
    $stream.Dispose()
}
