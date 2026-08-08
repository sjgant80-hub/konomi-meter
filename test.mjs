// test.mjs — the suite. Run: node test.mjs
//
// Two claims carry this repo and both are tested as the thing they are:
//
//   LOCAL IS NOT FREE — the arithmetic is checked against hand-computed values, because a cost model
//   nobody verified is a spreadsheet with opinions in it.
//
//   "SHOULD HAVE RUN LOCALLY" IS A CLAIM ABOUT CAPABILITY, NOT PRICE — so the suite constructs the
//   case where local was never tried and asserts that the spend is reported UNPROVEN and kept OUT of
//   the savings figure. A tool that folded it in would produce the number its owner wants.
import { TIERS, TIER_IDS, tierOf, isLocal, localCost, remoteCost, costOf, assumptions, DEFAULT_LOCAL } from './tariff.mjs';
import { violations, makeLedger, summary } from './ledger.mjs';
import { AVOIDABLE, NECESSARY, UNPROVEN, CLASSES, DEFAULTS, localEvidence, classify, reading } from './escape.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.error(`  FAIL  ${name}${extra ? ' · ' + extra : ''}`); } };
const throws = (name, fn, match) => {
  try { fn(); ok(name, false, 'expected a throw'); }
  catch (e) { ok(name, match ? String(e.message).includes(match) : true, e.message.slice(0, 100)); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const run = (o = {}) => ({ taskType: 'classify', tier: 'T2', seconds: 10, ok: true, ...o });
const remote = (o = {}) => ({ taskType: 'classify', tier: 'T4', seconds: 2, tokensIn: 1000, tokensOut: 500, ok: true, ...o });
const TARIFF = { local: { watts: 250, pricePerKWh: 0.27 }, remote: { T4: { inPerM: 3, outPerM: 15 } } };

// ── 1 · the cost model, against hand-computed values ────────────────────────────────────────
// 250W for 3600s = 0.25 kWh; at £0.40/kWh that is exactly £0.10
ok('local · one hour at 250W and 40p/kWh is 10p', near(localCost(3600, { watts: 250, pricePerKWh: 0.4 }), 0.10));
// 100W for 36s = 0.001 kWh; at £1/kWh that is exactly £0.001
ok('local · the kWh arithmetic is exact', near(localCost(36, { watts: 100, pricePerKWh: 1 }), 0.001));
ok('local · zero seconds costs nothing', localCost(0, TARIFF.local) === 0);
ok('local · zero watts costs nothing', localCost(3600, { watts: 0, pricePerKWh: 1 }) === 0);
ok('local · a negative duration is floored at zero', localCost(-50, TARIFF.local) === 0);
ok('local · a negative price is floored at zero', localCost(3600, { watts: 250, pricePerKWh: -1 }) === 0);
ok('local · cost scales linearly with time', near(localCost(20, TARIFF.local), 2 * localCost(10, TARIFF.local)));
ok('local · a real run is small but NOT zero', (() => { const c = localCost(40, DEFAULT_LOCAL); return c > 0 && c < 0.01; })());
// amortisation is the only route by which hardware enters the figure
ok('local · amortisation adds a per-hour charge',
  near(localCost(3600, { watts: 0, pricePerKWh: 0, amortisePerHour: 0.5 }), 0.5));
ok('local · with no amortisation rate hardware is excluded', localCost(3600, { watts: 0, pricePerKWh: 0 }) === 0);

// 1M in at £3 + 1M out at £15 = £18 exactly
ok('remote · a million each way prices exactly', near(remoteCost(1e6, 1e6, { inPerM: 3, outPerM: 15 }), 18));
ok('remote · input and output are priced separately', near(remoteCost(1e6, 0, { inPerM: 3, outPerM: 15 }), 3));
ok('remote · a free tier costs nothing in money', remoteCost(1e6, 1e6, {}) === 0);
ok('remote · negative tokens are floored at zero', remoteCost(-5, -5, { inPerM: 3, outPerM: 15 }) === 0);

// ── 2 · the tiers ───────────────────────────────────────────────────────────────────────────
ok('tiers · there are six', TIERS.length === 6);
ok('tiers · four are local', TIERS.filter(t => t.local).length === 4);
ok('tiers · two are remote', TIERS.filter(t => !t.local).length === 2);
ok('tiers · the free remote tier is still remote', isLocal('T3') === false);
ok('tiers · because free in money is not free in data', tierOf('T3').note.includes('not in data'));
ok('tiers · every tier has a distinct id', new Set(TIER_IDS).size === 6);
ok('tiers · an unknown tier resolves to null', tierOf('T9') === null && isLocal('T9') === null);
throws('cost · an unknown tier THROWS rather than pricing at zero', () => costOf({ tier: 'T9', seconds: 1 }, TARIFF), 'unknown tier');
ok('cost · dispatches a local run to the energy model', near(costOf(run(), TARIFF), localCost(10, TARIFF.local)));
ok('cost · dispatches a remote run to the token model', near(costOf(remote(), TARIFF), remoteCost(1000, 500, TARIFF.remote.T4)));
ok('cost · a remote tier with no tariff prices at zero money, not an error', costOf(remote({ tier: 'T3' }), TARIFF) === 0);

// assumptions travel with the number
{
  const a = assumptions(TARIFF);
  ok('assumptions · state what is counted', /marginal electricity/.test(a.counts));
  ok('assumptions · list hardware as excluded when not amortised', a.excludes.some(x => /hardware/.test(x)));
  ok('assumptions · drop that exclusion when amortisation is supplied',
    !assumptions({ local: { amortisePerHour: 1 } }).excludes.some(x => /hardware/.test(x)));
  ok('assumptions · always exclude your waiting time', a.excludes.some(x => /waiting/.test(x)));
}

// ── 3 · the ledger ──────────────────────────────────────────────────────────────────────────
ok('ledger · a clean run has no violations', violations(run()).length === 0);
ok('ledger · rejects a missing task type', violations(run({ taskType: '' })).some(v => v.includes('taskType')));
ok('ledger · rejects a task type that is not a slug', violations(run({ taskType: 'Bulk Classify' })).some(v => v.includes('taskType')));
ok('ledger · accepts a hyphenated slug', violations(run({ taskType: 'bulk-classify' })).length === 0);
ok('ledger · rejects an unknown tier', violations(run({ tier: 'T9' })).some(v => v.includes('tier must be')));
ok('ledger · rejects negative seconds', violations(run({ seconds: -1 })).some(v => v.includes('seconds')));
ok('ledger · rejects a non-numeric duration', violations(run({ seconds: 'ten' })).some(v => v.includes('seconds')));
ok('ledger · rejects a non-boolean ok', violations(run({ ok: 'yes' })).some(v => v.includes('ok must be')));
ok('ledger · rejects a non-object', violations(null).length > 0);
// THE ONE THAT MATTERS: a remote run with no tokens would price at zero and vanish
ok('ledger · REFUSES a remote run with no token counts',
  violations(remote({ tokensIn: 0, tokensOut: 0 })).some(v => v.includes('would price at zero')));
ok('ledger · a remote run with only output tokens is acceptable', violations(remote({ tokensIn: 0, tokensOut: 500 })).length === 0);
ok('ledger · a LOCAL run needs no token counts', violations(run({ tokensIn: undefined })).length === 0);
throws('ledger · makeLedger throws on a bad run', () => makeLedger([run({ tier: 'T9' })], TARIFF), 'rejected');
throws('ledger · refuses an empty ledger', () => makeLedger([], TARIFF), 'at least one run');
ok('ledger · names the offending run', (() => {
  try { makeLedger([run({ id: 'nightly-7', seconds: -1 })], TARIFF); return false; }
  catch (e) { return e.message.includes('nightly-7'); }
})());
ok('ledger · assigns an id when none is given', makeLedger([run()], TARIFF).entries[0].id === 'run-0');
ok('ledger · defaults ok to true', makeLedger([run({ ok: undefined })], TARIFF).entries[0].ok === true);
ok('ledger · marks a run local or remote', (() => {
  const l = makeLedger([run(), remote()], TARIFF);
  return l.entries[0].local === true && l.entries[1].local === false;
})());

// ── 4 · attribution by task type ────────────────────────────────────────────────────────────
{
  const l = makeLedger([
    ...Array.from({ length: 20 }, () => run({ taskType: 'lint', seconds: 5 })),
    ...Array.from({ length: 4 }, () => remote({ taskType: 'bulk-classify', tokensIn: 200000, tokensOut: 50000 })),
    run({ taskType: 'summarise', seconds: 8 }),
  ], TARIFF);
  const s = summary(l);
  ok('summary · counts every run', s.runs === 25);
  ok('summary · separates local from remote', s.localRuns === 21 && s.remoteRuns === 4);
  ok('summary · totals to the sum of the parts', near(s.total, s.localCost + s.remoteCost));
  ok('summary · groups by task type', s.byType.length === 3);
  ok('summary · ranks task types by escaped spend', s.byType[0].taskType === 'bulk-classify');
  ok('summary · reports the escaped share of a type', near(s.byType[0].escapedShare, 1));
  ok('summary · a fully local type has a zero escaped share',
    s.byType.find(t => t.taskType === 'lint').escapedShare === 0);
  ok('summary · groups by tier and drops empty tiers', s.byTier.every(t => t.runs > 0));

  // sovereign share BY COST is the honest one — 21 of 25 runs is 84% by count and far less by money
  ok('summary · sovereign share by runs is high', s.sovereignShareByRuns > 0.8);
  ok('summary · sovereign share by COST is much lower', s.sovereignShare < 0.05, `${s.sovereignShare}`);
  ok('summary · the two measures genuinely disagree', s.sovereignShareByRuns - s.sovereignShare > 0.5);
}

// ── 5 · THE REFUSAL · "should have run locally" needs evidence, not arithmetic ───────────────
{
  // bulk-classify escaped to the frontier, and local has NEVER been tried on it
  const l = makeLedger([
    ...Array.from({ length: 5 }, () => run({ taskType: 'lint', seconds: 5 })),
    ...Array.from({ length: 3 }, () => remote({ taskType: 'bulk-classify', tokensIn: 200000, tokensOut: 50000 })),
  ], TARIFF);
  const c = classify(l);
  ok('refusal · escaped spend with no local evidence is UNPROVEN', c.escaped.every(e => e.verdict === UNPROVEN));
  ok('refusal · and is NOT counted as avoidable', c.avoidable === 0);
  ok('refusal · the unproven figure is reported separately', c.unproven > 0);
  ok('refusal · the reason says local was never tried', /never been tried/.test(c.escaped[0].reason));
  ok('refusal · the saving stays at zero', c.netSaving === 0);
  ok('refusal · the task type is flagged as worth testing', c.worthTesting[0].taskType === 'bulk-classify');
  ok('refusal · the reading refuses to call it a saving', /UNPROVEN/.test(reading(l)));
  ok('refusal · escapedTotal accounts for every escaped run',
    near(c.escapedTotal, c.escaped.reduce((s, e) => s + e.cost, 0)));
}
{
  // now local HAS handled bulk-classify, five times out of five
  const l = makeLedger([
    ...Array.from({ length: 5 }, () => run({ taskType: 'bulk-classify', seconds: 9 })),
    ...Array.from({ length: 3 }, () => remote({ taskType: 'bulk-classify', tokensIn: 200000, tokensOut: 50000 })),
  ], TARIFF);
  const c = classify(l);
  ok('evidence · demonstrated local capability makes escaping AVOIDABLE', c.escaped.every(e => e.verdict === AVOIDABLE));
  ok('evidence · the avoidable spend is counted', c.avoidable > 0);
  ok('evidence · the reason quotes the local record', /5\/5/.test(c.escaped[0].reason));
  ok('evidence · what it would have cost locally is computed from MEASURED runs', c.wouldHaveCost > 0);
  ok('evidence · and is far smaller than the escaped spend', c.wouldHaveCost < c.avoidable / 100);
  ok('evidence · the net saving is the difference', near(c.netSaving, c.avoidable - c.wouldHaveCost));
  ok('evidence · nothing is unproven here', c.unproven === 0);
  ok('evidence · the reading now names a saving', /net £/.test(reading(l)));
}
{
  // local was tried and is not good enough — escaping was reasonable
  const l = makeLedger([
    ...Array.from({ length: 4 }, (_, i) => run({ taskType: 'hard-reasoning', seconds: 30, ok: i === 0 })),
    ...Array.from({ length: 2 }, () => remote({ taskType: 'hard-reasoning', tokensIn: 50000, tokensOut: 20000 })),
  ], TARIFF);
  const c = classify(l);
  ok('evidence · a poor local record makes escaping NECESSARY', c.escaped.every(e => e.verdict === NECESSARY));
  ok('evidence · that spend is not called avoidable', c.avoidable === 0);
  ok('evidence · nor unproven — it was tried', c.unproven === 0);
  ok('evidence · the reason quotes the failure rate', /1\/4/.test(c.escaped[0].reason));
  ok('evidence · the reading calls it reasonable', /reasonable/.test(reading(l)));
}

// thresholds, at the boundary
{
  const mk = (okCount, total) => makeLedger([
    ...Array.from({ length: total }, (_, i) => run({ taskType: 'x', seconds: 5, ok: i < okCount })),
    remote({ taskType: 'x', tokensIn: 1000, tokensOut: 100 }),
  ], TARIFF);
  ok('boundary · a rate exactly ON the bar is avoidable', classify(mk(4, 5), { successBar: 0.8 }).escaped[0].verdict === AVOIDABLE);
  ok('boundary · just under the bar is necessary', classify(mk(3, 5), { successBar: 0.8 }).escaped[0].verdict === NECESSARY);
  ok('boundary · exactly the minimum number of local runs is enough',
    classify(mk(3, 3), { minLocalRuns: 3 }).escaped[0].verdict === AVOIDABLE);
  ok('boundary · one run short is UNPROVEN, not a verdict',
    classify(mk(2, 2), { minLocalRuns: 3 }).escaped[0].verdict === UNPROVEN);
  ok('boundary · and the reason says how many were needed',
    /3 are needed/.test(classify(mk(2, 2), { minLocalRuns: 3 }).escaped[0].reason));
  ok('boundary · thresholds are reported with the result', classify(mk(4, 5)).thresholds.successBar === DEFAULTS.successBar);
}

// evidence table
{
  const l = makeLedger([run({ taskType: 'a' }), run({ taskType: 'a', ok: false }), remote({ taskType: 'b' })], TARIFF);
  const ev = localEvidence(l);
  ok('evidence · one row per task type', ev.length === 2);
  ok('evidence · reports the local success rate', near(ev.find(e => e.taskType === 'a').rate, 0.5));
  ok('evidence · a type never run locally has a null rate', ev.find(e => e.taskType === 'b').rate === null);
  ok('evidence · reports the mean local duration', ev.find(e => e.taskType === 'a').meanSeconds === 10);
  ok('evidence · a type never run locally has no mean cost', ev.find(e => e.taskType === 'b').meanCost === null);
  ok('evidence · every verdict is a known class', ev.every(e => CLASSES.includes(e.verdict)));
}

// ── 6 · the reading ─────────────────────────────────────────────────────────────────────────
{
  const allLocal = makeLedger([run(), run()], TARIFF);
  ok('reading · an all-local month says nothing left the machine', /Nothing left the machine/.test(reading(allLocal)));
  ok('reading · and still quotes the electricity', /electricity/.test(reading(allLocal)));
  const mixed = makeLedger([run(), remote()], TARIFF);
  ok('reading · a mixed month quotes both sides', /left the machine/.test(reading(mixed)) && /stayed/.test(reading(mixed)));
}

// ── 7 · boundaries and inputs that must not be silently dropped ─────────────────────────────
// Each of these exists because a mutant survived without it. In a cost model, an input that is
// quietly ignored produces a confident wrong number rather than an error.

// a supplied tariff must actually be USED, not fall back to the default
{
  const pricey = { local: { watts: 1000, pricePerKWh: 1 } };
  ok('tariff · a supplied local tariff is used, not the default',
    costOf(run({ seconds: 3600 }), pricey) === 1);
  ok('tariff · and it differs from the default', costOf(run({ seconds: 3600 }), pricey) !== costOf(run({ seconds: 3600 }), {}));
  ok('tariff · a supplied remote tariff is used',
    costOf(remote({ tokensIn: 1e6, tokensOut: 0 }), { remote: { T4: { inPerM: 7 } } }) === 7);
  ok('assumptions · carry the remote tariffs supplied', assumptions(TARIFF).remote.T4.inPerM === 3);
  ok('assumptions · carry the local tariff supplied', assumptions(TARIFF).local.watts === 250);
  ok('assumptions · fall back to an empty remote map when none is given',
    JSON.stringify(assumptions({}).remote) === '{}');
}

// zero is a legitimate value, not an error
ok('ledger · a zero-second run is valid', violations(run({ seconds: 0 })).length === 0);
ok('ledger · a negative token count is rejected', violations(remote({ tokensIn: -5 })).some(v => v.includes('tokensIn')));
ok('ledger · a non-numeric token count is rejected', violations(remote({ tokensOut: 'lots' })).some(v => v.includes('tokensOut')));
// a remote run with input tokens only must be acceptable — it can be priced
ok('ledger · a remote run with only INPUT tokens is acceptable',
  violations(remote({ tokensIn: 1000, tokensOut: 0 })).length === 0);
ok('ledger · token counts survive into the entry', (() => {
  const e = makeLedger([remote({ tokensIn: 1234, tokensOut: 567 })], TARIFF).entries[0];
  return e.tokensIn === 1234 && e.tokensOut === 567;
})());
ok('ledger · an error message for an id-less run does not say "(undefined)"', (() => {
  try { makeLedger([run({ seconds: -1 })], TARIFF); return false; }
  catch (e) { return !e.message.includes('(undefined)'); }
})());

// per-tier attribution must actually filter by tier
{
  const l = makeLedger([run({ tier: 'T2' }), run({ tier: 'T2' }), run({ tier: 'T0', seconds: 1 }), remote()], TARIFF);
  const s = summary(l);
  ok('summary · counts runs per tier correctly', s.byTier.find(t => t.tier === 'T2').runs === 2);
  ok('summary · and a different tier separately', s.byTier.find(t => t.tier === 'T0').runs === 1);
  ok('summary · the per-tier runs sum to the total', s.byTier.reduce((a, t) => a + t.runs, 0) === s.runs);
  ok('summary · sovereign share by runs is not hard-coded to 1', s.sovereignShareByRuns !== 1);
  ok('summary · an all-local ledger IS 1 by runs', summary(makeLedger([run(), run()], TARIFF)).sovereignShareByRuns === 1);
}

// task types with equal escaped spend must order deterministically
{
  const l = makeLedger([
    remote({ taskType: 'zeta', tokensIn: 1000, tokensOut: 100 }),
    remote({ taskType: 'alpha', tokensIn: 1000, tokensOut: 100 }),
  ], TARIFF);
  const s = summary(l);
  ok('summary · equal-spend task types sort alphabetically', s.byType[0].taskType === 'alpha');
  ok('summary · and the spends really are equal', near(s.byType[0].remoteCost, s.byType[1].remoteCost));

  // cost order must WIN over alphabetical order — named so the two disagree
  const l2 = makeLedger([
    remote({ taskType: 'alpha', tokensIn: 1000, tokensOut: 10 }),
    remote({ taskType: 'zeta', tokensIn: 900000, tokensOut: 90000 }),
  ], TARIFF);
  const s2 = summary(l2);
  ok('summary · ranks by escaped spend, not alphabetically', s2.byType[0].taskType === 'zeta');
  ok('summary · and alphabetical really would have been the other way', s2.byType[1].taskType === 'alpha');
}

// worthTesting must only list types that actually cost something
{
  const l = makeLedger([
    run({ taskType: 'never-escaped', seconds: 5 }),
    remote({ taskType: 'escaped-a', tokensIn: 100000, tokensOut: 1000 }),
  ], TARIFF);
  const c = classify(l);
  ok('worthTesting · lists the type with escaped spend', c.worthTesting.some(w => w.taskType === 'escaped-a'));
  ok('worthTesting · does NOT list a type that never escaped', !c.worthTesting.some(w => w.taskType === 'never-escaped'));
}

// wouldHaveCost is computed only from AVOIDABLE types, never from a partial local record
{
  // local tried twice — below minLocalRuns, so UNPROVEN, but a mean cost exists
  const l = makeLedger([
    run({ taskType: 'x', seconds: 5 }), run({ taskType: 'x', seconds: 5 }),
    remote({ taskType: 'x', tokensIn: 100000, tokensOut: 1000 }),
  ], TARIFF);
  const c = classify(l, { minLocalRuns: 3 });
  ok('fixture · the type is UNPROVEN but has a local mean cost',
    c.escaped[0].verdict === UNPROVEN && c.escaped[0].localMeanCost !== null);
  ok('saving · an UNPROVEN type contributes nothing to wouldHaveCost', c.wouldHaveCost === 0);
  ok('saving · and nothing to the net saving', c.netSaving === 0);
}

// the reading must omit a clause when its amount is zero
{
  const unprovenOnly = makeLedger([
    run({ taskType: 'lint', seconds: 5 }),
    remote({ taskType: 'other', tokensIn: 100000, tokensOut: 1000 }),
  ], TARIFF);
  const r = reading(unprovenOnly);
  ok('reading · omits the avoidable clause when nothing is avoidable', !/demonstrably handled/.test(r));
  ok('reading · omits the necessary clause when nothing was necessary', !/tried and failed/.test(r));
  ok('reading · but does report the unproven amount', /UNPROVEN/.test(r));

  const avoidableOnly = makeLedger([
    ...Array.from({ length: 5 }, () => run({ taskType: 'x', seconds: 5 })),
    remote({ taskType: 'x', tokensIn: 100000, tokensOut: 1000 }),
  ], TARIFF);
  const r2 = reading(avoidableOnly);
  ok('reading · reports the avoidable clause when there is one', /demonstrably handled/.test(r2));
  ok('reading · and omits the unproven clause', !/UNPROVEN/.test(r2));

  // sub-penny amounts must not round to "£0.00", which would read as free
  ok('reading · a sub-penny figure keeps four decimals', /£0\.\d{4}/.test(reading(makeLedger([run({ seconds: 10 }), remote()], TARIFF))));

  // the four-decimal treatment applies ONLY to a sub-penny, non-zero figure
  const freeTariff = { local: { watts: 0, pricePerKWh: 0 } };
  ok('reading · an exactly-zero figure gets two decimals, not four',
    /£0\.00\b/.test(reading(makeLedger([run(), run()], freeTariff))));
  ok('reading · and is not rendered as £0.0000',
    !/£0\.0000/.test(reading(makeLedger([run(), run()], freeTariff))));

  // exactly one penny is not sub-penny: 1000W for 36s at £1/kWh is exactly £0.01
  const pennyTariff = { local: { watts: 1000, pricePerKWh: 1 } };
  ok('fixture · the constructed run costs exactly one penny', localCost(36, pennyTariff.local) === 0.01);
  ok('reading · exactly one penny gets two decimals',
    /£0\.01\b/.test(reading(makeLedger([run({ seconds: 36 })], pennyTariff))));

  // and a large figure must not pick up four decimals
  const big = reading(makeLedger([run(), remote({ tokensIn: 1e6, tokensOut: 1e6 })], TARIFF));
  ok('reading · a large figure keeps two decimals', /£18\.00\b/.test(big));
  ok('reading · and is not rendered with four', !/£18\.0000/.test(big));
}

console.log(`\nkonomi-meter · ${pass}/${pass + fail} passed`);
if (fail) { console.error(`${fail} FAILED`); process.exit(1); }
