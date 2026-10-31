[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class DesktopTracker {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    private static extern int DwmGetWindowAttributeInt(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    private const int DWMWA_CLOAKED = 14;

    private static string GetTitle(IntPtr hWnd) {
        var sb = new StringBuilder(256);
        GetWindowText(hWnd, sb, 256);
        return sb.ToString().Trim();
    }

    private static string GetClass(IntPtr hWnd) {
        var sb = new StringBuilder(128);
        GetClassName(hWnd, sb, 128);
        return sb.ToString().Trim();
    }

    private static Dictionary<uint, string> procCache = new Dictionary<uint, string>();
    private static string GetProcName(IntPtr hWnd) {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid > 0) {
            string name;
            if (procCache.TryGetValue(pid, out name)) return name;
            try {
                name = Process.GetProcessById((int)pid).ProcessName;
                if (procCache.Count > 120) procCache.Clear();
                procCache[pid] = name;
                return name;
            } catch {}
        }
        return "";
    }

    private static RECT GetBounds(IntPtr hWnd) {
        RECT r;
        if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) == 0) {
            return r;
        }
        GetWindowRect(hWnd, out r);
        return r;
    }

    private static bool IsCloaked(IntPtr hWnd) {
        int cloaked = 0;
        int hr = DwmGetWindowAttributeInt(hWnd, DWMWA_CLOAKED, out cloaked, sizeof(int));
        return hr == 0 && cloaked != 0;
    }

    public static object Snapshot() {
        IntPtr fg = GetForegroundWindow();
        string activeTitle = "";
        string activeApp = "";

        if (fg != IntPtr.Zero) {
            activeTitle = GetTitle(fg);
            activeApp = GetProcName(fg);
        }

        var openWindows = new List<string>();
        var windows = new List<Dictionary<string, object>>();
        var ledges = new List<Dictionary<string, object>>();

        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd) || IsIconic(hWnd) || IsCloaked(hWnd)) return true;
            int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
            if ((exStyle & WS_EX_TOOLWINDOW) != 0) return true;

            string cls = GetClass(hWnd);
            if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "SecondaryTrayWnd" || cls == "Windows.UI.Core.CoreWindow") return true;

            string title = GetTitle(hWnd);
            if (string.IsNullOrWhiteSpace(title) || title == "Stack-chan Pet" || title == "Program Manager" || title == "Configurações") return true;

            RECT r = GetBounds(hWnd);
            int w = r.Right - r.Left;
            int h = r.Bottom - r.Top;
            if (w < 160 || h < 90 || r.Left < -16000 || r.Top < -16000) return true;

            string procName = GetProcName(hWnd);
            bool zoomed = IsZoomed(hWnd);

            if (openWindows.Count < 10) {
                openWindows.Add(title);
            }

            if (windows.Count < 12) {
                var wd = new Dictionary<string, object>();
                wd["hwnd"] = hWnd.ToInt64();
                wd["title"] = title.Length > 70 ? title.Substring(0, 70) : title;
                wd["app"] = procName;
                wd["x"] = r.Left;
                wd["y"] = r.Top;
                wd["w"] = w;
                wd["h"] = h;
                wd["zoomed"] = zoomed;
                windows.Add(wd);
            }

            if (!zoomed && ledges.Count < 8) {
                if (w >= 200 && h >= 110 && r.Top >= -1200 && r.Top <= 2200) {
                    var ld = new Dictionary<string, object>();
                    ld["hwnd"] = hWnd.ToInt64();
                    ld["title"] = title.Length > 50 ? title.Substring(0, 50) : title;
                    ld["app"] = procName;
                    ld["x"] = r.Left;
                    ld["y"] = r.Top;
                    ld["w"] = w;
                    ledges.Add(ld);
                }
            }
            return true;
        }, IntPtr.Zero);

        return new Dictionary<string, object> {
            { "activeTitle", activeTitle },
            { "activeApp", activeApp },
            { "openWindows", openWindows },
            { "windows", windows },
            { "ledges", ledges }
        };
    }
}
"@

while ($true) {
    try {
        $snap = [DesktopTracker]::Snapshot() | ConvertTo-Json -Compress -Depth 4
        [Console]::WriteLine($snap)
    } catch {}
    Start-Sleep -Milliseconds 1100
}
