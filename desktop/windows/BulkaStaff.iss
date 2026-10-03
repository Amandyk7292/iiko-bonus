#ifndef BuildRoot
  #error BuildRoot must identify the verified build payload directory.
#endif
#define MyAppVersion "1.0.0"
#define MyAppName "Bulka — кассир"

[Setup]
AppId={{643E9AF2-4135-47AB-BDCC-C71140B42D4E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Bulka
AppPublisherURL=https://bulka.com.kz/
DefaultDirName={localappdata}\Programs\Bulka Staff
DefaultGroupName=Bulka
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
MinVersion=6.1
ArchitecturesAllowed=x86compatible x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#BuildRoot}\release
OutputBaseFilename=Bulka-Staff-Setup-{#MyAppVersion}-Universal
SetupIconFile=app.ico
UninstallDisplayIcon={app}\BulkaStaff.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
AppMutex=Local\Bulka.Staff.Launcher.v1
CloseApplications=yes
CloseApplicationsFilter=*.exe,*.dll
RestartApplications=no
LicenseFile={#BuildRoot}\distribution-notices.txt
InfoAfterFile=install-notes.txt

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык Bulka на рабочем столе"; Flags: checkedonce

[Files]
Source: "{#BuildRoot}\payload\x86\BulkaStaff.exe"; DestDir: "{app}"; Check: not IsX64Compatible; Flags: ignoreversion
Source: "{#BuildRoot}\payload\x64\BulkaStaff.exe"; DestDir: "{app}"; Check: IsX64Compatible; Flags: ignoreversion
Source: "{#BuildRoot}\payload\x86\runtime\*"; DestDir: "{app}\runtime"; Check: not IsX64Compatible; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildRoot}\payload\x64\runtime\*"; DestDir: "{app}\runtime"; Check: IsX64Compatible; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildRoot}\distribution-notices.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BuildRoot}\runtime-lock.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Bulka\{#MyAppName}"; Filename: "{app}\BulkaStaff.exe"
Name: "{autoprograms}\Bulka\Восстановить соединение"; Filename: "{app}\BulkaStaff.exe"; Parameters: "--reconnect"
Name: "{autoprograms}\Bulka\Удалить Bulka — кассир"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\BulkaStaff.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\BulkaStaff.exe"; Description: "Открыть {#MyAppName}"; Flags: nowait postinstall skipifsilent

; The browser profile is outside {app}. No profile/cookie cleanup is performed.
