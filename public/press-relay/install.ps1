# 전국 통합돌봄 대시보드 보도자료 PC 중계 수집기 설치(노트북·데스크톱 각각 한 번 실행)
# 1) 관리자 화면 > 보도자료 수집관리 > 수집 PC(중계 수집)에서 PC 이름을 넣고 토큰을 발급받는다.
# 2) 이 스크립트를 실행하고 토큰을 붙여넣는다. 토큰은 이 Windows 계정 암호화(DPAPI)로만 저장된다.
# 3) 매일 09:05·12:05·15:05·18:05와 로그인 3분 뒤에 수집한다. 꺼져 있던 시각은 켜진 뒤 이어서 수집한다.
param([string]$Site = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site", [switch]$UpdateOnly)

$ErrorActionPreference = "Stop"
if ($Site.TrimEnd('/') -cne 'https://integrated-care-national-dashboard.xgfox54.chatgpt.site') { throw "등록된 대시보드 HTTPS 주소만 사용할 수 있습니다." }
# AppData는 일부 앱(MSIX) 안에서 실행하면 앱 전용 저장소로 돌려져 작업 스케줄러가 못 찾는다. 사용자 폴더에 둔다.
$AppDir = Join-Path $env:USERPROFILE "IntegratedCarePressRelay"
$Collector = Join-Path $AppDir "collect.ps1"
$TaskName = "IntegratedCare-PressRelay"
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

Write-Host "전국 통합돌봄 대시보드 보도자료 PC 수집기 설치"
$TokenPath = Join-Path $AppDir "token.dat"
if ($UpdateOnly) {
  if (-not (Test-Path -LiteralPath $TokenPath -PathType Leaf)) { throw "기존 토큰이 없습니다. 처음 설치는 UpdateOnly 없이 실행하세요." }
} else {
  if ($env:PRESS_RELAY_TOKEN_INPUT) { $secure = ConvertTo-SecureString $env:PRESS_RELAY_TOKEN_INPUT -AsPlainText -Force }
  else { $secure = Read-Host "관리자 화면에서 발급받은 수집 PC 토큰을 붙여넣으세요" -AsSecureString }
  if ($secure.Length -lt 32) { throw "토큰이 너무 짧습니다." }
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$tempCollector = Join-Path $AppDir ("collect-download-" + [Guid]::NewGuid().ToString("N") + ".ps1")
try {
  Invoke-WebRequest -UseBasicParsing -Uri ($Site.TrimEnd("/") + "/press-relay/collect.ps1") -OutFile $tempCollector
  $parseTokens = $null; $parseErrors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($tempCollector, [ref]$parseTokens, [ref]$parseErrors)
  if ($parseErrors.Count -gt 0) { throw "수집기 구문 검사 실패. 기존 파일을 유지합니다." }
  $scriptText = [IO.File]::ReadAllText($tempCollector)
  if (-not $scriptText.Contains('2026-10-19-recovery-3') -or -not $scriptText.Contains('/api/press/tick')) { throw "복구 버전 확인 실패. 기존 파일을 유지합니다." }
  if (Test-Path -LiteralPath $Collector) {
    $backup = $Collector + ".bak-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [Guid]::NewGuid().ToString("N")
    [IO.File]::Replace($tempCollector, $Collector, $backup)
  } else { [IO.File]::Move($tempCollector, $Collector) }
  if (-not $UpdateOnly) { $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $TokenPath -Encoding ASCII }
} finally {
  if (Test-Path -LiteralPath $tempCollector) { Remove-Item -LiteralPath $tempCollector }
}
if ($UpdateOnly) {
  Write-Host "수집기만 업데이트했습니다. 토큰과 기존 예약 작업은 유지했습니다."
  exit 0
}

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Collector + '" -Site "' + $Site + '"'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$triggers = @(9, 12, 15, 18 | ForEach-Object { New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($_).AddMinutes(5)) })
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$logon.Delay = "PT3M"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger ($triggers + $logon) -Settings $settings -Principal $principal -Description "전국 통합돌봄 대시보드 보도자료 PC 중계 수집(매일 09·12·15·18시 5분, 로그인 3분 뒤)" -Force | Out-Null
Write-Host ("예약 작업 '" + $TaskName + "'을 등록했습니다. 지금 한 번 수집해 연결을 확인합니다.")

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Collector -Site $Site
Write-Host ("기록 파일: " + (Join-Path $AppDir "collect.log"))
