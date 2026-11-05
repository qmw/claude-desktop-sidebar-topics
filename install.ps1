# Enables the desktop-sidebar-topics mod for every Claude Desktop (Code tab) and `claude`
# session on this machine by adding its folder to CLAUDE_CODE_PLUGIN_DIRS in
# the `env` block of ~/.claude/settings.json. Safe to run again. Run it in
# Windows PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File "$HOME\.claude\mods\desktop-sidebar-topics\install.ps1"
#
# Sessions started afterwards load the mod; sessions already open do not.

$modDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$settingsPath = Join-Path $HOME ".claude\settings.json"

$settings = $null
if (Test-Path $settingsPath) {
  $raw = Get-Content $settingsPath -Raw
  if ($raw.Trim().Length -gt 0) { $settings = $raw | ConvertFrom-Json }
}
if ($null -eq $settings) { $settings = New-Object PSObject }
if ($null -eq $settings.PSObject.Properties["env"]) {
  $settings | Add-Member -MemberType NoteProperty -Name "env" -Value (New-Object PSObject)
}

$current = $settings.env.CLAUDE_CODE_PLUGIN_DIRS
$dirs = @()
if ($current) { $dirs = $current -split ";" | Where-Object { $_.Trim().Length -gt 0 } }
if ($dirs -notcontains $modDir) { $dirs += $modDir }
$joined = ($dirs -join ";")

if ($null -eq $settings.env.PSObject.Properties["CLAUDE_CODE_PLUGIN_DIRS"]) {
  $settings.env | Add-Member -MemberType NoteProperty -Name "CLAUDE_CODE_PLUGIN_DIRS" -Value $joined
} else {
  $settings.env.CLAUDE_CODE_PLUGIN_DIRS = $joined
}

$json = $settings | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "desktop-sidebar-topics enabled: CLAUDE_CODE_PLUGIN_DIRS = $joined"
Write-Host "Written to $settingsPath. New sessions will load the mod."
