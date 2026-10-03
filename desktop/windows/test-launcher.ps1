[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$LauncherPath,
    [ValidateSet('x86', 'x64')][string]$FixtureArchitecture = 'x86',
    [string]$VisualCppDirectory = 'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30133',
    [string]$WindowsSdkDirectory = 'C:\Program Files (x86)\Windows Kits\10',
    [string]$WindowsSdkVersion = '10.0.19041.0'
)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testDirectory = Join-Path $repositoryRoot ('outputs\windows-launcher-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testDirectory 'runtime') -Force | Out-Null
$testLauncher = Join-Path $testDirectory 'BulkaStaff.exe'
$testBrowser = Join-Path $testDirectory 'runtime\chrome.exe'
$tracePath = Join-Path $testDirectory 'browser-contract.txt'
Copy-Item -LiteralPath $LauncherPath -Destination $testLauncher
$stubSource = @'
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <string>
void Trace(const char* value) {
    wchar_t path[32768] = {};
    GetEnvironmentVariableW(L"BULKA_STAFF_TEST_TRACE", path, 32768);
    HANDLE file = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
        nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file != INVALID_HANDLE_VALUE) {
        DWORD written = 0; WriteFile(file, value, static_cast<DWORD>(strlen(value)), &written, nullptr); CloseHandle(file);
    }
}
LRESULT CALLBACK WindowProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_KEYDOWN && wParam == VK_F5) Trace("reconnect\n");
    if (message == WM_CLOSE) { DestroyWindow(window); return 0; }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, wParam, lParam);
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    int count = 0; wchar_t** arguments = CommandLineToArgvW(GetCommandLineW(), &count);
    wchar_t appData[MAX_PATH] = {}; SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, appData);
    const std::wstring expectedProfile = std::wstring(L"--user-data-dir=") + appData + L"\\Bulka\\Staff\\Profile";
    if (count != 6 || std::wstring(arguments[1]) != L"--app=https://bulka.com.kz/?desktop=1" ||
        std::wstring(arguments[2]) != expectedProfile || std::wstring(arguments[3]) != L"--start-maximized" ||
        std::wstring(arguments[4]) != L"--no-first-run" || std::wstring(arguments[5]) != L"--no-default-browser-check") {
        Trace("unsafe-or-incorrect-arguments\n"); LocalFree(arguments); return 10;
    }
    LocalFree(arguments); Trace("url-profile-flags-ok\n"); Trace("started\n");
    WNDCLASSW windowClass = {}; windowClass.lpfnWndProc = WindowProcedure; windowClass.hInstance = instance;
    windowClass.lpszClassName = L"Chrome_WidgetWin_1"; RegisterClassW(&windowClass);
    HWND window = CreateWindowExW(0, windowClass.lpszClassName, L"Bulka test fixture", WS_OVERLAPPEDWINDOW,
        -32000, -32000, 1200, 800, nullptr, nullptr, instance, nullptr);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    MSG message = {}; while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    return 0;
}
'@
$stubPath = Join-Path $testDirectory 'browser-fixture.cpp'
[IO.File]::WriteAllText($stubPath, $stubSource, [Text.Encoding]::UTF8)
$sdkInclude = Join-Path $WindowsSdkDirectory "Include\$WindowsSdkVersion"
$sdkLibrary = Join-Path $WindowsSdkDirectory "Lib\$WindowsSdkVersion"
$compiler = Join-Path $VisualCppDirectory "bin\Hostx64\$FixtureArchitecture\cl.exe"
$compilerArguments = @('/nologo', '/MT', '/EHsc', '/utf-8', '/DUNICODE', '/D_UNICODE', '/DWINVER=0x0601', '/D_WIN32_WINNT=0x0601',
    "/I$VisualCppDirectory\include", "/I$sdkInclude\um", "/I$sdkInclude\shared", "/I$sdkInclude\ucrt",
    "/Fo$testDirectory\browser-fixture.obj", "/Fe$testBrowser", $stubPath, '/link',
    "/LIBPATH:$VisualCppDirectory\lib\$FixtureArchitecture", "/LIBPATH:$sdkLibrary\um\$FixtureArchitecture", "/LIBPATH:$sdkLibrary\ucrt\$FixtureArchitecture",
    '/SUBSYSTEM:WINDOWS,6.01', 'kernel32.lib', 'user32.lib', 'shell32.lib', 'ole32.lib')
& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0) { throw 'Browser contract fixture compilation failed.' }
$fixtureBytes = [IO.File]::ReadAllBytes($testBrowser)
$fixturePeOffset = [BitConverter]::ToInt32($fixtureBytes, 0x3c)
$fixtureMachine = [BitConverter]::ToUInt16($fixtureBytes, $fixturePeOffset + 4)
$expectedFixtureMachine = if ($FixtureArchitecture -eq 'x86') { 0x14c } else { 0x8664 }
if ($fixtureMachine -ne $expectedFixtureMachine) { throw 'Browser fixture architecture did not match the requested contract.' }
$launcherBytes = [IO.File]::ReadAllBytes($testLauncher)
$launcherPeOffset = [BitConverter]::ToInt32($launcherBytes, 0x3c)
$launcherMachine = [BitConverter]::ToUInt16($launcherBytes, $launcherPeOffset + 4)
$originalTrace = $env:BULKA_STAFF_TEST_TRACE
$env:BULKA_STAFF_TEST_TRACE = $tracePath
$primary = $null
try {
    $primary = Start-Process -FilePath $testLauncher -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 200
        $trace = if (Test-Path -LiteralPath $tracePath) { [IO.File]::ReadAllText($tracePath) } else { '' }
    } until ($trace.Contains('started') -or (Get-Date) -gt $deadline)
    if (-not $trace.Contains('url-profile-flags-ok') -or $trace.Contains('unsafe-or-incorrect')) { throw 'Fixed live URL, profile isolation or browser flags did not match the contract.' }
    $second = Start-Process -FilePath $testLauncher -WindowStyle Hidden -PassThru
    if (-not $second.WaitForExit(6000) -or $second.ExitCode -ne 0) { throw 'Second launch did not activate the existing launcher.' }
    Start-Sleep -Milliseconds 1200
    $trace = [IO.File]::ReadAllText($tracePath)
    if (([regex]::Matches($trace, '(?m)^started$')).Count -ne 1) { throw 'Second launch created another browser process/window.' }
    if ($primary.HasExited) { throw 'The launcher exited while its browser window was active.' }
    $result = [ordered]@{
        fixedLiveUrl = $true; isolatedPersistentProfile = $true; safeBrowserArguments = $true
        secondLaunchReusesWindow = $true; launcherTracksActiveWindow = $true
        launcherMachine = ('0x{0:x}' -f $launcherMachine); fixtureArchitecture = $FixtureArchitecture
        fixtureMachine = ('0x{0:x}' -f $fixtureMachine)
        fixture = 'native browser contract; not a real browser or Windows 7 compatibility test'
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testDirectory 'test-report.json') -Encoding UTF8
    Write-Host "Native launcher contract passed: $testDirectory"
}
finally {
    $env:BULKA_STAFF_TEST_TRACE = $originalTrace
    Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $testBrowser } | Stop-Process
    if ($primary -and -not $primary.HasExited) { $primary.WaitForExit(7000) | Out-Null }
    if ($primary -and -not $primary.HasExited) { Stop-Process -Id $primary.Id }
}
