# Creates "VBL Stats" shortcuts on the Desktop and in the Start menu, with the basketball icon.
# Re-run after moving the project folder. `npm run install-app` runs this.
$here = $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$targets = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($dir in $targets) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'VBL Stats.lnk'))
    $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $lnk.Arguments = "`"$here\VBL Stats.vbs`""
    $lnk.WorkingDirectory = Split-Path $here
    $lnk.IconLocation = "$here\icon.ico,0"
    $lnk.Description = 'Big V results, ladder, stats and referee scouting'
    $lnk.Save()
    Write-Output "Created $(Join-Path $dir 'VBL Stats.lnk')"
}
