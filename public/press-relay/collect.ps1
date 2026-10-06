# 전국 통합돌봄 대시보드 보도자료 PC 중계 수집기(운영자 승인 2026-10-06)
# 기관 웹방화벽이 해외 클라우드 서버 요청을 막는 게시판(제주시·서귀포시 등)의 목록 화면과 robots.txt를 이 PC에서 받아 대시보드에 올린다.
# 대시보드 서버가 평소 수집과 같은 규칙으로 제목·게시일·원문 링크만 뽑아 저장한다. 본문은 저장하지 않는다.
# 같은 기관 서버에는 한 번에 1건, 서버가 정한 간격(3초 이상)을 두고 요청한다. 토큰은 화면·로그에 남기지 않는다.
param([string]$Site = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site")

$ErrorActionPreference = "Stop"
# AppData는 일부 앱(MSIX) 안에서 실행하면 앱 전용 저장소로 돌려져 작업 스케줄러가 못 찾는다. 사용자 폴더에 둔다.
$AppDir = Join-Path $env:USERPROFILE "IntegratedCarePressRelay"
$TokenFile = Join-Path $AppDir "token.dat"
$LogFile = Join-Path $AppDir "collect.log"
$UserAgent = "IntegratedCareDashboard-PressArchive/1.0"
$MaxBytes = 2000000

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

function Write-Log([string]$Message) {
  $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " " + $Message
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Limit-Log {
  if (-not (Test-Path -LiteralPath $LogFile)) { return }
  $lines = Get-Content -LiteralPath $LogFile -Encoding UTF8
  if ($lines.Count -gt 1000) { $lines | Select-Object -Last 500 | Set-Content -LiteralPath $LogFile -Encoding UTF8 }
}

if (-not (Test-Path -LiteralPath $TokenFile)) {
  Write-Log "토큰 파일이 없습니다. install.ps1로 먼저 등록하세요."
  exit 2
}
$secure = Get-Content -LiteralPath $TokenFile | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# 기관 서버용: 리다이렉트를 따라가지 않고(서버 수집기와 같음) 쿠키를 쓰지 않는다.
$webHandler = New-Object System.Net.Http.HttpClientHandler
$webHandler.AllowAutoRedirect = $false
$webHandler.UseCookies = $false
$webHandler.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
$Web = New-Object System.Net.Http.HttpClient($webHandler)
$Web.Timeout = [TimeSpan]::FromSeconds(30)

$Api = New-Object System.Net.Http.HttpClient
$Api.Timeout = [TimeSpan]::FromSeconds(120)
$Api.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $Token)

function Invoke-Dashboard([string]$Method, $Body) {
  $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), ($Site.TrimEnd("/") + "/api/press/relay"))
  if ($null -ne $Body) {
    $json = ConvertTo-Json -InputObject $Body -Depth 6 -Compress
    $request.Content = New-Object System.Net.Http.StringContent($json, [Text.Encoding]::UTF8, "application/json")
  }
  $response = $Api.SendAsync($request).GetAwaiter().GetResult()
  $text = [Text.Encoding]::UTF8.GetString($response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult())
  $parsed = $null
  if ($text) { try { $parsed = ConvertFrom-Json -InputObject $text } catch { $parsed = $null } }
  if (-not $response.IsSuccessStatusCode) {
    $reason = if ($parsed -and $parsed.error) { $parsed.error } else { "HTTP " + [int]$response.StatusCode }
    throw ("대시보드 응답 오류: " + $reason)
  }
  return $parsed
}

function Convert-GeumsanPressPayload([string]$Url, [int]$Status, [string]$ContentType, [byte[]]$Bytes) {
  # 금산 목록의 대형 인라인 장식 이미지만 제외한다. 원문·메타데이터·보안 안내는 그대로 두며 전달 상한은 유지한다.
  if ($Status -ne 200 -or $Bytes.Length -le 2000000 -or $Bytes.Length -gt 3000000) { return ,$Bytes }
  $uri = [Uri]$Url
  if ($uri.Scheme -ne "https" -or $uri.Host -ne "www.geumsan.go.kr" -or $uri.AbsolutePath -cne "/kr/html/sub03/030301.html") { return ,$Bytes }
  if ($ContentType -notmatch '^text/html(?:;|$)' -or $ContentType -notmatch 'charset\s*=\s*"?utf-?8') { return ,$Bytes }
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  try { $html = $utf8.GetString($Bytes) } catch { return ,$Bytes }
  $html = [regex]::Replace($html, '(?is)(<(?:img|image)\b[^>]*\b(?:src|(?:xlink:)?href)\s*=\s*["''])data:image/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+(["''])', '$1$2')
  return ,($utf8.GetBytes($html))
}

$LastHit = @{}
function Get-Page([string]$Url, [string]$Accept, [int]$IntervalSec) {
  $uriHost = ([Uri]$Url).Host
  if ($LastHit.ContainsKey($uriHost)) {
    $wait = $IntervalSec - ((Get-Date) - $LastHit[$uriHost]).TotalSeconds
    if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
  }
  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Url)
  [void]$request.Headers.TryAddWithoutValidation("User-Agent", $UserAgent)
  [void]$request.Headers.TryAddWithoutValidation("Accept", $Accept)
  $item = @{ url = $Url; status = 0 }
  try {
    $response = $Web.SendAsync($request).GetAwaiter().GetResult()
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $item.status = [int]$response.StatusCode
    if ($response.Content.Headers.ContentType) { $item.contentType = $response.Content.Headers.ContentType.ToString() }
    $bytes = Convert-GeumsanPressPayload $Url $item.status $item.contentType $bytes
    if ($bytes.Length -gt 0 -and $bytes.Length -le $MaxBytes) { $item.bodyBase64 = [Convert]::ToBase64String($bytes) }
  } catch {
    $item.status = 0
  } finally {
    $LastHit[$uriHost] = Get-Date
  }
  return $item
}

$claimed = $false
try {
  $jobs = Invoke-Dashboard "GET" $null
  if ($jobs.busyBy) { Write-Log ("다른 수집 PC(" + $jobs.busyBy + ")가 수집 중이라 이번에는 건너뜁니다."); exit 0 }
  $list = @($jobs.jobs)
  if ($list.Count -eq 0) { Write-Log ("[" + $jobs.pc + "] 지금 수집할 게시판이 없습니다."); exit 0 }
  $claimed = $true
  Write-Log ("[" + $jobs.pc + "] 수집 시작: 게시판 " + $list.Count + "곳")
  foreach ($job in $list) {
    $interval = [Math]::Max(3, [int]$job.intervalSec)
    $robots = Get-Page $job.robotsUrl "text/plain" $interval
    $page = Get-Page $job.endpointUrl $job.accept $interval
    try {
      $result = Invoke-Dashboard "POST" @{ sourceId = $job.sourceId; responses = @($robots, $page) }
      $summary = $result.summary
      $created = if ($summary.counts) { $summary.counts.created } else { 0 }
      Write-Log ("  " + $job.sourceId + ": 목록 HTTP " + $page.status + ", 결과 " + $summary.status + " " + $summary.errorCode + ", 새 항목 " + $created + "건")
    } catch {
      Write-Log ("  " + $job.sourceId + ": 올리지 못함 - " + $_.Exception.Message)
    }
  }
} catch {
  Write-Log ("수집 실패: " + $_.Exception.Message)
  exit 1
} finally {
  if ($claimed) { try { [void](Invoke-Dashboard "POST" @{ done = $true }) } catch { Write-Log ("차례 반납 실패(20분 뒤 자동 해제): " + $_.Exception.Message) } }
  Limit-Log
}
