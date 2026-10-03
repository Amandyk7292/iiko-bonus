#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <string>
#include <vector>

namespace {
const wchar_t* const kAppName = L"Bulka — кассир";
const wchar_t* const kUrl = L"https://bulka.com.kz/?desktop=1";
const wchar_t* const kMutexName = L"Local\\Bulka.Staff.Launcher.v1";
const wchar_t* const kWindowClass = L"BulkaStaffLauncherWindowV1";
const UINT kActivateMessage = WM_APP + 1;
std::wstring browserPath;
std::wstring profilePath;
HANDLE browserProcess = nullptr;
DWORD browserPid = 0;
ULONGLONG startedAt = 0;
ULONGLONG lastWindowAt = 0;
bool sawBrowserWindow = false;
bool pendingReconnect = false;

void ShowError(const wchar_t* message) {
    MessageBoxW(nullptr, message, kAppName, MB_OK | MB_ICONERROR);
}

std::wstring QuoteArgument(const std::wstring& value) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t character : value) {
        if (character == L'\\') { ++slashes; continue; }
        result.append(slashes * (character == L'\"' ? 2 : 1), L'\\');
        slashes = 0;
        if (character == L'\"') result.push_back(L'\\');
        result.push_back(character);
    }
    result.append(slashes * 2, L'\\');
    result.push_back(L'\"');
    return result;
}

bool ResolvePaths() {
    std::vector<wchar_t> modulePath(32768);
    DWORD length = GetModuleFileNameW(nullptr, modulePath.data(), static_cast<DWORD>(modulePath.size()));
    if (length == 0 || length >= modulePath.size()) return false;
    std::wstring directory(modulePath.data(), length);
    const size_t separator = directory.find_last_of(L"\\/");
    if (separator == std::wstring::npos) return false;
    browserPath = directory.substr(0, separator) + L"\\runtime\\chrome.exe";
    wchar_t localAppData[MAX_PATH] = {};
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, localAppData))) return false;
    profilePath = std::wstring(localAppData) + L"\\Bulka\\Staff\\Profile";
    return true;
}

bool StartBrowser() {
    DWORD attributes = GetFileAttributesW(browserPath.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
        ShowError(L"Не найден компонент приложения runtime\\chrome.exe. Повторно установите Bulka — кассир из полного установщика.");
        return false;
    }
    const int directoryResult = SHCreateDirectoryExW(nullptr, profilePath.c_str(), nullptr);
    if (directoryResult != ERROR_SUCCESS && directoryResult != ERROR_ALREADY_EXISTS && directoryResult != ERROR_FILE_EXISTS) {
        ShowError(L"Не удалось открыть локальный профиль Bulka. Проверьте доступ к папке пользователя и свободное место на диске.");
        return false;
    }
    if (browserProcess) { CloseHandle(browserProcess); browserProcess = nullptr; }
    const std::wstring command = QuoteArgument(browserPath)
        + L" " + QuoteArgument(std::wstring(L"--app=") + kUrl)
        + L" " + QuoteArgument(L"--user-data-dir=" + profilePath)
        + L" --start-maximized --no-first-run --no-default-browser-check";
    std::vector<wchar_t> mutableCommand(command.begin(), command.end());
    mutableCommand.push_back(L'\0');
    STARTUPINFOW startup = {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process = {};
    const std::wstring directory = browserPath.substr(0, browserPath.find_last_of(L"\\/"));
    if (!CreateProcessW(browserPath.c_str(), mutableCommand.data(), nullptr, nullptr, FALSE,
        CREATE_UNICODE_ENVIRONMENT, nullptr, directory.c_str(), &startup, &process)) {
        ShowError(L"Не удалось запустить Bulka — кассир. Повторно установите приложение. Если проблема сохраняется, проверьте, что разрядность Windows соответствует установленному компоненту.");
        return false;
    }
    CloseHandle(process.hThread);
    browserProcess = process.hProcess;
    browserPid = process.dwProcessId;
    startedAt = GetTickCount64();
    lastWindowAt = startedAt;
    sawBrowserWindow = false;
    return true;
}

struct WindowSearch { HWND exact; HWND sameRuntime; LONGLONG exactArea; LONGLONG runtimeArea; };

BOOL CALLBACK FindBrowserWindow(HWND window, LPARAM parameter) {
    if (!IsWindowVisible(window) || GetWindow(window, GW_OWNER)) return TRUE;
    wchar_t className[128] = {};
    if (!GetClassNameW(window, className, 128) || wcsncmp(className, L"Chrome_WidgetWin_", 17) != 0) return TRUE;
    DWORD processId = 0;
    GetWindowThreadProcessId(window, &processId);
    WindowSearch* search = reinterpret_cast<WindowSearch*>(parameter);
    RECT rectangle = {};
    if (!GetWindowRect(window, &rectangle)) return TRUE;
    const LONGLONG area = static_cast<LONGLONG>(rectangle.right - rectangle.left) * (rectangle.bottom - rectangle.top);
    if (processId == browserPid) {
        if (area > search->exactArea) { search->exact = window; search->exactArea = area; }
        return TRUE;
    }
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
    if (!process) return TRUE;
    wchar_t path[32768] = {};
    DWORD pathLength = 32768;
    if (QueryFullProcessImageNameW(process, 0, path, &pathLength) && _wcsicmp(path, browserPath.c_str()) == 0
        && area > search->runtimeArea) {
        search->sameRuntime = window;
        search->runtimeArea = area;
    }
    CloseHandle(process);
    return TRUE;
}

HWND CurrentBrowserWindow() {
    WindowSearch search = {};
    EnumWindows(FindBrowserWindow, reinterpret_cast<LPARAM>(&search));
    return search.exact ? search.exact : search.sameRuntime;
}

void ActivateBrowser(HWND window, bool reconnect) {
    if (IsIconic(window)) ShowWindow(window, SW_RESTORE);
    SetForegroundWindow(window);
    if (reconnect && GetForegroundWindow() == window) {
        INPUT keys[2] = {};
        keys[0].type = INPUT_KEYBOARD;
        keys[0].ki.wVk = VK_F5;
        keys[1] = keys[0];
        keys[1].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(2, keys, sizeof(INPUT));
    }
}

LRESULT CALLBACK LauncherWindowProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == kActivateMessage) {
        pendingReconnect = wParam != 0;
        HWND browserWindow = CurrentBrowserWindow();
        if (browserWindow) {
            ActivateBrowser(browserWindow, pendingReconnect);
            pendingReconnect = false;
        } else if (browserProcess && WaitForSingleObject(browserProcess, 0) == WAIT_OBJECT_0 && !StartBrowser()) {
            DestroyWindow(window);
        }
        return 0;
    }
    if (message == WM_TIMER) {
        HWND browserWindow = CurrentBrowserWindow();
        const ULONGLONG now = GetTickCount64();
        if (browserWindow) {
            sawBrowserWindow = true;
            lastWindowAt = now;
            if (pendingReconnect) { ActivateBrowser(browserWindow, true); pendingReconnect = false; }
        } else if (sawBrowserWindow && now - lastWindowAt >= 5000) {
            DestroyWindow(window);
        } else if (!sawBrowserWindow && now - startedAt >= 60000) {
            ShowError(L"Окно Bulka не открылось. Закройте приложение и запустите его снова. Если проблема повторяется, переустановите Bulka — кассир.");
            DestroyWindow(window);
        } else if (!sawBrowserWindow && now - startedAt >= 5000 && browserProcess
            && WaitForSingleObject(browserProcess, 0) == WAIT_OBJECT_0) {
            ShowError(L"Компонент Bulka завершился до открытия окна. Повторно установите приложение и проверьте совместимость компьютера.");
            DestroyWindow(window);
        }
        return 0;
    }
    if (message == WM_CLOSE) { DestroyWindow(window); return 0; }
    if (message == WM_DESTROY) { KillTimer(window, 1); PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, wParam, lParam);
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    int argumentCount = 0;
    wchar_t** arguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
    bool reconnect = false;
    bool validArguments = arguments != nullptr && argumentCount <= 2;
    if (validArguments && argumentCount == 2) {
        reconnect = _wcsicmp(arguments[1], L"--reconnect") == 0;
        validArguments = reconnect;
    }
    if (arguments) LocalFree(arguments);
    if (!validArguments) { ShowError(L"Используйте обычный ярлык Bulka или ярлык «Восстановить соединение»."); return 2; }
    HANDLE mutex = CreateMutexW(nullptr, TRUE, kMutexName);
    if (!mutex) { ShowError(L"Не удалось запустить приложение в сеансе Windows. Попробуйте ещё раз."); return 3; }
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existingWindow = nullptr;
        for (int attempt = 0; attempt < 50 && !existingWindow; ++attempt) {
            existingWindow = FindWindowW(kWindowClass, nullptr);
            if (!existingWindow) Sleep(100);
        }
        if (existingWindow) {
            AllowSetForegroundWindow(ASFW_ANY);
            DWORD_PTR result = 0;
            SendMessageTimeoutW(existingWindow, kActivateMessage, reconnect ? 1 : 0, 0,
                SMTO_ABORTIFHUNG, 3000, &result);
        } else ShowError(L"Bulka уже запускается. Подождите несколько секунд и откройте ярлык снова.");
        CloseHandle(mutex);
        return existingWindow ? 0 : 4;
    }
    if (!ResolvePaths()) {
        ShowError(L"Не удалось определить папку приложения или локальный профиль пользователя Windows.");
        ReleaseMutex(mutex); CloseHandle(mutex); return 5;
    }
    WNDCLASSW windowClass = {};
    windowClass.lpfnWndProc = LauncherWindowProcedure;
    windowClass.hInstance = instance;
    windowClass.lpszClassName = kWindowClass;
    HWND window = nullptr;
    if (RegisterClassW(&windowClass)) window = CreateWindowExW(0, kWindowClass, kAppName,
        WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, instance, nullptr);
    if (!window || !StartBrowser()) {
        if (!window) ShowError(L"Не удалось создать окно запуска Bulka.");
        if (window) DestroyWindow(window);
        ReleaseMutex(mutex); CloseHandle(mutex); return 6;
    }
    pendingReconnect = reconnect;
    SetTimer(window, 1, 1000, nullptr);
    MSG message = {};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    if (browserProcess) CloseHandle(browserProcess);
    ReleaseMutex(mutex);
    CloseHandle(mutex);
    return 0;
}
