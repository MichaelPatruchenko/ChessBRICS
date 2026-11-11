param(
    [ValidateSet('deploy','update','start','stop','restart','status','logs')]
    [string]$Action = 'deploy'
)
$ErrorActionPreference = 'Stop'
function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "docker $args failed (exit $LASTEXITCODE)" }
}
function Wait-Service {
    try {
        Invoke-Docker compose up -d --no-build --wait --wait-timeout 60
    } catch {
        & docker compose logs --tail 60 chessbrics
        throw
    }
    Invoke-Docker compose port chessbrics 3000
}
Push-Location $PSScriptRoot
try {
    Invoke-Docker compose version
    Invoke-Docker info --format '{{.ServerVersion}}'
    switch ($Action) {
        { $_ -in 'deploy','update' } { Invoke-Docker compose build; Wait-Service }
        'start' { Wait-Service }
        'stop' { Invoke-Docker compose stop }
        'restart' { Invoke-Docker compose restart; Wait-Service }
        'status' { Invoke-Docker compose ps }
        'logs' { Invoke-Docker compose logs --tail 100 chessbrics }
    }
} finally {
    Pop-Location
}
