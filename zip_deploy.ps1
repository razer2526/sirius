# Empaqueta $StageDir en $ZipPath con separadores '/' (estandar ZIP), no '\'.
# Compress-Archive de Windows PowerShell guarda rutas con backslash, lo que
# puede romper la extraccion en el servidor Linux de HostGator; por eso se
# arma el zip a mano con System.IO.Compression.
param(
    [Parameter(Mandatory = $true)][string]$StageDir,
    [Parameter(Mandatory = $true)][string]$ZipPath
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

# Se resuelve una sola vez con Get-Item y se reutiliza esa misma forma (evita
# mezclar nombres cortos 8.3 de %TEMP% con las rutas largas que devuelve
# Get-ChildItem, que descuadraba el cálculo de la ruta relativa).
$stageItem = Get-Item -LiteralPath $StageDir
$baseUri = [Uri]($stageItem.FullName.TrimEnd('\') + '\')
$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)

function RelPath([string]$fullName) {
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri([Uri]$fullName).ToString())
}

try {
    # Archivos: nombre relativo con '/' siempre (MakeRelativeUri ya usa '/').
    Get-ChildItem -Path $stageItem.FullName -Recurse -File | ForEach-Object {
        $rel = RelPath $_.FullName
        $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fileStream = [System.IO.File]::OpenRead($_.FullName)
        try { $fileStream.CopyTo($entryStream) } finally { $fileStream.Dispose(); $entryStream.Dispose() }
    }

    # Carpetas vacias: entrada de tamaño 0 terminada en '/' para que el zip las conserve.
    Get-ChildItem -Path $stageItem.FullName -Recurse -Directory | ForEach-Object {
        if (@(Get-ChildItem -Path $_.FullName -Force).Count -eq 0) {
            $rel = (RelPath $_.FullName) + '/'
            $zip.CreateEntry($rel) | Out-Null
        }
    }
} finally {
    $zip.Dispose()
}

Write-Host "Zip creado: $ZipPath"
