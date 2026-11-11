param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $russian = $voice.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ru-RU' } | Select-Object -First 1
    if (-not $russian) { throw 'Install a Russian Windows speech voice.' }
    $voice.SelectVoice($russian.VoiceInfo.Name)
    $voice.Rate = 0
    $scenes = Get-Content (Join-Path $PSScriptRoot 'scenes.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    for ($i = 0; $i -lt $scenes.Count; $i++) {
        $voice.SetOutputToWaveFile((Join-Path $OutputDirectory "$i.wav"))
        $voice.Speak($scenes[$i].speech)
        $voice.SetOutputToNull()
    }
} finally {
    $voice.Dispose()
}
