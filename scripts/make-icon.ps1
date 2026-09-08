[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$size = 256
$out = Join-Path $PSScriptRoot '..\src\App.ico'
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.Rectangle 8, 8, ($size - 16), ($size - 16)
$radius = 36
$diameter = $radius * 2
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
$path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
$path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 43, 110, 242)), ([System.Drawing.Color]::FromArgb(255, 18, 60, 138)), 45
$graphics.FillPath($brush, $path)

$whitePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 14
$whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($whitePen, 70, 88, 188, 88)
$graphics.DrawLine($whitePen, 70, 128, 188, 128)
$graphics.DrawLine($whitePen, 70, 168, 148, 168)

$redPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 240, 80, 90)), 16
$redPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$redPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($redPen, 118, 136, 152, 170)
$graphics.DrawLine($redPen, 152, 136, 118, 170)

$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create($out)
try {
    $icon.Save($stream)
} finally {
    $stream.Dispose()
    $redPen.Dispose()
    $whitePen.Dispose()
    $brush.Dispose()
    $path.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $icon.Dispose()
}

Write-Host "Icon created: $out"
