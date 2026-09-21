#define MyAppName "Bulka — печать этикеток"
#define MyAppVersion "1.0.1"
#define MyAppExeName "bulka_price_printer.exe"

[Setup]
AppId={{B8B46328-39CA-4C46-A461-09C082D29C35}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\Bulka Price Printer
DefaultGroupName=Bulka
OutputDir=output
OutputBaseFilename=Bulka-Price-Printer-Setup-1.0.1
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
WizardStyle=modern

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Files]
Source: "..\dist\BulkaPricePrinter\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Ярлыки:"; Flags: checkedonce

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Запустить {#MyAppName}"; Flags: nowait postinstall skipifsilent
