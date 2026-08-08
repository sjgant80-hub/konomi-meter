// ledger.mjs — the runs, attributed by task type rather than summed into one number.
//
// A monthly total is the least useful shape this data has. "You spent £41 on the frontier" prompts no
// decision. "Your four bulk-classification jobs cost £38 of that, and the same job type runs locally
// in nine seconds" prompts exactly one.
//
// So everything here is grouped by TASK TYPE first and tier second. The type is the unit a person can
// act on: they can move a type of work, they cannot move an individual call that already happened.
//
// Pure and deterministic: no I/O, no clock, no randomness. Timestamps are inputs.
import { TIER_IDS, tierOf, isLocal, costOf, assumptions } from './tariff.mjs';

const TYPE_RE = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;

/** Every reason a run cannot be recorded. Empty array = clean. */
export function violations(run) {
  const v = [];
  if (!run || typeof run !== 'object') { v.push('a run must be an object'); return v; }
  if (typeof run.taskType !== 'string' || !TYPE_RE.test(run.taskType)) {
    v.push('taskType must be a lowercase slug — it is the unit you can actually move, so it has to be nameable');
  }
  if (!TIER_IDS.includes(run.tier)) v.push(`tier must be one of: ${TIER_IDS.join(', ')}`);
  if (!Number.isFinite(run.seconds) || run.seconds < 0) v.push('seconds must be a non-negative number');
  for (const k of ['tokensIn', 'tokensOut']) {
    if (run[k] !== undefined && (!Number.isFinite(run[k]) || run[k] < 0)) v.push(`${k} must be a non-negative number when given`);
  }
  if (run.ok !== undefined && typeof run.ok !== 'boolean') v.push('ok must be a boolean when given — a run that half-worked is a run that failed');
  // A remote run with no token counts cannot be priced, and pricing it at zero would hide it.
  if (TIER_IDS.includes(run.tier) && !isLocal(run.tier)) {
    const i = Number(run.tokensIn) || 0, o = Number(run.tokensOut) || 0;
    if (i + o === 0) v.push('a remote run needs token counts — without them it would price at zero, which is how spend disappears from a report');
  }
  return v;
}

/** Build the ledger. Throws on a run that cannot be priced honestly. */
export function makeLedger(runs, tariffs = {}) {
  if (!Array.isArray(runs) || runs.length === 0) throw new Error('a ledger needs at least one run');
  const entries = runs.map((r, i) => {
    const v = violations(r);
    if (v.length) throw new Error(`run ${i}${r && r.id ? ` (${r.id})` : ''} rejected:\n  - ${v.join('\n  - ')}`);
    const local = isLocal(r.tier);
    return Object.freeze({
      id: r.id ?? `run-${i}`, taskType: r.taskType, tier: r.tier, local,
      seconds: r.seconds, tokensIn: Number(r.tokensIn) || 0, tokensOut: Number(r.tokensOut) || 0,
      ok: r.ok !== false, cost: costOf(r, tariffs),
    });
  });
  return Object.freeze({ spec: 'konomi-meter-v1', entries: Object.freeze(entries), tariffs, assumptions: assumptions(tariffs) });
}

const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

/** Totals, split by where the work ran. */
export function summary(ledger) {
  const e = ledger.entries;
  const local = e.filter(x => x.local), remote = e.filter(x => !x.local);
  const byTier = TIER_IDS.map(id => {
    const rs = e.filter(x => x.tier === id);
    return { tier: id, name: tierOf(id).name, local: tierOf(id).local, runs: rs.length, cost: sum(rs, x => x.cost), seconds: sum(rs, x => x.seconds) };
  }).filter(t => t.runs > 0);

  const types = [...new Set(e.map(x => x.taskType))].sort();
  const byType = types.map(t => {
    const rs = e.filter(x => x.taskType === t);
    const l = rs.filter(x => x.local), r = rs.filter(x => !x.local);
    return {
      taskType: t, runs: rs.length, cost: sum(rs, x => x.cost),
      localRuns: l.length, localCost: sum(l, x => x.cost),
      remoteRuns: r.length, remoteCost: sum(r, x => x.cost),
      // the share of this type's spend that left the machine — the number that ranks the list
      escapedShare: sum(rs, x => x.cost) === 0 ? 0 : sum(r, x => x.cost) / sum(rs, x => x.cost),
    };
  }).sort((a, b) => b.remoteCost - a.remoteCost || a.taskType.localeCompare(b.taskType));

  const total = sum(e, x => x.cost);
  return {
    runs: e.length, total,
    localRuns: local.length, localCost: sum(local, x => x.cost),
    remoteRuns: remote.length, remoteCost: sum(remote, x => x.cost),
    // "sovereign share" by COST, not by call count — a thousand cheap local calls and one expensive
    // frontier call is not 99.9% sovereign in any sense that matters to a bill
    sovereignShare: total === 0 ? 1 : sum(local, x => x.cost) / total,
    sovereignShareByRuns: e.length === 0 ? 1 : local.length / e.length,
    byTier, byType, assumptions: ledger.assumptions,
  };
}

export default { violations, makeLedger, summary };
