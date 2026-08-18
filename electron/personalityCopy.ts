/** App copy for notifications and UI. Each fn takes a `personality`: 'passive-aggressive' (default,
 *  the snark) or 'calm' (one plain, factual line). */
import type { SummaryVerdict, Personality } from './types'
import { formatMinutesHm, formatMinutesProse } from './minutesDisplay'
import { alertLeadLabel } from './scheduleFire'

/** Below this many minutes of focus, a day counts as "did basically nothing" (daily summary). */
export const LAZY_FOCUS_MIN = 30

/** Below this threshold, congratulatory verdict messages are withheld even if objectives were met. */
export const DECENT_FOCUS_MIN = 60

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** Picks one line from a labeled pool. The label lets a stateful picker (see roastBag.ts) keep a
 *  separate shuffle bag per pool; the default below ignores it and picks at random. */
export type PoolChooser = <T>(poolId: string, items: T[]) => T

const randomChooser: PoolChooser = (_poolId, items) => pick(items)

function stableIndex(length: number, seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % length
}

function stablePick<T>(items: T[], seed: string): T {
  return items[stableIndex(items.length, seed)]
}

function pct(completed: number, target: number): number {
  if (target <= 0) return 100
  return Math.round((completed / target) * 100)
}

function remainingLabel(n: number): string {
  return n === 1 ? '1 check-in left' : `${n} check-ins left`
}

/** PA's non-debt pools never mention debt themselves; append it so it isn't silently dropped. */
function withDebtNote(line: string, debt: number): string {
  if (debt <= 0) return line
  return `${line} Also: ${debt} check-in${debt === 1 ? '' : 's'} carried over from last time.`
}

export function objectiveReminderBody(
  completed: number,
  target: number,
  debt = 0,
  choose: PoolChooser = randomChooser,
  personality: Personality = 'passive-aggressive',
): string {
  const score = `${completed}/${target}`
  const remaining = Math.max(0, target - completed)
  const left = remainingLabel(remaining)

  if (personality === 'calm') {
    const status = remaining === 0 ? 'Complete.' : `${left}.`
    return debt > 0
      ? `${score}. ${status} ${debt} carried over from a previous deadline.`
      : `${score}. ${status}`
  }

  if (completed === 0) {
    return withDebtNote(choose('rem-zero', [
      `${score}. Zero check-ins so far. Bold strategy: ignore it completely.`,
      `${score}. You haven't checked in once. The objective asked if it did something wrong.`,
      `${score}. A beautifully preserved objective. Museum-quality avoidance.`,
      `${score}. Zero progress. Impressive commitment to avoidance.`,
      `${score}. Pristine. Untouched. Unblemished by any hint of effort.`,
      `${score}. The task is still there. Unlike your check-ins.`,
      `${score}. ${target} check-in${target === 1 ? '' : 's'} due. You've done none. We see you.`,
      `${score}. Your objective is starting to think you're ghosting it.`,
      `${score}. You've successfully avoided this the whole time. Impressive, honestly.`,
      `${score}. If task avoidance were an Olympic sport, this sequence would win gold.`,
      `${score}. You've kept the objective waiting. Who's next? Your boss? Your best friend? Your future self?`,
      `${score}. Dear diary, my darling is ignoring me. AGAIN.`,
      `${score}. My disappointment is immeasurable and my day is ruined.`,
    ]), debt)
  }

  if (remaining <= 2) {
    return withDebtNote(choose('rem-deadline', [
      `${score}. ${left}. So close. Almost like you planned to stop here.`,
      `${score}. ${left}. This is not the time to develop an exit strategy.`,
      `${score}. ${left}. So close you can taste the dopamine. Finish it.`,
      `${score}. Only ${remaining} more to finish this deadline. Unless stopping early was the plan.`,
      `${score}. ${left}. Finish it. We believe in you. Reluctantly.`,
      `${score}. ${left}. You've come too far to let this become a thing you almost did.`,
      `${score}. ${left}. It would be a shame to stall here. Just saying.`,
    ]), debt)
  }

  if (pct(completed, target) < 35) {
    return withDebtNote(choose('rem-lowpct', [
      `${score}. A start! A tiny, tiny start. ${left}.`,
      `${score}. You checked in once (or twice). Technically counts. ${left}.`,
      `${score}. ${pct(completed, target)}% done. ${left}. We've seen worse. Barely.`,
      `${score}. ${left}. Take your time. (Please don't.)`,
      `${score}. ${left}. We'd say no pressure but that would be a lie.`,
      `${score}. ${left}. Whenever you're ready. (Now would be ideal.)`,
      `${score}. A noble attempt at starting... today. ${left}.`,
      `${score}. The bar was on the floor and you still limbo'd under it. Respect. ${left}.`,
      `${score}. ${pct(completed, target)}% done. At this speed, your grandchildren will finish this objective for you. ${left}.`,
    ]), debt)
  }

  if (debt > 0) {
    return choose('rem-debt', [
      `${score}. Also, ${debt} from last deadline followed you here. Hi.`,
      `${score}. ${left} here, plus ${debt} carried over. The math is not in your favor.`,
      `${score}. You thought the old deadline wiped the slate clean? Adorable. Add +${debt} to your tab.`,
      `${score}. Your past failures have mutated. You now owe an extra ${debt} check-in unit${debt === 1 ? '' : 's'}.`,
      `${score}. Interest-free, but not shame-free: ${debt} check-in${debt === 1 ? '' : 's'} rolled over from last time.`,
      `${score}. The ghost of deadlines past has a face, and it looks like ${debt} extra check-ins.`,
      `${score}. Your past failures have achieved sentience. They brought ${debt} friend${debt === 1 ? '' : 's'} with them.`,
      `${score}. Past you missed a deadline. Present you owes ${debt} more check-in${debt === 1 ? '' : 's'}.`,
      `${score}. Your past deadlines have hired a collections agency. They want ${debt} check-in${debt === 1 ? '' : 's'} immediately.`,
`${score}. Time heals all wounds, but it compounds your interest. Add +${debt} to your tab.`,
`${score}. The bills are due. Your past laziness has leaked into your present, adding +${debt} check-in${debt === 1 ? '' : 's'}.`,
    ])
  }

  return choose('rem-mid', [
    `${score}. ${left}. Keep going; we'll pretend we never doubted you.`,
    `${score}. Halfway-ish. Don't ghost us now. ${left}.`,
    `${score}. ${left}. The objective is waiting. Patiently. Judgmentally.`,
    `${score}. ${left} remaining. Progress: acknowledged. Completion: pending.`,
    `${score}. ${left}. Still going. We're rooting for you in a worried way.`,
    `${score}. ${left}. You've got this. Probably.`,
    `${score}. ${left}. Future you is already preparing an excuse. Prove them wrong.`,
    `${score}. ${left}. Yours truly is watching. Impatiently.`,
  ])
}

/**
 * Gentle periodic "rhythm" nudge for a spread objective that is ON PACE at a checkpoint.
 * Distinct (softer) from objectiveReminderBody, which is for behind/deadline pressure.
 * NOTE: placeholder tone; safe to rewrite these lines as needed.
 */
export function objectiveCadenceNudge(
  completed: number,
  target: number,
  choose: PoolChooser = randomChooser,
  personality: Personality = 'passive-aggressive',
): string {
  const score = `${completed}/${target}`
  const remaining = Math.max(0, target - completed)
  const left = remainingLabel(remaining)
  if (personality === 'calm') return `${score}. On pace. ${left}.`
  return choose('nudge', [
    `${score}. On pace. Suspicious. ${left}.`,
    `${score}. The tomato did not have this in the script. Keep going. ${left}.`,
    `${score}. On pace. The tomato has put its notes away. For now. ${left}.`,
    `${score}. On pace. The tomato has updated its risk assessment. ${left}.`,
    `${score}. On pace. Who are you? What have you done with my darling? ${left}.`,
    `${score}. On pace. The tracking engine is waiting for the inevitable moment your willpower breaks. ${left}.`,
    `${score}. On track. The universe is currently experiencing a profound structural error where your actions actually match your words. ${left}.`,
  ])
}

export function objectiveReminderBatchTitle(
  count: number,
  choose: PoolChooser = randomChooser,
  personality: Personality = 'passive-aggressive',
): string {
  if (personality === 'calm') {
    return count === 1 ? `1 objective needs a check-in.` : `${count} objectives need a check-in.`
  }
  if (count === 1) {
    return choose('batch-one', [
      `Your objective hasn't given up on you. Yet.`,
      `Just checking in (judgmentally).`,
      `One objective. It's been very patient.`,
      `TubeMato is calculating the cost of your operational drift.`,
      `We need to talk about your progress.`,
      `These notifications don't seem to be working. We'll keep sending them.`,
      `A lonely little target is waiting for you to finish your side quests.`,
    ])
  }
  return choose('batch-many', [
    `${count} objectives. Zero excuses left.`,
    `${count} objectives set. ${count} still open. Pattern forming.`,
    `${count} reminders. One disappointed app.`,
    `${count} objectives pending. They're not going anywhere.`,
    `Still ${count} short. Classic.`,
    `Notification ignored. Sending another. You're welcome.`,
    `${count} objectives still live. The tomato is taking bets on which one you drop first.`,
    `${count} open items. A beautiful collection of things you'll definitely do 'later.'`,
  ])
}

export function dailySummaryNotificationTitle(personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `🍅 Daily summary ready`
  return pick([
    `Today's report card`,
    `Daily summary: open for the roast`,
    `Today is on the record. Open up.`,
    `The numbers are in. Brace yourself.`,
    `We tracked everything. You might prefer we hadn't.`,
    `The ledger demands your attention.`,
    `I've been watching you all day.`,
    `A record of your choices. Open for the breakdown.`,
    `Time's up. Let's see what you actually salvaged today.`,
  ])
}

// Summary-body pools, exported as ctx-template fns so tests assert pool MEMBERSHIP per
// tier+verdict instead of hardcoding phrases.
type SummaryBodyLine = (ctx: { pomodoros: number; focusMinutes: number }) => string

// focus < LAZY_FOCUS_MIN: "basically nothing", never praised regardless of verdict.
export const SUMMARY_BODY_LAZY: SummaryBodyLine[] = [
  ({ focusMinutes }) => `Today: ${formatMinutesHm(focusMinutes)} of focus. We're generously rounding that to nothing.`,
  () => `Barely any focus logged today. The timer waited all day.`,
  ({ focusMinutes }) => `${formatMinutesProse(focusMinutes)} of work. The app stared at the ceiling with you.`,
  () => `A few scattered minutes. Bold of you to call that a day.`,
  () => `Almost nothing today. Iconic avoidance.`,
  ({ focusMinutes }) => `Today: ${formatMinutesHm(focusMinutes)} of focus. Waste of electricity. Your computer is warmer than your ambition.`,
  ({ focusMinutes }) => `A grand total of ${formatMinutesHm(focusMinutes)}. You essentially treated the workstation as a luxury resting spot today.`,
]

// Intermediate tier (LAZY ≤ focus < DECENT), behind on an objective.
export const SUMMARY_BODY_INTERMEDIATE_BEHIND: SummaryBodyLine[] = [
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus. Still behind on an objective. The tomato has seen this movie before.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. The effort happened. The objective did not notice.`,
  ({ focusMinutes }) => `You spent ${formatMinutesHm(focusMinutes)} arranging deck chairs on a sinking ship. The objectives are officially underwater.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus, and still behind. The tomato bet on you. Regrettably, it may have to pay up.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} on the clock, yet you managed to slide behind on your objectives. Artful dodging.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus. You successfully kept the seat warm, but the objective remains unbothered.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} on the clock. A beautiful smoke screen that failed to hide the fact that you are still behind.`,
]

// Intermediate tier, not behind: meh, never congratulatory.
export const SUMMARY_BODY_INTERMEDIATE_MEH: SummaryBodyLine[] = [
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus. You were here. Debatably.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. A masterpiece of pure mediocrity.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. A profoundly forgettable performance.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} today. A day occurred. It was not transcendent.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. Attendance: confirmed. Enthusiasm: unverified.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. Go on. Tell people you had a productive day.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. The tomato asked if there was more. There was not.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. The tomato waited for the sequel. It did not arrive.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. The tomato clocked out too. Just later.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. Are we doing this again tomorrow? A genuine question.`,
  // ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus. The tomato observed. It has complicated feelings.`,
  // ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)}. The tomato is withholding its verdict. For now.`,
]

// Decent tier (focus ≥ DECENT), behind on an objective.
export const SUMMARY_BODY_DECENT_BEHIND: SummaryBodyLine[] = [
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus, but you've fallen behind on your objectives. The deadline noticed.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus logged. An objective is slipping behind pace. Catch up.`,
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'}, yet an objective is behind schedule. Selective effort.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus, objectives drifting. Classic.`,
  () => `Focus: fine. Objectives: behind. The math is catching up with you.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of flawless execution on a completely irrelevant side quest. The main storyline is currently dying.`,
  ({ focusMinutes }) => `You gave ${formatMinutesHm(focusMinutes)} of undivided attention to the scenery while your primary obligation quietly rolled off a cliff.`,
]

// Decent tier, every due objective met: the one place completion is celebrated.
export const SUMMARY_BODY_DECENT_ALL_DONE: SummaryBodyLine[] = [
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'} and every objective done. Fine. You actually showed up.`,
  ({ focusMinutes }) => `All objectives complete + ${formatMinutesHm(focusMinutes)} focus. We're mildly impressed.`,
  ({ pomodoros }) => `Objectives cleared, ${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'}. Acceptable human behavior.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus and everything done. Don't get used to praise.`,
  ({ focusMinutes }) => `All targets crushed and ${formatMinutesHm(focusMinutes)} logged. The tomato is experiencing an unfamiliar sensation. Is this... respect? Disgusting.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus and a completely empty task list. Enjoy the brief, terrifying absence of crushing guilt.`,
  ({ pomodoros }) => `${pomodoros} session${pomodoros === 1 ? '' : 's'} done, goals completed. You successfully played the role of a productive human today. End scene.`,
]

// Decent tier, on pace: keeping up, but must NEVER claim completion.
export const SUMMARY_BODY_DECENT_ON_PACE: SummaryBodyLine[] = [
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus, on pace. The tomato has been here before. It knows how this usually ends.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus, on pace. The tomato has quietly put away its contingency plan.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} logged. You're on pace. The tomato is holding its breath to see how long this lasts.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus, on pace. We are currently checking our database for calculation errors.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus. You are actively defying your own historical trendlines.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus. You are currently maintaining the terrifying illusion of a functional adult.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus, on pace. The tomato is squinting at the screen, looking for the catch.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus, on pace. The tomato is withholding its sighs for tomorrow.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus. You haven't fallen behind yet. The tracking engine is growing suspicious.`,
  // ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} focus, on pace. The tomato's contingency plan remains unused.`,
]

// Decent tier, no objectives set at all (verdict 'none').
export const SUMMARY_BODY_NO_OBJECTIVES: SummaryBodyLine[] = [
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'} and no objectives set. Living dangerously.`,
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'} and no destination. The tomato respects the commitment to nothing.`,
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'} into the void. The tomato respects the commitment.`,
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'} logged with zero destination. Pure, unadulterated directionless energy.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of focus sessions, but no actual goals declared. A beautiful monument to nothing.`,
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'} done. You are sprinting beautifully on a track that doesn't exist.`,
  ({ pomodoros }) => `${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'} of pristine, directionless busywork. Fascinating choice.`,
  ({ focusMinutes }) => `${formatMinutesProse(focusMinutes)} of focus, destination unknown. The tomato is concerned.`,
  ({ focusMinutes }) => `${formatMinutesHm(focusMinutes)} of raw processing power expended entirely on unlisted, unverified busywork.`,
]

export function dailySummaryNotificationBody(
  pomodoros: number,
  focusMinutes: number,
  verdict: SummaryVerdict,
  checkinsToday: number,
  personality: Personality = 'passive-aggressive',
): string {
  const ctx = { pomodoros, focusMinutes }
  // Cleared everything today, whether verdict says so directly (all-done) or every objective was
  // checked in and archived before the summary ran (verdict reads 'none' but the day wasn't empty).
  // This always reads as a win, regardless of how little focus time it took, in EITHER personality.
  const clearedEverything = verdict === 'all-done' || (verdict === 'none' && checkinsToday > 0)
  if (personality === 'calm') {
    const base = `${formatMinutesHm(focusMinutes)} focused, ${pomodoros} pomodoro${pomodoros === 1 ? '' : 's'}.`
    const tail = verdict === 'behind' ? ' Some objectives are behind.'
      : clearedEverything ? ' All objectives complete.'
        : verdict === 'on-pace' ? ' On pace.'
          : ''
    return base + tail
  }
  if (clearedEverything) {
    return pick(SUMMARY_BODY_DECENT_ALL_DONE)(ctx)
  }
  if (focusMinutes < LAZY_FOCUS_MIN) return pick(SUMMARY_BODY_LAZY)(ctx)
  if (focusMinutes < DECENT_FOCUS_MIN) {
    return verdict === 'behind'
      ? pick(SUMMARY_BODY_INTERMEDIATE_BEHIND)(ctx)
      : pick(SUMMARY_BODY_INTERMEDIATE_MEH)(ctx)
  }
  if (verdict === 'behind') return pick(SUMMARY_BODY_DECENT_BEHIND)(ctx)
  if (verdict === 'on-pace') return pick(SUMMARY_BODY_DECENT_ON_PACE)(ctx)
  return pick(SUMMARY_BODY_NO_OBJECTIVES)(ctx)
}

export function procrastinationNudgeTitle(personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Break over`
  return pick([
    `The break ended. You did not.`,
    `Break's over 👀`,
    `Still "on break"?`,
    `We see you. Start the timer.`,
    `Your future is rotting.`,
    `Death by a thousand excuses.`,
    `Comfortable?`,
    `Still negotiating?`,
    `The break timer left without you.`,
    `A quiet moment of zero output.`,
    `Don't make me come over there.`,
  ])
}

export function procrastinationNudgeBody(personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Your break has ended. Start your next focus block when you're ready.`
  return pick([
    `Your break ended. The next pomodoro has been waiting awkwardly.`,
    `We're not saying start work. We're strongly implying it.`,
    `Grace period over. This is officially procrastination now.`,
    `The break timer finished. Sitting idle doesn't count as an objective.`,
    `Hello? Hit start on your next focus block. Just saying.`,
    `Grace period done. We've started the shame counter.`,
    `Your break ended. The timer is patient. We are less so.`,
    `Your break has expired. Your accountability partner is losing patience.`,
    `Your timeline is imaginary. Your delays are not. Move.`,
    `Sitting here staring at a static tomato doesn't advance your career. Hit start.`,
    `The break timer is a distant memory. The actual work timer remains untouched. Press start.`,
  ])
}

// ─── In-app summary modal ─────────────────────────────────────────────────────

export function summaryModalTitle(dateLabel: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `📊 Daily summary (${dateLabel})`
  const items = [
    `📊 Daily summary (${dateLabel})`,
    `📊 Today (${dateLabel}): judgment day`,
    `📊 ${dateLabel}: a record of your choices`,
    `📊 ${dateLabel}: the full breakdown`,
    `📊 ${dateLabel} stats (no hiding)`,
    `📊 ${dateLabel} reality check`,
    `📊 ${dateLabel}: the receipt`,
    `📊 ${dateLabel} truth bomb`,
    `📊 ${dateLabel}: Are you proud of this?`,
  ]
  return stablePick(items, `summary-title-${dateLabel}`)
}

export function summaryIncompleteSectionTitle(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Unfinished`
  const items = [
    `The ones you bailed on`,
    `Left unfinished (again)`,
    `Outstanding failures`,
    `Objectives that waited for you`,
    `The wreckage of today's promises`,
    `The tasks you quietly left behind`,
    `The broken contracts`,
    `Where your focus chose to compromise`,
    `The unfinished ledger`,
  ]
  return stablePick(items, `summary-incomplete-${seed}`)
}

export function summaryInProgressSectionTitle(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `In progress`
  const items = [
    `In flight. Don't look down.`,
    `Still breathing (barely)`,
    `Moving at geological speeds`,
    `Slowly creeping toward completion.`,
    `These ones haven't given up on you yet.`,
    `In progress (let's see how this ends).`,
    `Unfinished business (the tension is building).`,
  ]
  return stablePick(items, `summary-inprogress-${seed}`)
}

export function summaryAllObjectivesMetLine(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `All due objectives complete.`
  const items = [
    `Every objective that was due: done. This is real. We checked twice.`,
    `All due objectives met. Look at you, functional.`,
    `All done. Zero excuses needed today.`,
    `Nothing left on the list. We didn't prepare for this outcome.`,
    `Miraculously, you didn't leave a trail of broken promises today. Cherish this anomaly.`,
    `Every due objective has been slaughtered. The ledger is clean, but the tomato remains deeply suspicious.`,
    `No unfinished business. You successfully bullied your inner procrastinator into submission today.`,
    `All targets checked off. A flawless performance in pretending to be a well-adjusted adult.`,
    `Every single objective has been marked compliant. The system has filed this away under 'Unexplained Phenomena.'`,
  ]
  return stablePick(items, `summary-all-met-${seed}`)
}

export function summaryEncouragementNote(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `💪 Some objectives are behind. A fresh start today.`
  const items = [
    `💪 Yesterday: incomplete. Today: fix it.`,
    `💪 Fresh day incoming. Complete at least one objective on purpose.`,
    `💪 New day. Same you, hopefully different choices.`,
    `💪 You can still turn this around. We have low standards.`,
    `💪 Yesterday flopped. The tomato believes in second chances. Barely.`,
    `💪 Treat today as an apology to your future self.`,
    `💪 You can't undo yesterday's laziness, but you can stop compounding the interest.`,
    `💪 Your past self left a landfill behind. Put on some gloves and clear out at least one task today.`,
    `💪 Stop negotiating with the voice that told you to quit yesterday. One check-in. Break the cycle.`,
  ]
  return stablePick(items, `summary-encourage-${seed}`)
}

export function summaryOnPaceNote(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `👍 On pace. Nothing behind.`
  const items = [
    `👍 Nothing behind. Don't let the tomato find out you coasted after this.`,
    `👍 Keeping up. Please don't be the reason the tomato learns to stop believing.`,
    `👍 On pace. The tomato has seen the sequel. It doesn't usually end well.`,
    `👍 Nothing behind. A rare and fragile condition.`,
    `👍 On track. Enjoy this fleeting moment of self-discipline.`,
    `👍 Keeping up. You've completely ruined the plot of today's tragedy.`,
    `👍 On track. The tomato is tentatively putting the red pen away. For now.`,
  ]
  return stablePick(items, `summary-onpace-${seed}`)
}

export function summarySuccessNote(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `🎉 All due objectives complete.`
  const items = [
    `🎉 All due objectives met. We'll allow it.`,
    `🎉 All done. The tomato needs to sit down.`,
    `🎉 The board is clear. We're as shocked as you are.`,
    `🎉 Objectives cleared. This is not what we expected from you. Genuinely.`,
    `🎉 All done. You can stop now, guilt-free. Weird feeling, right?`,
    `🎉 Perfect day. The tomato is temporarily speechless. Enjoy it.`,
    `🎉 Everything done. Now do it again tomorrow. We'll be watching.`,
  ]
  return stablePick(items, `summary-success-${seed}`)
}

export function procrastinationTooltip(
  datePhrase: string,
  minutes: number,
  personality: Personality = 'passive-aggressive',
): string {
  if (personality === 'calm') {
    if (minutes <= 0) return `No idle time logged after breaks on ${datePhrase}.`
    return `${formatMinutesProse(minutes)} idle after breaks on ${datePhrase}.`
  }
  if (minutes <= 0) {
    const items = [
      `No procrastination logged on ${datePhrase}. Suspiciously productive.`,
      `${datePhrase}: 0 idle minutes after breaks. Who are you.`,
      `${datePhrase}: no procrastination recorded. Either focused or forgot to start breaks.`,
      `${datePhrase}: 0 gap minutes. You returned to work immediately after every single break. Who threatened you?`,
      `No procrastination recorded on ${datePhrase}. You didn't negotiate with yourself even once. Terrifying.`,
      `${datePhrase}: 0 gap minutes. Did you replace your blood with industrial-grade espresso, or what?`,
      `${datePhrase}: 0 minutes of hesitation. The tomato sat there with its clipboard, completely unneeded. It felt awkward.`,
      `${datePhrase}: 0 idle minutes. You returned to work on time, every time. The system's low expectations have been temporarily shattered.`,
      `Zero lingering recorded on ${datePhrase}. Pristine execution. We are archiving this day as a myth.`,
    ]
    return stablePick(items, `proc-zero-${datePhrase}`)
  }
  const m = formatMinutesProse(minutes)
  const items = [
    `${m} of prime procrastination on ${datePhrase}.`,
    `${m} of "I'll start in a sec" on ${datePhrase}.`,
    // `${datePhrase}: ${m} avoiding work after your break ended.`,
    // `${m} of "just one more minute" on ${datePhrase}.`,
    `${datePhrase}: ${m}. You put real effort into the procrastination.`,
    `${datePhrase}: ${m} of strong feelings about starting work.`,
    `${datePhrase}: ${m} of post-break negotiations with yourself.`,
    `${m} on ${datePhrase}. We could ask what you were doing. We won't.`,
    `${datePhrase}: ${m}. Almost started. Several times.`,
    `${m} of professional-grade inertia on ${datePhrase}.`,
    `${m} on ${datePhrase}. The timer asked. You said soon.`,
    `${datePhrase}: ${m}. The transition took a moment. A long moment.`,
  ]
  return stablePick(items, `proc-${datePhrase}-${minutes}`)
}

// Tooltip pools exported as template fns so tests assert pool membership instead of hardcoding
// phrases. Commented entries are parked candidates not in the live pool.
type FocusTooltipLine = (datePhrase: string, minutes: number) => string

export const FOCUS_TOOLTIP_ZERO: ((datePhrase: string) => string)[] = [
  d => `0 focus minutes on ${d}. The tomato is fine. Totally fine.`,
  d => `${d}: nothing logged. The tomato has screenshotted this.`,
  d => `Nothing on ${d}. What were you even doing. Don't answer that.`,
  d => `${d}: An unblemished monument to total inactivation.`,
  d => `${d}: The timer spent this entire day contemplating its own existence.`,
  d => `Zero minutes logged on ${d}. A masterclass in strategic withdrawal.`,
  d => `${d}: The chart flatlined here. Much like your motivation that day.`,
  d => `0 minutes on ${d}. A void where productivity goes to evaporate.`,
  d => `Nothing logged on ${d}. The app spent the day listening to the echo of your missed opportunities.`,
  d => `${d}: 0 focus minutes. Your computer screen remained a mirror reflecting a deeply stationary mammal.`,
]

// Lazy tier (1 – LAZY_FOCUS_MIN-1): dismissive criticism, never praise.
export const FOCUS_TOOLTIP_LAZY: FocusTooltipLine[] = [
  (d, m) => `${formatMinutesProse(m)} on ${d}. The tomato has circled this day in red.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. The audacity to actually show up.`,
  (d, m) => `${formatMinutesProse(m)} on ${d}. You were here. Debatably.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. The tomato has noted this with great disappointment.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. You dipped a toe into reality, gasped, and immediately retreated to safety.`,
  (d, m) => `A pitiful ${formatMinutesProse(m)} on ${d}. TubeMato barely had time to warm up before you abandoned it.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. A performance so microscopic that magnifying glasses are being ordered.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. A faint, pathetic twitch of effort before your soul chose comfort and instant gratification once again.`,
  (d, m) => `A miserable ${formatMinutesProse(m)} on ${d}. You flirted with accountability, panicked at the sight of actual labor, and ran away immediately.`,
]

// Intermediate tier (LAZY_FOCUS_MIN – DECENT_FOCUS_MIN-1): meh, not dismissive, not praise.
export const FOCUS_TOOLTIP_MID: FocusTooltipLine[] = [
  (d, m) => `${d}: ${formatMinutesProse(m)}. You were functional. Briefly.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. The tomato clocked it. Considered saying something. Decided against it.`,
  (d, m) => `${d}: ${formatMinutesProse(m)} of baseline human functioning. Nothing to write home about.`,
  (d, m) => `${formatMinutesProse(m)} on ${d}. A mild, completely unremarkable blip on the radar.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. You flirted with productivity, but you clearly didn't want to commit.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. You gave the timer a polite nod as you walked past it to go do something else.`,
  (d, m) => `You logged ${formatMinutesProse(m)} on ${d}. Just enough labor to quiet the guilt, but not enough to actually achieve anything of substance.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. You cruised safely in the dead zone of average effort, entirely unbothered by excellence.`,
]

// Decent tier (≥ DECENT_FOCUS_MIN): praise unlocks.
export const FOCUS_TOOLTIP_DECENT: FocusTooltipLine[] = [
  (d, m) => `${formatMinutesProse(m)} on ${d}. The tomato was not prepared for this information.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. A brief, terrifying glimpse of your actual potential.`,
  (d, m) => `${formatMinutesProse(m)} of focus on ${d}. The tomato is going to need a moment.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. The system has registered your frantic attempt to salvage the week.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. You're definitely going to use this single day to justify a three-day break.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. A historic anomaly. Scientists are investigating.`,
  (d, m) => `${formatMinutesProse(m)} of focus on ${d}. We have archived this day for historical preservation.`,
  (d, m) => `${d}: ${formatMinutesProse(m)}. Look at you, temporarily pretending to have your life together.`,
  (d, m) => `${formatMinutesProse(m)} on ${d}. An aggressive and welcome departure from your usual baseline.`,
]

export function focusTooltip(
  datePhrase: string,
  minutes: number,
  personality: Personality = 'passive-aggressive',
): string {
  if (personality === 'calm') {
    if (minutes <= 0) return `No focus time logged on ${datePhrase}.`
    return `${formatMinutesProse(minutes)} of focus on ${datePhrase}.`
  }
  if (minutes <= 0) {
    return stablePick(FOCUS_TOOLTIP_ZERO, `focus-zero-${datePhrase}`)(datePhrase)
  }
  // Three tiers matching dailySummaryNotificationBody: lazy / intermediate / decent.
  if (minutes < LAZY_FOCUS_MIN) {
    return stablePick(FOCUS_TOOLTIP_LAZY, `focus-lazy-${datePhrase}`)(datePhrase, minutes)
  }
  if (minutes < DECENT_FOCUS_MIN) {
    return stablePick(FOCUS_TOOLTIP_MID, `focus-mid-${datePhrase}`)(datePhrase, minutes)
  }
  return stablePick(FOCUS_TOOLTIP_DECENT, `focus-${datePhrase}-${minutes}`)(datePhrase, minutes)
}

// ─── Objective card badges ───────────────────────────────────────────────────

/** Undefined in calm mode: the badge already states the fact, and calm has no joke to add. */
export function badgeDebtTitle(seed: string, personality: Personality = 'passive-aggressive'): string | undefined {
  if (personality === 'calm') return undefined
  const items = [
    `Past check-ins you skipped. They didn't disappear. They're just waiting.`,
    `Past you skipped a deadline. Present you has company.`,
    `Carried-over check-ins from a missed deadline. No interest. Just shame.`,
    `The deadline closed. These check-ins filed an appeal. It was granted.`,
    `You owe these from a deadline you'd rather forget. We haven't.`,
    `A deadline ended without these. They took it personally.`,
    `The physical manifestation of 'I'll do it tomorrow.'`,
    `Yesterday's shortcut, compounding into today's tax.`,
    `Check-ins missed! I guess you'll do just fine with having an hour of oxygen today.`,
  ]
  return stablePick(items, `badge-debt-title-${seed}`)
}

/** One-time only: the joke is stasis, not debt's accrual. */
export function badgeOverdueTitle(seed: string, personality: Personality = 'passive-aggressive'): string | undefined {
  if (personality === 'calm') return undefined
  const items = [
    `Staring at it doesn't make it done.`,
    `This deadline died a while ago.`,
    `A moment of silence for this deadline.`,
    `Aging like milk on your schedule.`,
    `Overdue. But we both saw that coming.`,
    `Inspecting your failures up close, are we?`,
    `It's been waiting so long it's eligible for pension.`,
    `Added to your growing collection of 'later'.`,
    `Your past self made a promise present self ignored.`,
  ]
  return stablePick(items, `badge-overdue-title-${seed}`)
}

export function bankAnotherLabel(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `✓ Check in`
  return stablePick([
    `✓ Bank another`,
    `✓ Overachiever`,
    `✓ Sure buddy`,
    `✓ Keep going, show-off`,
    `✓ Overclocked`,
    `✓ Call the press`,
    `✓ Dopamine unlocked`,
    `✓ Print the certificate`,
    `✓ Gold star for you`,
    `✓ Miracles happen`,
    `✓ Aura farming`,
  ], `bank-another-${seed}`)
}

export function markDoneLabel(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `✓ Check in`
  const items = [
    `✓ Fine, count it`,
    `✓ Log it`,
    `✓ I did the thing`,
    `✓ Check in (finally)`,
    `✓ Finally`,
    `✓ Yes, I actually did this`,
    `✓ Happy now?`,
    `✓ Record the miracle`,
    `✓ Satisfy the tomato`,
  ]
  return stablePick(items, `mark-done-${seed}`)
}

/**
 * Fills the objective card's action slot once it's met and there's no check-in/bank action left
 * (one-time done, or repeating done with credit off).
 */
export function objectivePraiseLabel(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') {
    return stablePick([
      `🌱 Nicely done. Rest easy.`,
      `✨ Well earned.`,
      `🌿 That took real effort. Good work.`,
      `💚 Good work today.`,
      `⛅ You showed up. That's what counts.`,
      `🍃 Quietly excellent.`,
      `🌟 Right on target. Beautifully handled.`,
      `🧘 Nothing left to do. Enjoy it.`,
      `☺️ Proud of you. Genuinely.`,
      `☕ Go take a breather.`,
    ], `objective-praise-calm-${seed}`)
  }
  return stablePick([
    `🍅 Wow. You actually did it.`,
    `😏 Don't let it go to your head.`,
    `🎉 Incredible. It only took you this long.`,
    `👏 Look at you. A functioning adult.`,
    `🏆 A trophy for keeping a basic promise.`,
    `🙄 Finally. The suspense was unbearable.`,
    `📸 Someone alert the historians.`,
    `🥇 Bare minimum, gloriously achieved.`,
    `🎈 Congratulations on the absolute baseline.`,
    `🤝 Against all odds and my expectations.`,
    `📅 Marking today as a national holiday.`,
    `🦕 Historic moment. Documenting this for science.`,
    `😮 You finished. Honestly, I had my doubts.`,
  ], `objective-praise-${seed}`)
}

export function objectivesEmptyLine(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `No objectives yet. Add one to get started.`
  const items = [
    `No objectives yet. Your future self is already disappointed.`,
    `Nothing here. Add a goal before guilt sets in.`,
    `No objectives. Living dangerously.`,
    `Empty list. Add something so we have material to roast you with.`,
    `Zero objectives. Hard to fail when there's nothing to do.`,
    `A pristine desert of zero intent. Plant a goal before the weeds take over.`,
    `A pristine wilderness of zero ambition. Add a target before your willpower completely atrophies.`,
    `No objectives set. You can't miss a target if you don't have one, can you? Adorable strategy.`,
    `A beautifully blank canvas of absolute avoidance. Give us something to track.`,
    `Bored? Me too bro, let's hang out.`,
  ]
  return stablePick(items, `objectives-empty-${seed}`)
}

export function scheduleEmptyLine(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Create an objective first, then you can schedule events for it here.`
  const items = [
    `Nothing to plan here. Go give yourself a purpose in the objectives tab first.`,
    `A beautifully clean slate, or an alarming symptom of deep denial? Fix the objective deficit first.`,
    `A stunningly blank timeline. Go add an objectives before you spend the afternoon staring at the ceiling.`,
    `A ghost town of ambition. Add an objective before the time slips away completely.`,
    `A spotless calendar, achieved entirely through strategic inaction. Go add an objective first.`,
    `Your calendar has achieved total spiritual peace through an absolute lack of effort. Go add an objective.`,
    `An entire day unburdened by expectations. Go shatter this peaceful illusion by making an objective.`,
  ]
  return stablePick(items, `schedule-empty-${seed}`)
}

export function aboutMessage(personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `A Pomodoro timer with YouTube integration and productivity tracking.`
  return pick([
    `A pomodoro timer with opinions. Mostly about you.`,
    `You clicked the tomato. We're not sure what you were hoping to find.`,
    `Tracking how little you do since whenever you installed this.`,
    `Built to outlast your motivation. Working as intended.`,
    `You opened the about screen instead of working. Very on brand.`,
    `The tomato has seen your session history. It has opinions.`,
    `A timer, some judgment, and a tomato. That's the whole app.`,
    `You need this app. That says a lot about you.`,
    `Every second you spend here is a second you aren't working. Just saying.`,
    `The tomato has seen things. Mostly your idle timer.`,
    `You. This app. A complex relationship built on guilt and timers.`,
    `We made an app to track your failures. You downloaded it.`,
    `Still here? The timer is waiting. The tomato is staring.`,
    `A productivity app for people who need a productivity app. You know who you are.`,
    `The tomato didn't choose this life. Neither did you. Here we are.`,
    `The tomato remembers everything. You, apparently, do not.`,
    `You clicked a tomato for motivation. This is fine.`,
    `TubeMato: because apparently you needed a tomato to tell you to work.`,
  ])
}

// ─── Click-to-escalate ladders ───────────────────────────────────────────────
// Ordered, not random: the escalation IS the joke, so the sequence has to climb.

export const objectivesEmptyLadder: string[] = [
  `You poked me. For what. There's nothing here.`,
  `Stop touching the tomato.`,
  `Setting an objective takes 10 seconds. You've spent longer poking me.`,
  `Keep going. See what happens.`,
  `I AM A TOMATO WITH NO PURPOSE BECAUSE OF YOU.`,
]

export const scheduleEmptyLadder: string[] = [
  `That poke did nothing. Today is still a total blank.`,
  `I am not a stress ball. Move your cursor to the objectives tab.`,
  `Writing a goal takes 10 seconds. You've spent longer poking me.`,
  `Keep tapping. See if the blank space solves your life for you.`,
  `YOUR FUTURE IS AN UNWRITTEN VOID AND YOU ARE OUT HERE POKING A TOMATO.`,
]

export const aboutLadder: string[] = [
  `Something is happening to me. Go start a timer before it gets worse.`,
  `I feel things. You should feel productive. Go.`,
  `You've poked me three times. The timer has been started zero times.`,
  `What do you want from me. The work isn't going to do itself. I KNOW THIS.`,
  `GO TOUCH GRASS. NOT ME. GRASS.`,
]

export function analyticsSubtitle(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Your productivity over time.`
  const items = [
    `The gap between what you planned and what happened. Visualized.`,
    `The numbers remember what you'd rather forget.`,
    `Patterns are forming. Some of them are embarrassing.`,
    `We kept the empty days. For memories.`,
    `Your record speaks for itself. We'll be quiet. For now.`,
    `The app was running even when you weren't.`,
    `A cold, hard graph detailing exactly where your afternoon went.`,
    `The trendlines of your ambition versus the flatlines of your execution.`,
  ]
  return stablePick(items, `analytics-subtitle-${seed}`)
}

export function settingsSubtitle(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Customize how TubeMato works.`
  const items = [
    `Adjust the numbers. It won't fix the discipline problem.`,
    `Configuration options. None of them fix procrastination.`,
    `Change the timers all you want. The work stays the same.`,
    `There is no setting for discipline.`,
    `Settings. For when you'd rather configure than execute.`,
    `Spend as long as you need in here. The tasks will wait.`,
    `Feel free to adjust the thresholds. The workload will remain the exact same size.`,
  ]
  return stablePick(items, `settings-subtitle-${seed}`)
}

export function objectivesSubtitle(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Your one-time and recurring objectives.`
  const items = [
    `Whatever you don't finish, the tomato is writing it down.`,
    `The audacity of opening this app without finishing your objectives.`,
    `You opened TubeMato. Bold. Now check in.`,
    `The tomato has seen your history. It has questions.`,
    `The objectives asked where you've been.`,
    `Your targets are staring back at you. They don't look particularly confident.`,
    `A collection of promises you made to yourself. Let's see how many you break today.`,
    `Your intentions look beautiful on screen. Let's see if they survive physical effort.`,
  ]
  return stablePick(items, `objectives-subtitle-${seed}`)
}

export function scheduleAlertBody(
  offsetMinutes: number,
  startTime: string,
  seed: string,
  personality: Personality = 'passive-aggressive',
): string {
  if (offsetMinutes <= 0) {
    if (personality === 'calm') return `Your planned time for this. Click to start a focus session.`
    return stablePick([
      `The hour you promised yourself is running. Click start to face reality.`,
      `Your work session is live. No more side quests. Click start and face the reality.`,
      `Your work session is waiting awkwardly. Click here and actually do what you said you'd do.`,
      `Your self-imposed temporal lock is active. Cease secondary cognitive operations immediately.`,
      `The timer is ready, and your willpower is on trial. Click start.`,
      `This hour belongs to your objective. Click start before you conveniently forget you planned this.`,
      `Your work is here. Stop negotiating with yourself, click start, and pretend to be a well-adjusted adult.`,
      `The clock is running on your promise. Click start to convince me you actually meant it.`,
      `This is the exact window you locked in. Put down the distraction and hit start before the guilt hits.`,
      `You were expecting a social media notification, but it was me, TubeMato! Hit start.`,
    ], `schedule-alert-now-${seed}`)
  }
  if (personality === 'calm') return `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Click to start now.`
  return stablePick([
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Past you actually had ambition. Don't let them down.`,
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Just a heads-up before your willpower entirely evaporates.`,
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Your self-imposed timeline is approaching. Finish your side quests.`,
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Wrap up the slacking, your focus window is looming.`,
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Past you signed a contract for this block. Clear your tabs.`,
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Past you set this up. Let's see if present you actually honors the deal.`,
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. Time to start wrapping up whatever unverified busywork you're hiding behind.`,
    `Starts ${alertLeadLabel(offsetMinutes)} at ${startTime}. The tomato is just checking in to make sure you don't "accidentally" wander off.`,
    `Incoming reality check at ${startTime}. Secure the perimeter and finalize your distractions.`,
  ], `schedule-alert-lead-${seed}`)
}

export function scheduleSubtitle(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Plan your focus time, event by event.`
  const items = [
    `A bureaucratic fantasy layout. Let's see if reality cooperates.`,
    `Mapping out your future delusions of productivity. Adorable.`,
    `A beautifully orchestrated trap for your afternoon slacking habits.`,
    `Where you sketch the daily boundaries to keep your focus from rolling off a cliff.`,
    `Your scheduled intentions, event by event. A helpful guide for an easily distracted brain.`,
    `The layout for your today workflow. Try to design a daily timeline you can actually finish.`,
    `A visual checklist for your daily willpower. Map out your work sessions before you lose the urge entirely.`,
    `A visual roadmap of your self-imposed intentions. Let's see how closely your actions follow the map today.`,
  ]
  return stablePick(items, `schedule-subtitle-${seed}`)
}

export function fiveYearSubtitle(seed: string, personality: Personality = 'passive-aggressive'): string {
  if (personality === 'calm') return `Where you want to be in the next five years.`
  const items = [
    `Your science fiction, year by year.`,
    `Long-term vision, stored here so today's excuses have less legroom.`,
    `A five-year bet on who you'll become. The odds are currently under review.`,
    `Write down the hope before reality sets back in.`,
    `The official blueprint for your upcoming redemption arc.`,
    `Grand plans for five years. Let's start by conquering this afternoon.`,
    `A beautiful vision of the future. Don't let present-day you ruin it.`,
  ]
  return stablePick(items, `fiveyear-subtitle-${seed}`)
}
