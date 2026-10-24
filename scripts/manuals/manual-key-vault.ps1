param([ValidateSet('store','get','fingerprint')][string]$Mode='fingerprint')
$ErrorActionPreference = 'Stop'
[void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$resource = 'IntegratedCareDashboard'
$user = 'MANUAL_CORPUS_KEY'
if ($Mode -eq 'store') {
  if (-not $env:MANUAL_CORPUS_KEY_INPUT) { throw 'MANUAL_CORPUS_KEY_INPUT is empty' }
  try { $vault.Remove($vault.Retrieve($resource, $user)) } catch { }
  $vault.Add((New-Object Windows.Security.Credentials.PasswordCredential($resource, $user, $env:MANUAL_CORPUS_KEY_INPUT)))
}
$credential = $vault.Retrieve($resource, $user)
$credential.RetrievePassword()
if ($Mode -eq 'get') { [Console]::Out.Write($credential.Password); exit 0 }
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Convert]::FromBase64String($credential.Password))
([BitConverter]::ToString($hash) -replace '-', '').ToLower().Substring(0, 24)
