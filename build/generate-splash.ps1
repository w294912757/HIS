Add-Type -AssemblyName System.Drawing

$buildDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$iconPath = Join-Path $buildDirectory 'icon.png'
$outputPath = Join-Path $buildDirectory 'splash.bmp'
$title = -join ((0x8BCA, 0x6240, 0x75C5, 0x5386) | ForEach-Object { [char]$_ })
$status = -join ((0x6B63, 0x5728, 0x542F, 0x52A8, 0xFF0C, 0x8BF7, 0x7A0D, 0x5019, 0x002E, 0x002E, 0x002E) | ForEach-Object { [char]$_ })

$bitmap = New-Object System.Drawing.Bitmap(420, 160, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$icon = [System.Drawing.Image]::FromFile($iconPath)
$titleFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 23, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$statusFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 14, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(24, 34, 48))
$statusBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(102, 116, 137))
$accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 119, 255))

try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::FromArgb(244, 247, 251))
  $graphics.FillRectangle($accentBrush, 0, 0, 8, 160)
  $graphics.DrawImage($icon, 28, 40, 80, 80)
  $graphics.DrawString($title, $titleFont, $titleBrush, 132, 48)
  $graphics.DrawString($status, $statusFont, $statusBrush, 132, 88)
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  $accentBrush.Dispose()
  $statusBrush.Dispose()
  $titleBrush.Dispose()
  $statusFont.Dispose()
  $titleFont.Dispose()
  $icon.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
