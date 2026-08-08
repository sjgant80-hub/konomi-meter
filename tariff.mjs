// tariff.mjs — what a run costs, including the local ones.
//
// THE ASSUMPTION THAT MAKES EVERY LOCAL-VS-CLOUD ANALYSIS USELESS
//
// Local inference is priced at zero. Every dashboard, every write-up, every "we moved it on-prem and
// saved 100%" does it. And the moment one side of a comparison is zero, the comparison stops being a
// decision: "should this have run locally" has the answer "yes, always", which is not information.
//
// A local run costs electricity. On a machine drawing 250W for forty seconds at 27p/kWh that is about
// 0.075p — genuinely small, and NOT zero, and the difference matters because it is what lets you say
// "this task type costs 0.08p locally and 4p on the frontier, so the frontier is 50x" instead of the
// useless "the frontier costs money and local doesn't".
//
// WHAT THIS DELIBERATELY DOES NOT COUNT, stated because a cost model's exclusions are the model:
//   · the hardware purchase, unless you supply an amortisation rate — most people have the machine
//     already and the marginal cost of one more run really is just the power
//   · your time waiting for a slow local model, which is often the real cost and is not money
//   · idle draw, cooling, and the rest of the building
//
// So this is a MARGINAL ENERGY cost, it is named as one, and every result carries its assumptions.
//
// Pure and deterministic: no I/O, no clock, no randomness.

export const VERSION = '0.1.0';
export const SPEC_VERSION = 'konomi-meter-v1';

// The cascade, and the only thing about it that matters here: does the work leave the machine.
export const TIERS = Object.freeze([
  { id: 'T0', name: 'built-in', local: true, note: 'deterministic heuristics; no model at all' },
  { id: 'T1', name: 'browser model', local: true, note: 'WebLLM in the page' },
  { id: 'T2', name: 'local small', local: true, note: 'Ollama, a small model' },
  { id: 'T2.5', name: 'local large', local: true, note: 'Ollama, a larger model' },
  { id: 'T3', name: 'remote free', local: false, note: 'a free API tier — free in money, not in data' },
  { id: 'T4', name: 'frontier', local: false, note: 'a paid frontier API' },
]);
export const TIER_IDS = Object.freeze(TIERS.map(t => t.id));
export const tierOf = id => TIERS.find(t => t.id === id) || null;
export const isLocal = id => { const t = tierOf(id); return t ? t.local : null; };

// Defaults are a starting point, not a claim about your machine. A desktop under load draws a very
// different figure from a laptop, and the UK domestic unit price moves.
export const DEFAULT_LOCAL = Object.freeze({ watts: 250, pricePerKWh: 0.27, amortisePerHour: 0 });
export const DEFAULT_REMOTE = Object.freeze({ inPerM: 0, outPerM: 0 });

/**
 * Marginal energy cost of a local run.
 * kWh = watts × seconds / 3600 / 1000, then times the unit price. Amortisation, if you supply it, is
 * charged per hour of runtime and is the only way hardware enters the figure.
 */
export function localCost(seconds, { watts = DEFAULT_LOCAL.watts, pricePerKWh = DEFAULT_LOCAL.pricePerKWh, amortisePerHour = 0 } = {}) {
  const s = Math.max(0, Number(seconds) || 0);
  const kWh = (Math.max(0, watts) * s) / 3600 / 1000;
  return kWh * Math.max(0, pricePerKWh) + (s / 3600) * Math.max(0, amortisePerHour);
}

/** Cost of a remote call, priced separately on input and output because they are priced separately. */
export function remoteCost(tokensIn, tokensOut, { inPerM = 0, outPerM = 0 } = {}) {
  const i = Math.max(0, Number(tokensIn) || 0), o = Math.max(0, Number(tokensOut) || 0);
  return (i / 1e6) * Math.max(0, inPerM) + (o / 1e6) * Math.max(0, outPerM);
}

/**
 * Cost of one run, dispatched on whether its tier leaves the machine.
 * An unknown tier throws rather than defaulting to free — silently pricing an unrecognised tier at
 * zero is how spend disappears from a report.
 */
export function costOf(run, tariffs = {}) {
  const t = tierOf(run.tier);
  if (!t) throw new Error(`unknown tier: ${run.tier} — recognised tiers are ${TIER_IDS.join(', ')}`);
  return t.local
    ? localCost(run.seconds, tariffs.local || DEFAULT_LOCAL)
    : remoteCost(run.tokensIn, run.tokensOut, (tariffs.remote && tariffs.remote[run.tier]) || DEFAULT_REMOTE);
}

/** The assumptions behind a figure, carried alongside it so they travel with the number. */
export function assumptions(tariffs = {}) {
  const l = { ...DEFAULT_LOCAL, ...(tariffs.local || {}) };
  return {
    local: l,
    remote: tariffs.remote || {},
    counts: 'marginal electricity for local runs; input and output tokens for remote calls',
    excludes: [
      l.amortisePerHour > 0 ? null : 'hardware purchase (no amortisation rate supplied)',
      'your time waiting for a slow local run',
      'idle draw, cooling, and the rest of the building',
    ].filter(Boolean),
  };
}

export default {
  VERSION, SPEC_VERSION, TIERS, TIER_IDS, tierOf, isLocal,
  DEFAULT_LOCAL, DEFAULT_REMOTE, localCost, remoteCost, costOf, assumptions,
};
