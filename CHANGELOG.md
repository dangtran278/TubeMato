# Changelog

## [1.2.0] - 2026-09-28

### Added

- Closing the window asks whether to keep running in the tray or quit. Set in Settings › System, replacing "Quit on close".
- Overdue notification has a Start button.
- Compact widget size (timer and play only). Toggle in Settings › Widget.

### Changed

- Overdue notification stays until overdue ends, instead of timing out.
- Overdue notification plays a three-burst alarm in passive-aggressive mode.
- Floating widget is shorter.
- Clicking anywhere on the widget outside its buttons opens the main window, not just the timer.
- Procrastination nudge can't be set shorter than the grace period.

### Fixed

- Dragging the widget grew its window, leaving an invisible area that swallowed clicks.
- Overdue mascot window stayed full size after settling, swallowing clicks around it.
- Widget right-click menu left no active window, so keystrokes went nowhere.
- Checking in an owed objective could reorder rows mid-click.
- Extended work sessions counted as a single pomodoro.
- Clicked buttons kept focus, so Enter or Space pressed them again.
- Esc in a form's dropdown also closed the form.
- Switching objectives mid-session kept the old objective's music setting.
- Default browser shortcuts (zoom, DevTools, Tab through buttons) still worked.
- Tray and widget objective switcher ignored debt when sorting.
- Overdue mascot could be dragged off and saved as an image.

## [1.1.0] - 2026-08-19

### Added

- Main window reopens maximized if it was maximized when last closed.
- Hovering an objective's "owed" or "past due date" badge now adds a passive-aggressive aside.

### Changed

- A rested weekend no longer breaks your streak. Toggle in Settings › Streaks.
- Titlebar close button now reaches the window's top-right corner, the easiest target to hit when maximized.
- Animations now respect the OS "reduce motion" setting.
- Widget overdue flash, YouTube bridge dot, and overdue objective glow now settle after a few cycles instead of animating indefinitely.
- Objective reminders no longer repeat the carried-over check-in count. The owed badge already shows it.

### Fixed

- Overdue and grace-period totals didn't account for time spent asleep, causing them to disagree with logged history.
- Repeating objectives kept showing an "owed" badge after the owed check-ins were already done.
- Spread reminders stopped firing once the target exceeded the period's day count.
- Settings saved by an older app version could permanently miss keys added since.
- Titlebar buttons only responded inside their circular icon, missing the space around and between them.
- Audio engine stayed active indefinitely after any sound played, holding the audio device open in the background.
- Browser extension held a connection open on YouTube pages it cannot control (home, search, Shorts), needlessly keeping its background worker alive.
- Several UI animations kept re-rendering even when hidden or with the window in the background.
- Installer included several megabytes of leftover files from previous builds.

## [1.0.1] - 2026-08-09

### Fixed

- Analytics: "% of objectives reached" could read misleadingly high.
- Reminders and daily summaries could occasionally double-fire or fire on stale data.
- Repeating objectives that were already met still offered their period pickers.
- Calendar events inherited an objective's End date incorrectly when "Repeats" was toggled.
- Keyboard focus rings and the procrastination timer glow were visually broken in some cases.

## [1.0.0] - 2026-07-31

Initial release.

[1.2.0]: https://github.com/dangtran278/TubeMato/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dangtran278/TubeMato/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/dangtran278/TubeMato/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/dangtran278/TubeMato/releases/tag/v1.0.0
