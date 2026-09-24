Add-Type -AssemblyName System.Drawing

$width = 40
$height = 56

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$bmp.MakeTransparent()
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Arrow cursor: tip at (0,0), body extends down-right
$points = New-Object System.Drawing.Point[] (10)
$points[0] = New-Object System.Drawing.Point(0, 0)
$points[1] = New-Object System.Drawing.Point(6, 20)
$points[2] = New-Object System.Drawing.Point(24, 26)
$points[3] = New-Object System.Drawing.Point(10, 32)
$points[4] = New-Object System.Drawing.Point(14, 54)
$points[5] = New-Object System.Drawing.Point(2, 40)
$points[6] = New-Object System.Drawing.Point(0, 54)
$points[7] = New-Object System.Drawing.Point(0, 32)
$points[8] = New-Object System.Drawing.Point(0, 26)
$points[9] = New-Object System.Drawing.Point(0, 20)

$outline = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 2.0)
$fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

$g.DrawPolygon($outline, $points)
$g.FillPolygon($fill, $points)

$outline.Dispose()
$fill.Dispose()
$g.Dispose()

$bmp.Save('C:\Editor Tutoriales Zeus IA\serve\cursors\default.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "Created default.png ${width}x${height}"
