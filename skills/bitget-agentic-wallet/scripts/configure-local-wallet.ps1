[CmdletBinding()]
param(
  [switch]$ReadKey,
  [switch]$Delete,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 exposes ProtectedData through System.Security,
# while PowerShell 7 may ship it as a dedicated assembly. Load whichever
# assembly is available before resolving the type.
try {
  Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop
} catch {
  Add-Type -AssemblyName System.Security -ErrorAction Stop
}

$dataRoot = Join-Path $env:LOCALAPPDATA 'Bitget Wallet'
$configPath = Join-Path $dataRoot 'developer-wallet.dpapi.json'

function Protect-LocalWalletKey {
  param([Parameter(Mandatory)][string]$Key)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Key)
  $protected = [Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [ordered]@{
    version = 1
    protection = 'Windows DPAPI CurrentUser'
    ciphertext = [Convert]::ToBase64String($protected)
    createdAt = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function Unprotect-LocalWalletKey {
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'No local developer wallet is configured.'
  }
  $record = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($record.version -ne 1 -or [string]::IsNullOrWhiteSpace($record.ciphertext)) {
    throw 'The local developer wallet configuration is invalid.'
  }
  $protected = [Convert]::FromBase64String([string]$record.ciphertext)
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protected,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Text.Encoding]::UTF8.GetString($bytes)
}

if ($ValidateOnly) {
  Write-Output 'ok'
  exit 0
}

if ($ReadKey) {
  $key = Unprotect-LocalWalletKey
  if ($key -notmatch '^0x[0-9a-fA-F]{64}$') { throw 'The decrypted key is invalid.' }
  [Console]::Out.Write($key)
  exit 0
}

if ($Delete) {
  if (Test-Path -LiteralPath $configPath) {
    Remove-Item -LiteralPath $configPath -Force
  }
  exit 0
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$navy = '#001F29'
$canvas = '#00080A'
$surface = '#121717'
$raised = '#1B2122'
$cyan = '#00F0FF'
$text = '#FFFFFF'
$muted = '#91A0A1'
$font = [System.Windows.Media.FontFamily]::new('Causten Round, AlibabaPuHuiTi, Microsoft YaHei, Segoe UI')

$window = New-Object Windows.Window
$window.Title = 'Bitget Wallet 开发者模式'
$window.Width = 560
$window.Height = 650
$window.MinWidth = 520
$window.MinHeight = 620
$window.WindowStartupLocation = 'CenterScreen'
$window.Background = [Windows.Media.BrushConverter]::new().ConvertFromString($canvas)
$window.FontFamily = $font
$window.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($text)

$root = New-Object Windows.Controls.Grid
$root.Margin = '28'
$window.Content = $root
$root.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition -Property @{ Height = 'Auto' }))
$root.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition -Property @{ Height = '*' }))
$root.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition -Property @{ Height = 'Auto' }))

$header = New-Object Windows.Controls.StackPanel
$header.Orientation = 'Horizontal'
$header.Margin = '0,0,0,24'
[Windows.Controls.Grid]::SetRow($header, 0)
$root.Children.Add($header) | Out-Null

$logo = New-Object Windows.Controls.Border
$logo.Width = 54
$logo.Height = 54
$logo.CornerRadius = '14'
$logo.Background = [Windows.Media.BrushConverter]::new().ConvertFromString($navy)
$logo.Margin = '0,0,16,0'
$logoChild = New-Object Windows.Controls.Canvas
$logoChild.Width = 54
$logoChild.Height = 54
$logo.Child = $logoChild
$arrow = New-Object Windows.Shapes.Path
$arrow.Fill = [Windows.Media.BrushConverter]::new().ConvertFromString($cyan)
$arrow.Data = [Windows.Media.Geometry]::Parse('M 20,10 L 38,27 L 20,44 L 14,44 L 29,27 L 14,10 Z')
$logoChild.Children.Add($arrow) | Out-Null
$header.Children.Add($logo) | Out-Null

$heading = New-Object Windows.Controls.StackPanel
$title = New-Object Windows.Controls.TextBlock
$title.Text = 'Bitget Wallet 开发者模式'
$title.FontSize = 23
$title.FontWeight = 'SemiBold'
$subtitle = New-Object Windows.Controls.TextBlock
$subtitle.Text = '配置本地开发钱包'
$subtitle.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($muted)
$subtitle.Margin = '0,5,0,0'
$heading.Children.Add($title) | Out-Null
$heading.Children.Add($subtitle) | Out-Null
$header.Children.Add($heading) | Out-Null

$content = New-Object Windows.Controls.StackPanel
[Windows.Controls.Grid]::SetRow($content, 1)
$root.Children.Add($content) | Out-Null

$info = New-Object Windows.Controls.Border
$info.Background = [Windows.Media.BrushConverter]::new().ConvertFromString($surface)
$info.CornerRadius = '16'
$info.Padding = '18'
$info.Margin = '0,0,0,18'
$infoText = New-Object Windows.Controls.TextBlock
$infoText.Text = '使用独立的钱包进行本地开发签名。私钥会使用 Windows DPAPI 加密，并绑定到当前 Windows 用户。'
$infoText.TextWrapping = 'Wrap'
$infoText.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($muted)
$info.Child = $infoText
$content.Children.Add($info) | Out-Null

$label = New-Object Windows.Controls.TextBlock
$label.Text = '钱包私钥'
$label.FontSize = 15
$label.FontWeight = 'SemiBold'
$label.Margin = '0,0,0,8'
$content.Children.Add($label) | Out-Null

$keyBox = New-Object Windows.Controls.PasswordBox
$keyBox.Height = 44
$keyBox.Padding = '12,8'
$keyBox.FontSize = 15
$keyBox.Background = [Windows.Media.BrushConverter]::new().ConvertFromString($raised)
$keyBox.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($text)
$keyBox.BorderBrush = [Windows.Media.BrushConverter]::new().ConvertFromString('#355157')
$keyBox.BorderThickness = '1'
$content.Children.Add($keyBox) | Out-Null

$hint = New-Object Windows.Controls.TextBlock
$hint.Text = '格式：0x 开头的 64 位十六进制私钥。建议使用专门的开发钱包。'
$hint.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($muted)
$hint.Margin = '0,8,0,18'
$hint.TextWrapping = 'Wrap'
$content.Children.Add($hint) | Out-Null

$ack = New-Object Windows.Controls.CheckBox
$ack.Content = '我确认这是独立开发钱包的私钥，并理解该密钥拥有该钱包的完整控制权。'
$ack.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($text)
$ack.FontSize = 13
$ack.Margin = '0,0,0,22'
$ack.IsChecked = $false
$content.Children.Add($ack) | Out-Null

$status = New-Object Windows.Controls.TextBlock
$status.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($muted)
$status.TextWrapping = 'Wrap'
$status.Margin = '0,0,0,10'
$content.Children.Add($status) | Out-Null

$footer = New-Object Windows.Controls.StackPanel
$footer.Orientation = 'Horizontal'
$footer.HorizontalAlignment = 'Right'
[Windows.Controls.Grid]::SetRow($footer, 2)
$root.Children.Add($footer) | Out-Null

$deleteButton = New-Object Windows.Controls.Button
$deleteButton.Content = '删除本地配置'
$deleteButton.Padding = '16,10'
$deleteButton.Margin = '0,0,12,0'
$deleteButton.Background = [Windows.Media.BrushConverter]::new().ConvertFromString($surface)
$deleteButton.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($muted)
$deleteButton.BorderBrush = [Windows.Media.BrushConverter]::new().ConvertFromString('#355157')
$footer.Children.Add($deleteButton) | Out-Null

$save = New-Object Windows.Controls.Button
$save.Content = '加密保存钱包'
$save.Padding = '20,10'
$save.Background = [Windows.Media.BrushConverter]::new().ConvertFromString($cyan)
$save.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($navy)
$save.FontWeight = 'SemiBold'
$footer.Children.Add($save) | Out-Null

$save.Add_Click({
  try {
    if (-not $ack.IsChecked) { throw '请先确认独立开发钱包的控制权说明。' }
    $key = $keyBox.Password.Trim()
    if ($key -notmatch '^0x[0-9a-fA-F]{64}$') { throw '私钥格式不正确。' }
    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
    Protect-LocalWalletKey -Key $key
    $keyBox.Clear()
    $status.Text = '已使用 Windows DPAPI 加密保存。私钥不会写入明文环境变量。'
    $status.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($cyan)
  } catch {
    $status.Text = $_.Exception.Message
    $status.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#FF9E3E')
  }
})

$deleteButton.Add_Click({
  try {
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
    $status.Text = '本地钱包配置已删除。'
    $status.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($cyan)
  } catch {
    $status.Text = $_.Exception.Message
    $status.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#FF9E3E')
  }
})

$window.Add_Closed({ $keyBox.Clear() })
$window.ShowDialog() | Out-Null
