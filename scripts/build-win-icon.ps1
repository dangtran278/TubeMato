param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$iconDir = Join-Path $ProjectRoot 'assets\icons'
$outFile = Join-Path $iconDir 'app.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)

function Write-UInt16LE([System.IO.BinaryWriter]$writer, [int]$value) {
  $writer.Write([uint16]$value)
}

function Write-UInt32LE([System.IO.BinaryWriter]$writer, [long]$value) {
  $writer.Write([uint32]$value)
}

function New-BmpIconImage([string]$pngPath, [int]$targetSize) {
  $src = [System.Drawing.Bitmap]::FromFile($pngPath)
  try {
    $bmp = New-Object System.Drawing.Bitmap $targetSize, $targetSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($src, 0, 0, $targetSize, $targetSize)
      }
      finally {
        $graphics.Dispose()
      }

      $andRowBytes = [Math]::Ceiling($targetSize / 32.0) * 4
      $xorBytes = $targetSize * $targetSize * 4
      $andBytes = [int]($andRowBytes * $targetSize)

      $stream = New-Object System.IO.MemoryStream
      $writer = New-Object System.IO.BinaryWriter $stream
      try {
        # BITMAPINFOHEADER. In ICO, height is doubled for XOR + AND masks.
        Write-UInt32LE $writer 40
        $writer.Write([int32]$targetSize)
        $writer.Write([int32]($targetSize * 2))
        Write-UInt16LE $writer 1
        Write-UInt16LE $writer 32
        Write-UInt32LE $writer 0
        Write-UInt32LE $writer $xorBytes
        $writer.Write([int32]0)
        $writer.Write([int32]0)
        Write-UInt32LE $writer 0
        Write-UInt32LE $writer 0

        # XOR bitmap: BGRA, bottom-up.
        for ($y = $targetSize - 1; $y -ge 0; $y--) {
          for ($x = 0; $x -lt $targetSize; $x++) {
            $p = $bmp.GetPixel($x, $y)
            $writer.Write([byte]$p.B)
            $writer.Write([byte]$p.G)
            $writer.Write([byte]$p.R)
            $writer.Write([byte]$p.A)
          }
        }

        # AND mask: 1 means transparent. Keep alpha in XOR, but set fully transparent pixels too.
        for ($y = $targetSize - 1; $y -ge 0; $y--) {
          $row = New-Object byte[] $andRowBytes
          for ($x = 0; $x -lt $targetSize; $x++) {
            $p = $bmp.GetPixel($x, $y)
            if ($p.A -eq 0) {
              $byteIndex = [Math]::Floor($x / 8)
              $bitIndex = 7 - ($x % 8)
              $row[$byteIndex] = $row[$byteIndex] -bor (1 -shl $bitIndex)
            }
          }
          $writer.Write($row)
        }

        $writer.Flush()
        return $stream.ToArray()
      }
      finally {
        $writer.Dispose()
        $stream.Dispose()
      }
    }
    finally {
      $bmp.Dispose()
    }
  }
  finally {
    $src.Dispose()
  }
}

$images = @()
foreach ($size in $sizes) {
  $pngPath = Join-Path $iconDir "icon$size.png"
  if (!(Test-Path $pngPath)) {
    $pngPath = Join-Path $iconDir 'icon256.png'
  }
  $images += [pscustomobject]@{
    Size = $size
    Data = New-BmpIconImage $pngPath $size
  }
}

$headerSize = 6
$directorySize = 16 * $images.Count
$offset = $headerSize + $directorySize

$out = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $out
try {
  Write-UInt16LE $writer 0
  Write-UInt16LE $writer 1
  Write-UInt16LE $writer $images.Count

  foreach ($image in $images) {
    $dimensionByte = $image.Size
    if ($dimensionByte -eq 256) {
      $dimensionByte = 0
    }
    $writer.Write([byte]$dimensionByte)
    $writer.Write([byte]$dimensionByte)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    Write-UInt16LE $writer 1
    Write-UInt16LE $writer 32
    Write-UInt32LE $writer $image.Data.Length
    Write-UInt32LE $writer $offset
    $offset += $image.Data.Length
  }

  foreach ($image in $images) {
    $writer.Write([byte[]]$image.Data)
  }

  $writer.Flush()
  [System.IO.File]::WriteAllBytes($outFile, $out.ToArray())
}
finally {
  $writer.Dispose()
  $out.Dispose()
}

foreach ($stale in @('icon.ico', 'icon16.ico', 'icon32.ico', 'icon48.ico', 'icon256.ico')) {
  $stalePath = Join-Path $iconDir $stale
  if (Test-Path $stalePath) {
    Remove-Item $stalePath -Force
  }
}

Write-Host "[build-win-icon] wrote assets/icons/app.ico ($($sizes -join ', ') px)"
