# 전국 통합돌봄 대시보드 보도자료 PC 중계 수집기(운영자 승인 2026-10-06)
# 기관 웹방화벽이 해외 클라우드 서버 요청을 막는 게시판(제주시·서귀포시 등)의 목록 화면과 robots.txt를 이 PC에서 받아 대시보드에 올린다.
# 대시보드 서버가 평소 수집과 같은 규칙으로 제목·게시일·원문 링크만 뽑아 저장한다. 본문은 저장하지 않는다.
# 같은 기관 서버에는 한 번에 1건, 서버가 정한 간격(3초 이상)을 두고 요청한다. 토큰은 화면·로그에 남기지 않는다.
param([string]$Site = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site")

$ErrorActionPreference = "Stop"
if ($Site.TrimEnd('/') -cne 'https://integrated-care-national-dashboard.xgfox54.chatgpt.site') {
  throw "등록된 대시보드 HTTPS 주소만 사용할 수 있습니다."
}
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
$Web.MaxResponseContentBufferSize = 3000001

$Api = New-Object System.Net.Http.HttpClient
$Api.Timeout = [TimeSpan]::FromSeconds(120)
$Api.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $Token)

function Invoke-Dashboard([string]$Method, $Body, [string]$Path = "/api/press/relay") {
  $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), ($Site.TrimEnd("/") + $Path))
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
function Get-PageOnce([string]$Url, [string]$Accept, [int]$IntervalSec) {
  $uriHost = ([Uri]$Url).Host
  if ($LastHit.ContainsKey($uriHost)) {
    $wait = $IntervalSec - ((Get-Date) - $LastHit[$uriHost]).TotalSeconds
    if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
  }
  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Url)
  [void]$request.Headers.TryAddWithoutValidation("User-Agent", $UserAgent)
  [void]$request.Headers.TryAddWithoutValidation("Accept", $Accept)
  $item = @{ url = $Url; status = 0 }
  $response = $null
  try {
    $response = $Web.SendAsync($request).GetAwaiter().GetResult()
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $item.status = [int]$response.StatusCode
    if ($response.Headers.RetryAfter) {
      if ($response.Headers.RetryAfter.Delta) { $item.retryAfterSeconds = [int][Math]::Ceiling($response.Headers.RetryAfter.Delta.TotalSeconds) }
      elseif ($response.Headers.RetryAfter.Date) { $item.retryAfterSeconds = [int][Math]::Max(0, [Math]::Ceiling(($response.Headers.RetryAfter.Date - [DateTimeOffset]::UtcNow).TotalSeconds)) }
    }
    if ($response.Content.Headers.ContentType) { $item.contentType = $response.Content.Headers.ContentType.ToString() }
    $bytes = Convert-GeumsanPressPayload $Url $item.status $item.contentType $bytes
    if ($bytes.Length -gt 0 -and $bytes.Length -le $MaxBytes) { $item.bodyBase64 = [Convert]::ToBase64String($bytes) }
  } catch {
    $item.status = 0
  } finally {
    $LastHit[$uriHost] = Get-Date
    if ($null -ne $response) { $response.Dispose() }
    $request.Dispose()
  }
  return $item
}


# PRESS_RELAY_RELIABILITY_20261008: HTTP success and stored-item success are different.
function Get-RelayResultKind($Result) {
  if ($null -eq $Result -or $Result.ok -ne $true -or $null -eq $Result.summary) { return "failed" }
  switch ([string]$Result.summary.status) {
    "succeeded" { return "success" }
    "not_modified" { return "success" }
    "skipped_locked" { return "deferred" }
    "skipped_host_busy" { return "deferred" }
    "skipped_disabled" { return "deferred" }
    "skipped_blocked" { return "deferred" }
    default { return "failed" }
  }
}
function Get-RelayRetryDelay($Page, [int]$IntervalSec) {
  $status = [int]$Page.status
  if ($status -eq 0) { return [Math]::Max(3, $IntervalSec) }
  if ($status -eq 429 -or ($status -ge 500 -and $status -le 599)) {
    $wait = [Math]::Max(30, [Math]::Max($IntervalSec, [int]$Page.retryAfterSeconds))
    # Do not shorten a long Retry-After. Leave that source for a later scheduled attempt.
    if ($wait -gt 120) { return -1 }
    return $wait
  }
  return -1
}
function Get-Page([string]$Url, [string]$Accept, [int]$IntervalSec) {
  $page = Get-PageOnce $Url $Accept $IntervalSec
  $delay = Get-RelayRetryDelay $page $IntervalSec
  if ($delay -ge 0) {
    $script:NetworkRetries++
    Start-Sleep -Seconds $delay
    $page = Get-PageOnce $Url $Accept $IntervalSec
  }
  return $page
}
function Get-RelayExitCode([int]$Failed, [int]$Deferred) {
  if ($Failed -gt 0) { return 1 }
  if ($Deferred -gt 0) { return 3 }
  return 0
}

# PRESS_SERVER_TICK_20261009: 이 호스팅은 서버 예약 작업을 실행하지 않는다. 등록 PC가 인증된 정기 수집 경로를 불러
# 서버 직접 수집 대기열을 처리하게 한다. PC는 기관 서버에 요청하지 않으며 서버가 기존 실행권·호스트 간격 규칙으로 수집한다.
function Invoke-ServerTicks([int]$UntilSeconds) {
  $idle = 0
  while ($watch.Elapsed.TotalSeconds -lt $UntilSeconds -and $run.serverTick.calls -lt 60) {
    try { $tick = Invoke-Dashboard "POST" @{} "/api/press/tick" }
    catch { $run.serverTick.error = "TICK_REQUEST_FAILED"; Write-Log "서버 정기수집 호출 실패: 다음 예약 실행에서 재개합니다."; break }
    if ($null -eq $tick -or $tick.ok -ne $true) { $run.serverTick.error = "TICK_INVALID_RESPONSE"; break }
    Add-TickResult $run.serverTick $tick
    if ([string]$tick.status -eq "CRAWLER_DISABLED" -or [int]$tick.remainingDue -eq 0) { break }
    # 남은 작업이 있어도 다른 워커의 실행권·호스트 간격 때문에 이번 묶음이 비어 있을 수 있다.
    if ([int]$tick.succeeded + [int]$tick.failed -eq 0) { $idle++ } else { $idle = 0 }
    if ($idle -ge 3) { break }
    Start-Sleep -Seconds 4
  }
}
function Get-CombinedExitCode($Run) {
  if ($Run.failed -gt 0 -or $Run.serverTick.failed -gt 0 -or $Run.serverTick.error) { return 1 }
  if ($Run.deferred -gt 0 -or $Run.serverTick.deferred -gt 0 -or $null -eq $Run.serverTick.remainingDue -or $Run.serverTick.remainingDue -gt 0) { return 3 }
  if ($Run.Contains('slotCompletion') -and ($Run.slotCompletion -ne 'ALL_SUCCEEDED' -or $Run.queueAllSucceeded -ne $true -or $null -eq $Run.queueOpenJobs -or $Run.queueOpenJobs -gt 0)) { return 3 }
  return 0
}
function Add-TickResult($Total, $Tick) {
  $Total.calls++
  if ($null -eq $Tick) { return }
  $Total.attempted += [int]$Tick.attempted
  $Total.succeeded += [int]$Tick.succeeded
  $Total.failed += [int]$Tick.failed
  $Total.deferred += [int]$Tick.deferred
  $Total.created += [int]$Tick.created
  $Total.lastStatus = [string]$Tick.status
  $Total.remainingDue = [int]$Tick.remainingDue
  foreach ($item in @($Tick.sources)) {
    if ($null -ne $item -and [string]$item.status -eq "failed" -and $Total.failedSources.Count -lt 50) {
      $Total.failedSources += @{ sourceId = [string]$item.sourceId; errorCode = [string]$item.errorCode }
    }
  }
}

$claimed = $false
$exitCode = 0
$script:NetworkRetries = 0
$watch = [Diagnostics.Stopwatch]::StartNew()
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$run = [ordered]@{
  version = "2026-10-19-recovery-3"; runId = [Guid]::NewGuid().ToString("N")
  startedAt = [DateTimeOffset]::Now.ToString("o"); completedAt = $null
  pc = $null; sourceAttempts = 0; succeeded = 0; failed = 0; deferred = 0
  newItems = 0; feedItems = 0; networkRetries = 0; batches = 0
  reason = ""; failedSources = @(); exitCode = 0
  slotCompletion = 'UNVERIFIED'; queueOpenJobs = $null; queueAllSucceeded = $false; slotAt = $null
  serverTick = [ordered]@{ calls = 0; attempted = 0; succeeded = 0; failed = 0; deferred = 0; created = 0; lastStatus = ""; remainingDue = $null; error = ""; failedSources = @() }
}
$mutex = New-Object Threading.Mutex($false, "Local\IntegratedCarePressRelayCollector")
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) {
    Write-Log "같은 PC의 수집기가 이미 실행 중입니다. 중복 실행을 건너뜁니다."
  } else {
    # 중계 게시판이 느려도 서버 직접 수집은 먼저 시작한다. 남은 작업은 기존 15분 예약이 잇는다.
    Invoke-ServerTicks 180
    $stop = $false
    while (-not $stop -and $watch.Elapsed.TotalSeconds -lt 750) {
      $jobs = Invoke-Dashboard "GET" $null
      if ($null -eq $jobs -or -not $jobs.pc -or $null -eq $jobs.jobs) { throw "수집 목록 응답 형식이 올바르지 않습니다." }
      $run.pc = [string]$jobs.pc
      if ($jobs.busyBy) { $run.reason = "OTHER_PC_BUSY"; break }
      $list = @($jobs.jobs | Where-Object { $null -ne $_ -and $_.sourceId -and -not $seen.Contains([string]$_.sourceId) })
      if ($list.Count -eq 0) { $run.reason = "NO_MORE_DUE_SOURCES"; break }
      $claimed = $true
      $claimAt = [DateTimeOffset]::UtcNow
      $run.batches++
      Write-Log ("[" + $jobs.pc + "] 수집 시작: 게시판 " + $list.Count + "곳 / 묶음 " + $run.batches)
      foreach ($job in $list) {
        if ($watch.Elapsed.TotalSeconds -ge 750) { $run.deferred++; $run.reason = "RUN_TIME_BUDGET"; $stop = $true; break }
        # Renew before the server's 20-minute claim expires. Never continue under another PC's claim.
        if (([DateTimeOffset]::UtcNow - $claimAt).TotalSeconds -ge 480) {
          $renew = Invoke-Dashboard "GET" $null
          if ($null -eq $renew -or $renew.busyBy -or $renew.pc -ne $run.pc) {
            $run.deferred++; $run.reason = "CLAIM_NOT_RENEWED"; $claimed = $false; $stop = $true; break
          }
          $claimAt = [DateTimeOffset]::UtcNow
        }
        [void]$seen.Add([string]$job.sourceId)
        $run.sourceAttempts++
        $interval = [Math]::Max(3, [int]$job.intervalSec)
        try {
          $robots = Get-Page $job.robotsUrl "text/plain" $interval
          $page = Get-Page $job.endpointUrl $job.accept $interval
          $responses = @($robots, $page)
          # 제목 보완도 유지한다. 서버가 발급한 같은 기관의 원문 주소(최대 3곳)만 허용한다.
          foreach ($detailUrl in @($job.detailUrls | Select-Object -First 3)) {
            if ($detailUrl -and ([Uri]$detailUrl).Host -eq ([Uri]$job.endpointUrl).Host -and ([Uri]$detailUrl).Scheme -in @('https', 'http')) {
              $responses += ,(Get-Page $detailUrl "text/html" $interval)
            }
          }
          $result = Invoke-Dashboard "POST" @{ sourceId = $job.sourceId; responses = $responses }
          $kind = Get-RelayResultKind $result
          $summary = $result.summary
          if ($kind -eq "success") {
            $run.succeeded++
            if ($summary.counts) { $run.newItems += [int]$summary.counts.created; $run.feedItems += [int]$summary.counts.feedItems }
          } elseif ($kind -eq "deferred") { $run.deferred++ }
          else { $run.failed++; $run.failedSources += @{ sourceId = [string]$job.sourceId; errorCode = [string]$summary.errorCode; status = [string]$summary.status } }
          $created = if ($summary.counts) { [int]$summary.counts.created } else { 0 }
          Write-Log ("  " + $job.sourceId + ": 목록 HTTP " + $page.status + ", 저장결과 " + $summary.status + " " + $summary.errorCode + ", 새 항목 " + $created + "건")
        } catch {
          $run.failed++
          $run.failedSources += @{ sourceId = [string]$job.sourceId; errorCode = "CLIENT_OR_UPLOAD_ERROR"; status = "failed" }
          # Do not print exception messages that may include request headers or credentials.
          Write-Log ("  " + $job.sourceId + ": 수집/업로드 실패(" + $_.Exception.GetType().Name + ")")
        }
      }
    }
    if ($watch.Elapsed.TotalSeconds -ge 900 -and -not $run.reason) { $run.deferred++; $run.reason = "RUN_TIME_BUDGET" }
    $exitCode = Get-RelayExitCode $run.failed $run.deferred
    # 중계 차례를 먼저 반납해 다른 PC의 중계 수집을 막지 않는다.
    if ($claimed) {
      try { [void](Invoke-Dashboard "POST" @{ done = $true }); $claimed = $false }
      catch { $run.failed++; $exitCode = 1; $claimed = $false; Write-Log "수집 차례 반납 실패: 서버의 기존 만료 규칙으로 해제됩니다." }
    }
    # 서버 직접 수집 대기열: 한 번 부를 때 서버가 최대 25초 동안 서로 다른 기관 서버를 제한된 수만큼 처리한다.
    Invoke-ServerTicks 870
    $exitCode = Get-CombinedExitCode $run
  }
} catch {
  $run.failed++
  $run.reason = "COLLECTION_REQUEST_FAILED"
  $exitCode = 1
  Write-Log ("수집 실행 실패(" + $_.Exception.GetType().Name + ")")
} finally {
  if ($claimed) {
    try { [void](Invoke-Dashboard "POST" @{ done = $true }) }
    catch { $run.failed++; $exitCode = 1; Write-Log "수집 차례 반납 실패: 서버의 기존 만료 규칙으로 해제됩니다." }
  }
  if ($locked) {
    try {
      $finalStatus = Invoke-Dashboard 'GET' $null '/api/press/status/detail'
      $run.slotCompletion = [string]$finalStatus.schedule.current_slot.combined.completion
      $run.slotAt = [string]$finalStatus.schedule.current_slot.slot_at
      $run.queueOpenJobs = $finalStatus.schedule.queue.open_jobs
      $run.queueAllSucceeded = $finalStatus.schedule.queue.complete -eq $true
    } catch { Write-Log '회차 완료 상태를 확인하지 못했습니다. 다음 예약에서 확인합니다.' }
    $exitCode = Get-CombinedExitCode $run
    $run.completedAt = [DateTimeOffset]::Now.ToString("o")
    $run.networkRetries = $script:NetworkRetries
    $run.exitCode = $exitCode
    $json = ConvertTo-Json -InputObject $run -Depth 6
    $temp = Join-Path $AppDir ("last-run." + $run.runId + ".tmp")
    [IO.File]::WriteAllText($temp, $json, (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists((Join-Path $AppDir "last-run.json"))) {
      [IO.File]::Replace($temp, (Join-Path $AppDir "last-run.json"), [System.Management.Automation.Language.NullString]::Value)
    } else { [IO.File]::Move($temp, (Join-Path $AppDir "last-run.json")) }
    Write-Log ("수집결과: 시도 " + $run.sourceAttempts + ", 저장성공 " + $run.succeeded + ", 실패 " + $run.failed + ", 보류 " + $run.deferred + ", 신규 " + $run.newItems + ", 네트워크 재시도 " + $run.networkRetries + ", 종료코드 " + $exitCode)
    $t = $run.serverTick
    Write-Log ("서버 정기수집: 호출 " + $t.calls + ", 처리 " + $t.attempted + ", 성공 " + $t.succeeded + ", 실패 " + $t.failed + ", 미룸 " + $t.deferred + ", 신규 " + $t.created + ", 마지막 " + $t.lastStatus + ", 남은 대기 " + $t.remainingDue + $(if ($t.error) { ", 오류 " + $t.error } else { "" }))
    Limit-Log
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
  $Web.Dispose()
  $Api.Dispose()
}
exit $exitCode
