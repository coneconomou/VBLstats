# Creates "Pregame" shortcuts on the Desktop and in the Start menu, with the app icon.
# Re-run after moving the project folder. `npm run install-app` runs this.
$here = $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$targets = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($dir in $targets) {
    # Shortcut from before the Pregame rebrand.
    $old = Join-Path $dir 'VBL Stats.lnk'
    if (Test-Path $old) { Remove-Item $old; Write-Output "Removed old $old" }
    $lnk = $shell.CreateShortcut((Join-Path $dir 'Pregame.lnk'))
    $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $lnk.Arguments = "`"$here\Pregame.vbs`""
    $lnk.WorkingDirectory = Split-Path $here
    $lnk.IconLocation = "$here\icon.ico,0"
    $lnk.Description = 'Big V and NBL1 results, ladder, stats and referee scouting'
    $lnk.Save()
    Write-Output "Created $(Join-Path $dir 'Pregame.lnk')"
}
