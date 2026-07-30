import path from 'path'

/** Shared @electron/* alias map used by both vite.config.ts and vitest.config.ts. */
export function electronAliases(root: string): Record<string, string> {
  const e = (name: string) => path.resolve(root, `electron/${name}.ts`)
  return {
    '@': path.resolve(root, './src'),
    '@electron/types': e('types'),
    '@electron/calendarDate': e('calendarDate'),
    '@electron/objectiveDebt': e('objectiveDebt'),
    '@electron/dateMath': e('dateMath'),
    '@electron/recurrence': e('recurrence'),
    '@electron/objectiveSummary': e('objectiveSummary'),
    '@electron/daySummary': e('daySummary'),
    '@electron/objectiveReminder': e('objectiveReminder'),
    '@electron/objectiveLogPrune': e('objectiveLogPrune'),
    '@electron/logRetention': e('logRetention'),
    '@electron/reminderDispatch': e('reminderDispatch'),
    '@electron/scheduleFire': e('scheduleFire'),
    '@electron/fiveYearPlan': e('fiveYearPlan'),
    '@electron/scheduledBlockAction': e('scheduledBlockAction'),
    '@electron/personalityCopy': e('personalityCopy'),
    '@electron/roastBag': e('roastBag'),
    '@electron/objectiveRevision': e('objectiveRevision'),
    '@electron/objectiveSync': e('objectiveSync'),
    '@electron/minutesDisplay': e('minutesDisplay'),
    '@electron/logNormalize': e('logNormalize'),
    '@electron/sessionFilters': e('sessionFilters'),
    '@electron/spreadReminder': e('spreadReminder'),
    '@electron/streakCalc': e('streakCalc'),
    '@electron/store': e('store'),
    '@electron/timer': e('timer'),
    '@electron/notificationIcon': e('notificationIcon'),
    '@electron/scheduler': e('scheduler'),
    '@electron/commandServer': e('commandServer'),
    '@electron/musicController': e('musicController'),
    '@electron/musicPolicy': e('musicPolicy'),
    '@electron/widgetTopmost': e('widgetTopmost'),
    '@electron/targetHandoff': e('targetHandoff'),
    '@electron/bellRouter': e('bellRouter'),
  }
}
