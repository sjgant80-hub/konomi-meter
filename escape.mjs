// escape.mjs — of the money that left the machine, how much needed to?
//
// THE CLAIM THIS MODULE REFUSES TO MAKE
//
// "That job should have run locally, it would have been cheaper" is trivially true of every remote
// call ever made, and therefore worthless. Cheaper is not the question. The question is whether the
// local tier could actually have DONE it, and the honest answer is usually that nobody knows, because
// nobody tried.
//
// So an escaped run is only marked AVOIDABLE when there is recorded evidence that the local tier
// handles that task type — real runs, at a real success rate. Without evidence it is UNPROVEN, and
// UNPROVEN spend is reported separately rather than folded into a savings figure. A tool that added
// them together would produce exactly the number its owner wants and none of the information they need.
//
//   AVOIDABLE   the local tier has a recorded success rate on this task type at or above the bar
//   NECESSARY   local was tried on this task type and fell below the bar
//   UNPROVEN    local was never tried on this task type — no claim either way
//
// Pure and deterministic: no I/O, no clock, no randomness.
import { summary } from './ledger.mjs';

export const AVOIDABLE = 'AVOIDABLE';
export const NECESSARY = 'NECESSARY';
export const UNPROVEN = 'UNPROVEN';
export const CLASSES = Object.freeze([AVOIDABLE, NECESSARY, UNPROVEN]);

export const DEFAULTS = Object.freeze({
  successBar: 0.8,   // local success rate on a task type before escaping it is called avoidable
  minLocalRuns: 3,   // and enough local attempts for that rate to mean anything
});

/** What the local tier has actually demonstrated, per task type. */
export function localEvidence(ledger, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const types = [...new Set(ledger.entries.map(e => e.taskType))].sort();
  return types.map(t => {
    const local = ledger.entries.filter(e => e.taskType === t && e.local);
    const ok = local.filter(e => e.ok).length;
    const rate = local.length === 0 ? null : ok / local.length;
    const enough = local.length >= o.minLocalRuns;
    return {
      taskType: t, localRuns: local.length, localOk: ok, rate, enough,
      meanSeconds: local.length === 0 ? null : local.reduce((s, e) => s + e.seconds, 0) / local.length,
      meanCost: local.length === 0 ? null : local.reduce((s, e) => s + e.cost, 0) / local.length,
      verdict: local.length === 0 ? UNPROVEN : !enough ? UNPROVEN : rate >= o.successBar ? AVOIDABLE : NECESSARY,
    };
  });
}

/**
 * Classify every escaped run, and total the spend three ways.
 *
 * `avoidable` is the only figure that may be called a saving. `unproven` is the size of the question
 * you have not answered — and the fastest way to shrink it is to run the local tier on those task
 * types once and find out, which is a recommendation the report makes explicitly.
 */
export function classify(ledger, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const evidence = localEvidence(ledger, o);
  const byType = new Map(evidence.map(e => [e.taskType, e]));

  const escaped = ledger.entries.filter(e => !e.local).map(e => {
    const ev = byType.get(e.taskType);
    const verdict = ev ? ev.verdict : UNPROVEN;
    const reason = verdict === AVOIDABLE
      ? `local handled this task type ${ev.localOk}/${ev.localRuns} times — this call did not need to leave the machine`
      : verdict === NECESSARY
        ? `local was tried on this task type and managed only ${ev.localOk}/${ev.localRuns} — escaping was reasonable`
        : ev && ev.localRuns > 0
          ? `local was tried only ${ev.localRuns} time(s); ${o.minLocalRuns} are needed before the rate means anything`
          : 'local has never been tried on this task type, so there is no basis for a claim either way';
    return { ...e, verdict, reason, localMeanCost: ev ? ev.meanCost : null };
  });

  const spendIn = c => escaped.filter(e => e.verdict === c).reduce((s, e) => s + e.cost, 0);
  const avoidable = spendIn(AVOIDABLE), necessary = spendIn(NECESSARY), unproven = spendIn(UNPROVEN);

  // What the avoidable work would have cost locally. Only computed where a local mean exists, which
  // is exactly the AVOIDABLE set — so the comparison is against measured runs, not a guess.
  const wouldHaveCost = escaped
    .filter(e => e.verdict === AVOIDABLE && e.localMeanCost !== null)
    .reduce((s, e) => s + e.localMeanCost, 0);

  return {
    spec: 'konomi-meter-v1', escaped, evidence,
    escapedTotal: avoidable + necessary + unproven,
    avoidable, necessary, unproven,
    wouldHaveCost, netSaving: avoidable - wouldHaveCost,
    // the task types worth running locally once, purely to convert unproven spend into an answer
    worthTesting: evidence
      .filter(e => e.verdict === UNPROVEN)
      .map(e => ({ taskType: e.taskType, escapedSpend: escaped.filter(x => x.taskType === e.taskType).reduce((s, x) => s + x.cost, 0), localRuns: e.localRuns }))
      .filter(e => e.escapedSpend > 0)
      .sort((a, b) => b.escapedSpend - a.escapedSpend),
    thresholds: o,
  };
}

/**
 * One sentence a person can act on, and it never adds unproven spend to the saving.
 */
export function reading(ledger, opts = {}) {
  const s = summary(ledger);
  const c = classify(ledger, opts);
  // Sub-penny figures are real here — a local run costs fractions of a penny — so they get four
  // decimals rather than rounding to "£0.00", which would read as free and is the whole error this
  // repo exists to correct.
  const m = n => `£${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;

  if (s.remoteRuns === 0) return `Nothing left the machine. ${s.runs} runs, all local, ${m(s.total)} of electricity.`;
  const parts = [`${s.remoteRuns} of ${s.runs} runs left the machine, costing ${m(s.remoteCost)} against ${m(s.localCost)} of electricity for the ${s.localRuns} that stayed.`];
  if (c.avoidable > 0) {
    parts.push(`${m(c.avoidable)} of that went on task types the local tier has demonstrably handled — running them locally would have cost about ${m(c.wouldHaveCost)}, a net ${m(c.netSaving)}.`);
  }
  if (c.unproven > 0) {
    parts.push(`A further ${m(c.unproven)} is UNPROVEN: local has never been tried on those task types, so it is not counted as a saving${c.worthTesting.length ? ` — start with ${c.worthTesting[0].taskType}` : ''}.`);
  }
  if (c.necessary > 0) parts.push(`${m(c.necessary)} was on types local has tried and failed, so it was reasonable.`);
  return parts.join(' ');
}

export default { AVOIDABLE, NECESSARY, UNPROVEN, CLASSES, DEFAULTS, localEvidence, classify, reading };
