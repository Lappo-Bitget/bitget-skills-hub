[CmdletBinding()]
param(
  [string]$SetupUrl
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-BitgetLine {
  param(
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Blue
  )

  Write-Host $Message -ForegroundColor $Color
}

Write-Host ''
Write-Host '  BITGET WALLET' -ForegroundColor White -BackgroundColor Blue
Write-BitgetLine '  本地自动签名钱包配置' -Color Cyan
Write-Host ''
if ([string]::IsNullOrWhiteSpace($SetupUrl)) {
  throw '没有收到 MCP 本机设置地址。请通过 Codex Bitget Wallet skill 启动配置流程，不要手动填写地址。'
}

Write-BitgetLine '  [1/2] 正在连接本机配置会话...' -Color Blue
Write-BitgetLine "        地址: $SetupUrl" -Color DarkGray

function ConvertTo-PlainText {
  param([Security.SecureString]$SecureValue)

  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

try {
  $setupUri = [Uri]$SetupUrl
  if ($setupUri.Scheme -ne 'http' -or $setupUri.Host -ne '127.0.0.1' -or $setupUri.Port -le 0) {
    throw 'SetupUrl 必须是 MCP 返回的 http://127.0.0.1:<port>/ 地址。'
  }

  $rootUri = [Uri]::new("http://127.0.0.1:$($setupUri.Port)/")
  $page = Invoke-WebRequest -Uri $rootUri -UseBasicParsing
  $actionMatch = [Regex]::Match($page.Content, 'action="(?<action>/submit\?token=[^"]+)"')
  if (-not $actionMatch.Success) {
    throw '无法读取一次性提交地址。配置窗口可能已过期，请重新调用 local_signer_setup。'
  }

  $submitUri = [Uri]::new($rootUri, $actionMatch.Groups['action'].Value)
  Write-BitgetLine '  [2/2] 请输入专用自动交易钱包私钥' -Color Blue
  Write-BitgetLine '        输入内容不会显示，也不会写入文件或发送到远程服务。' -Color DarkGray
  $previousColor = $Host.UI.RawUI.ForegroundColor
  try {
    $Host.UI.RawUI.ForegroundColor = [ConsoleColor]::Blue
    $secureKey = Read-Host -Prompt '        私钥' -AsSecureString
  } finally {
    $Host.UI.RawUI.ForegroundColor = $previousColor
  }
  $privateKey = $null
  $body = $null
  try {
    $privateKey = ConvertTo-PlainText $secureKey
    if ($privateKey -notmatch '^0x[0-9a-fA-F]{64}$') {
      throw '私钥格式无效，应为 0x 开头的 64 位十六进制私钥。'
    }

    $body = 'privateKey=' + [Uri]::EscapeDataString($privateKey)
    $result = Invoke-WebRequest -Uri $submitUri -Method Post -ContentType 'application/x-www-form-urlencoded' -Body $body -UseBasicParsing
    if ($result.StatusCode -lt 200 -or $result.StatusCode -ge 300) {
      throw "本地配置提交失败，HTTP 状态码 $($result.StatusCode)。"
    }
    Write-BitgetLine '  ✓ 本地自动签名钱包已配置。' -Color Green
    Write-BitgetLine '    私钥只在本机进程内存中处理。' -Color DarkGray
  } finally {
    $privateKey = $null
    $body = $null
    $secureKey = $null
  }
} catch {
  Write-BitgetLine "  ✗ $($_.Exception.Message)" -Color Red
  exit 1
}
