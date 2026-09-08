param([string]$Operation)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

if (-not $Operation) {
    $Operation = [Environment]::GetEnvironmentVariable('RCMM_OPERATION')
}

function ConvertTo-PsPath([string]$path) {
    if ($path -like 'HKEY_LOCAL_MACHINE\*') {
        return 'Registry::HKEY_LOCAL_MACHINE\' + $path.Substring('HKEY_LOCAL_MACHINE\'.Length)
    }
    if ($path -like 'HKEY_CURRENT_USER\*') {
        return 'Registry::HKEY_CURRENT_USER\' + $path.Substring('HKEY_CURRENT_USER\'.Length)
    }
    if ($path -like 'HKEY_CLASSES_ROOT\*') {
        return 'Registry::HKEY_CLASSES_ROOT\' + $path.Substring('HKEY_CLASSES_ROOT\'.Length)
    }
    return 'Registry::' + $path
}

function Write-Result($value) {
    try {
        $payload = @{ ok = $true; result = $value; error = '' }
        $json = $payload | ConvertTo-Json -Compress -Depth 40
        [Console]::Write($json)
    } catch {
        $err = @{ ok = $false; error = [string]$_.Exception.Message } | ConvertTo-Json -Compress
        [Console]::Write($err)
    }
}

function Add-ShellNativeType {
    if (-not ('RcmmShellNative' -as [type])) {
        $dq = [char]34
        $member = '[DllImport(' + $dq + 'shlwapi.dll' + $dq + ', CharSet = CharSet.Unicode)]' + [Environment]::NewLine + 'public static extern int SHLoadIndirectString(string pszSource, System.Text.StringBuilder pszOutBuf, int cchOutBuf, System.IntPtr ppvReserved);'
        Add-Type -MemberDefinition $member -Name RcmmShellNative -Namespace Rcmm
    }
}

$inputJson = ''
try {
    $inputJson = [Console]::In.ReadToEnd()
} catch {}

$data = $null
if (-not [string]::IsNullOrWhiteSpace($inputJson)) {
    try { $data = $inputJson | ConvertFrom-Json } catch {}
}

switch ($Operation) {
    'read-keys' {
        $results = @()
        $requests = @()
        if ($data -and $data.paths) { $requests = @($data.paths) }
        foreach ($req in $requests) {
            $psPath = ConvertTo-PsPath ([string]$req)
            try {
                $item = Get-Item -LiteralPath $psPath -ErrorAction Stop
                $subKeys = @()
                try {
                    $subKeys = @(Get-ChildItem -LiteralPath $psPath -ErrorAction Stop | ForEach-Object { $_.PSChildName })
                } catch {}
                $values = @()
                foreach ($name in $item.GetValueNames()) {
                    $kind = ''
                    $value = $null
                    try { $kind = [string]$item.GetValueKind($name) } catch {}
                    try { $value = $item.GetValue($name) } catch {}
                    $values += [pscustomobject]@{ Name = [string]$name; Kind = $kind; Data = $value }
                }
                $results += [pscustomobject]@{ ok = $true; path = [string]$req; subKeys = $subKeys; values = $values; error = '' }
            } catch {
                $results += [pscustomobject]@{ ok = $false; path = [string]$req; subKeys = @(); values = @(); error = [string]$_.Exception.Message }
            }
        }
        Write-Result $results
    }
    'delete-entries' {
        $results = @()
        $entries = @()
        if ($data -and $data.entries) { $entries = @($data.entries) }
        foreach ($entry in $entries) {
            try {
                $hive = if ($entry.hiveName -eq 'HKEY_CURRENT_USER') { 'Registry::HKEY_CURRENT_USER\' } else { 'Registry::HKEY_LOCAL_MACHINE\' }
                $psPath = $hive + [string]$entry.relativePath
                if ($entry.isSubKey) {
                    Remove-Item -LiteralPath $psPath -Recurse -Force -ErrorAction Stop
                } else {
                    $parent = Split-Path -Parent $psPath
                    Remove-ItemProperty -LiteralPath $parent -Name ([string]$entry.valueName) -Force -ErrorAction Stop
                }
                $results += [pscustomobject]@{ ok = $true; relativePath = [string]$entry.relativePath; error = '' }
            } catch {
                $results += [pscustomobject]@{ ok = $false; relativePath = [string]$entry.relativePath; error = [string]$_.Exception.Message }
            }
        }
        Write-Result $results
    }
    'resolve-indirect' {
        Add-ShellNativeType
        $results = @()
        $values = @()
        if ($data -and $data.values) { $values = @($data.values) }
        foreach ($source in $values) {
            $value = ''
            try {
                if (-not [string]::IsNullOrWhiteSpace([string]$source)) {
                    $buffer = New-Object System.Text.StringBuilder 1024
                    $result = [RcmmShellNative]::SHLoadIndirectString([string]$source, $buffer, $buffer.Capacity, [IntPtr]::Zero)
                    if ($result -eq 0) { $value = $buffer.ToString() }
                }
            } catch {}
            $results += [pscustomobject]@{ source = [string]$source; value = $value }
        }
        Write-Result $results
    }
    'file-info' {
        $results = @()
        $paths = @()
        if ($data -and $data.paths) { $paths = @($data.paths) }
        foreach ($p in $paths) {
            $item = [pscustomobject]@{ path = [string]$p; exists = $false; fullPath = ''; description = ''; company = '' }
            try {
                $resolved = [Environment]::ExpandEnvironmentVariables([string]$p)
                if (Test-Path -LiteralPath $resolved) {
                    $full = (Resolve-Path -LiteralPath $resolved).Path
                    $item.exists = $true
                    $item.fullPath = $full
                    $vi = (Get-Item -LiteralPath $full).VersionInfo
                    if ($vi) {
                        $item.description = [string]$vi.FileDescription
                        $item.company = [string]$vi.CompanyName
                    }
                }
            } catch {}
            $results += $item
        }
        Write-Result $results
    }
    'scan-appx' {
        $result = @()
        $repoPath = 'Registry::HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages'
        $windowsApps = Join-Path $env:ProgramFiles 'WindowsApps'
        if (Test-Path -LiteralPath $repoPath) {
            foreach ($packageKey in (Get-ChildItem -LiteralPath $repoPath -ErrorAction SilentlyContinue)) {
                $packageName = $packageKey.PSChildName
                try {
                    $manifestPath = Join-Path $windowsApps (Join-Path $packageName 'AppxManifest.xml')
                    if (-not (Test-Path -LiteralPath $manifestPath)) {
                        $props = Get-ItemProperty -LiteralPath $packageKey.PSPath -ErrorAction SilentlyContinue
                        $rootFolder = [string]$props.PackageRootFolder
                        if ($rootFolder) { $manifestPath = Join-Path $rootFolder 'AppxManifest.xml' }
                    }
                    if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
                    [xml]$doc = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath
                    $extensions = @($doc.SelectNodes('//*[local-name()=''Extension'' and @Category=''windows.fileExplorerContextMenus'']'))
                    if ($extensions.Count -eq 0) { continue }
                    $packageDisplayName = ''
                    $propsNode = $doc.SelectSingleNode('//*[local-name()=''Properties'']/*[local-name()=''DisplayName'']')
                    if ($propsNode) {
                        $text = [string]$propsNode.InnerText
                        if ($text.Trim() -and -not $text.Trim().StartsWith('ms-resource:')) { $packageDisplayName = $text.Trim() }
                    }
                    if (-not $packageDisplayName) {
                        $appNode = $doc.SelectSingleNode('//*[local-name()=''Applications'']/*[local-name()=''Application''][1]/*[local-name()=''VisualElements'']')
                        if ($appNode) {
                            $text = [string]$appNode.GetAttribute('DisplayName')
                            if ($text.Trim() -and -not $text.Trim().StartsWith('ms-resource:')) { $packageDisplayName = $text.Trim() }
                        }
                    }
                    foreach ($extension in $extensions) {
                        foreach ($itemNode in @($extension.SelectNodes('.//*[local-name()=''ItemType'']'))) {
                            $itemType = [string]$itemNode.GetAttribute('Type')
                            foreach ($verb in @($itemNode.SelectNodes('./*[local-name()=''Verb'']'))) {
                                $verbId = [string]$verb.GetAttribute('Id')
                                if (-not $verbId) { continue }
                                $clsid = [string]$verb.GetAttribute('Clsid')
                                $dllPath = ''
                                $serverPath = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Classes\PackagedCom\Package\' + $packageName + '\Server\0'
                                if (Test-Path -LiteralPath $serverPath) {
                                    $serverProps = Get-ItemProperty -LiteralPath $serverPath -ErrorAction SilentlyContinue
                                    $dllPath = [string]$serverProps.DllPath
                                }
                                if (-not $dllPath -and $clsid) {
                                    $clsNode = $doc.SelectSingleNode('//*[local-name()=''Class'' and @Id=''' + $clsid + ''']')
                                    if ($clsNode) { $dllPath = [string]$clsNode.GetAttribute('Path') }
                                }
                                $dllPath = [Environment]::ExpandEnvironmentVariables($dllPath)
                                if ($dllPath -and -not [System.IO.Path]::IsPathRooted($dllPath)) {
                                    $rootFolder = ''
                                    $props = Get-ItemProperty -LiteralPath $packageKey.PSPath -ErrorAction SilentlyContinue
                                    $rootFolder = [string]$props.PackageRootFolder
                                    if ($rootFolder) {
                                        $dllPath = Join-Path $rootFolder $dllPath
                                    } else {
                                        $dllPath = Join-Path (Split-Path -Parent $manifestPath) $dllPath
                                    }
                                }
                                $result += [pscustomobject]@{
                                    packageName = $packageName
                                    packageDisplayName = $packageDisplayName
                                    verbId = $verbId
                                    clsid = $clsid
                                    itemType = $itemType
                                    dllPath = $dllPath
                                }
                            }
                        }
                    }
                } catch {}
            }
        }
        Write-Result $result
    }
    'is-admin' {
        $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        Write-Result $isAdmin
    }
    default {
        Write-Result @{ ok = $false; error = ('Unknown operation: ' + $Operation) }
    }
}
