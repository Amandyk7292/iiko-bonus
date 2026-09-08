# iPhone performance check — 8 September 2026

App: com.bulka.bonus, build 4, profile mode, commit 94981a749c73. Installation succeeded at 14:21. The VM root library was checked before subscribing to Flutter.Frame events.

Capture: 14:27:02–14:28:02, Asia/Oral. The user reports opening all requested screens (catalog, product, cart, locations, admin). Screen transitions were not separately timestamped. Permissions and catalog were also observed in device screenshots.

| Metric | Result |
| --- | --- |
| Flutter frames | 3,007 |
| Build median / p95 / maximum | 0.477 / 1.705 / 27.681 ms |
| Raster median / p95 / maximum | 0.887 / 2.380 / 12.891 ms |
| Build or raster above 16.67 ms | 3 (0.10%) |
| Build or raster above 8.33 ms | 15 (0.50%) |
| Total span p95 / maximum | 4.785 / 105.553 ms |

Most captured Flutter frames fit both comparison budgets. Occasional slow frames remain. These are work-duration budgets, not measured FPS: the display refresh rate and presented-frame count were not recorded. Total span includes pipeline latency and is not interchangeable with build or raster duration.

This single profile-mode run does not prove every screen is bug-free. WebView content rendering is outside these Flutter timings; native staff migration remains unfinished. Android hardware was unavailable. No payment, refund or courier dispatch was executed by the diagnostics.

Raw local evidence: scratch/iphone-flutter-frame-timings.json. The report contains no VM authentication URL.
