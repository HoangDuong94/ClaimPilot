# Requires: PowerShell 5+ (Windows), Docker optional for verification
# Usage examples:
#   ./scripts/deploy-postgres.ps1
#   ./scripts/deploy-postgres.ps1 -Profile hybrid -Verify -UseDocker
#   ./scripts/deploy-postgres.ps1 -DatabaseUrl "postgres://user:pass@127.0.0.1:5433/db" -Verify

param(
  [string]$Profile = 'hybrid',
  [string]$DatabaseUrl,
  [string]$PgHost,
  [string]$PgPort,
  [string]$PgDatabase,
  [string]$PgUser,
  [string]$PgPassword,
  [switch]$Verify,
  [switch]$CreateDraftArtifacts = $true,
  [switch]$UseDocker,
  [string]$Container = 'claimspilot-postgres'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Load-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 0) { return }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
  }
}

Load-DotEnv (Join-Path $PSScriptRoot '..\.env')

# Fallback to environment variables if parameters were not provided
if (-not $DatabaseUrl) { $DatabaseUrl = $env:DATABASE_URL }
if (-not $PgHost) { $PgHost = $env:POSTGRES_HOST }
if (-not $PgPort) { $PgPort = $env:POSTGRES_PORT }
if (-not $PgDatabase) { $PgDatabase = $env:POSTGRES_DATABASE }
if (-not $PgUser) { $PgUser = $env:POSTGRES_USER }
if (-not $PgPassword) { $PgPassword = $env:POSTGRES_PASSWORD }

# Auto-switch to Docker when psql isn't available locally
if (-not $UseDocker -and -not (Get-Command psql -ErrorAction SilentlyContinue)) {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host "psql not found on PATH. Falling back to docker exec $Container" -ForegroundColor DarkYellow
    $UseDocker = $true
  }
}

function Write-Header($text) {
  Write-Host "`n=== $text ===" -ForegroundColor Cyan
}

function Resolve-NpxCommand() {
  $preferredNames = @('npx.cmd', 'npx.exe', 'npx')
  foreach ($name in $preferredNames) {
    try {
      $cmdInfos = Get-Command $name -ErrorAction Stop
      foreach ($ci in $cmdInfos) {
        if (-not $ci.Source) { continue }
        $ext = [System.IO.Path]::GetExtension($ci.Source)
        if ($ext -eq '.cmd' -or $ext -eq '.exe') {
          return $ci.Source
        }
        if ($ci.CommandType -eq 'Application' -and $ext -ne '.ps1') {
          return $ci.Source
        }
      }
    } catch {}
  }
  return $null
}

function Build-DatabaseUrl() {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    $hostValue = if ([string]::IsNullOrWhiteSpace($PgHost)) { '127.0.0.1' } else { $PgHost }
    $portValue = if ([string]::IsNullOrWhiteSpace($PgPort)) { '5432' } else { $PgPort }
    if ([string]::IsNullOrWhiteSpace($PgDatabase)) { throw 'POSTGRES_DATABASE is not set and no -DatabaseUrl given.' }
    if ([string]::IsNullOrWhiteSpace($PgUser)) { throw 'POSTGRES_USER is not set and no -DatabaseUrl given.' }
    if ([string]::IsNullOrWhiteSpace($PgPassword)) { throw 'POSTGRES_PASSWORD is not set and no -DatabaseUrl given.' }
    $DatabaseUrl = "postgres://$PgUser`:$PgPassword@$hostValue`:$portValue/$PgDatabase"
  }
  return $DatabaseUrl
}

function Run-Deploy($url) {
  Write-Header "cds deploy to Postgres ($Profile)"
  $to = "postgres:$url"
  $npxCmd = Resolve-NpxCommand
  if (-not $npxCmd) {
    throw 'Unable to locate npx executable (.cmd/.exe). Ensure Node.js is installed and npx is available in PATH.'
  }
  $args = @('cds','deploy','--to', $to, '--profile', $Profile)
  Write-Host "Running: `"$npxCmd`" cds deploy --to `"$to`" --profile $Profile" -ForegroundColor Yellow
  & "$npxCmd" @args
  if ($LASTEXITCODE -ne 0) {
    throw "cds deploy failed with exit code $LASTEXITCODE"
  }
  Write-Host "Deploy completed" -ForegroundColor Green
}

function Invoke-PSQL {
  param(
    [Parameter(Mandatory=$true)][string]$Sql,
    [string]$Url
  )
  if ($UseDocker) {
    if (-not $PgUser -or -not $PgDatabase) { throw 'For -UseDocker please provide -PgUser and -PgDatabase or set POSTGRES_USER/POSTGRES_DATABASE' }
    Write-Host "docker exec $Container psql -U $PgUser -d $PgDatabase -c \"...\"" -ForegroundColor DarkGray
    docker exec $Container psql -U $PgUser -d $PgDatabase -v ON_ERROR_STOP=1 -c $Sql | Out-Host
  } else {
    if (-not $Url) { $Url = (Build-DatabaseUrl) }
    if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql not found. Install PostgreSQL client or use -UseDocker.' }
    psql $Url -v ON_ERROR_STOP=1 -c $Sql | Out-Host
  }
}

function Create-DraftObjects($url) {
  Write-Header "Creating Draft tables and view in public schema"
  $sql1 = @'
CREATE TABLE IF NOT EXISTS draft_draftadministrativedata (
  draftuuid VARCHAR(36) PRIMARY KEY,
  creationdatetime TIMESTAMP,
  createdbyuser VARCHAR(256),
  createdbyuserdescription VARCHAR(256),
  draftiscreatedbyme BOOLEAN,
  lastchangedatetime TIMESTAMP,
  lastchangedbyuser VARCHAR(256),
  lastchangedbyuserdescription VARCHAR(256),
  inprocessbyuser VARCHAR(256),
  inprocessbyuserdescription VARCHAR(256),
  draftisprocessedbyme BOOLEAN,
  draftmessages TEXT
);
'@
  $sql2 = @'
CREATE TABLE IF NOT EXISTS kfzservice_claim_drafts (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP NULL,
  createdby VARCHAR(255) NULL,
  modifiedat TIMESTAMP NULL,
  modifiedby VARCHAR(255) NULL,
  claimnumber VARCHAR(30) NULL,
  status VARCHAR(30) NULL,
  lossdate TIMESTAMP NULL,
  reporteddate TIMESTAMP NULL,
  description TEXT NULL,
  severity VARCHAR(10) NULL,
  reserveamount DECIMAL(15,2) NULL,
  policy_id VARCHAR(36) NULL,
  vehicle_id VARCHAR(36) NULL,
  isactiveentity BOOLEAN,
  hasactiveentity BOOLEAN,
  hasdraftentity BOOLEAN,
  draftadministrativedata_draftuuid VARCHAR(36) NOT NULL
);
'@
  $sql3 = @'
CREATE TABLE IF NOT EXISTS kfzservice_email_drafts (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP NULL,
  createdby VARCHAR(255) NULL,
  modifiedat TIMESTAMP NULL,
  modifiedby VARCHAR(255) NULL,
  messageid VARCHAR(120) NULL,
  subject VARCHAR(255) NULL,
  fromaddress VARCHAR(255) NULL,
  receivedat TIMESTAMP NULL,
  hasattachments BOOLEAN NULL,
  claim_id VARCHAR(36) NULL,
  isactiveentity BOOLEAN,
  hasactiveentity BOOLEAN,
  hasdraftentity BOOLEAN,
  draftadministrativedata_draftuuid VARCHAR(36) NOT NULL
);
'@
  $sql4 = @'
CREATE TABLE IF NOT EXISTS kfzservice_document_drafts (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP NULL,
  createdby VARCHAR(255) NULL,
  modifiedat TIMESTAMP NULL,
  modifiedby VARCHAR(255) NULL,
  filename VARCHAR(255) NULL,
  mimetype VARCHAR(60) NULL,
  storageref VARCHAR(255) NULL,
  source VARCHAR(20) NULL,
  claim_id VARCHAR(36) NULL,
  isactiveentity BOOLEAN,
  hasactiveentity BOOLEAN,
  hasdraftentity BOOLEAN,
  draftadministrativedata_draftuuid VARCHAR(36) NOT NULL
);
'@
  $sql5 = @'
CREATE TABLE IF NOT EXISTS kfzservice_task_drafts (
  id VARCHAR(36) PRIMARY KEY,
  createdat TIMESTAMP NULL,
  createdby VARCHAR(255) NULL,
  modifiedat TIMESTAMP NULL,
  modifiedby VARCHAR(255) NULL,
  type VARCHAR(40) NULL,
  status VARCHAR(20) NULL,
  duedate DATE NULL,
  assignee VARCHAR(100) NULL,
  claim_id VARCHAR(36) NULL,
  isactiveentity BOOLEAN,
  hasactiveentity BOOLEAN,
  hasdraftentity BOOLEAN,
  draftadministrativedata_draftuuid VARCHAR(36) NOT NULL
);
'@
  $sql6 = @'
CREATE OR REPLACE VIEW kfzservice_draftadministrativedata AS
SELECT
  draftuuid,
  creationdatetime,
  createdbyuser,
  createdbyuserdescription,
  draftiscreatedbyme,
  lastchangedatetime,
  lastchangedbyuser,
  lastchangedbyuserdescription,
  inprocessbyuser,
  inprocessbyuserdescription,
  draftisprocessedbyme,
  draftmessages
FROM draft_draftadministrativedata;
'@

  $stmts = @($sql1,$sql2,$sql3,$sql4,$sql5,$sql6)
  foreach ($sql in $stmts) { Invoke-PSQL -Sql $sql -Url $url }

  Write-Host "Draft objects ensured in public schema" -ForegroundColor Green
}

function Verify-Database($url) {
  Write-Header "Verifying Postgres objects"
  $sql1 = "select to_regclass('public.kfzservice_claim_drafts') as claim_drafts, to_regclass('public.kfzservice_email_drafts') as email_drafts, to_regclass('public.kfzservice_document_drafts') as document_drafts, to_regclass('public.kfzservice_task_drafts') as task_drafts, to_regclass('public.kfzservice_draftadministrativedata') as view_da;"
  $sql2 = "select relkind, relname from pg_class where relname like 'kfzservice_%' order by relname;"
  $sql3 = "show search_path; select current_schema();"
  Invoke-PSQL -Sql $sql1 -Url $url
  Invoke-PSQL -Sql $sql2 -Url $url
  Invoke-PSQL -Sql $sql3 -Url $url
}

try {
  $url = Build-DatabaseUrl
  Run-Deploy -url $url
  if ($CreateDraftArtifacts) { Create-DraftObjects -url $url }
  if ($Verify) { Verify-Database -url $url }
  Write-Host "`nDone." -ForegroundColor Green
} catch {
  Write-Host "Deployment script failed" -ForegroundColor Red
  $_ | Format-List * -Force
  exit 1
}
