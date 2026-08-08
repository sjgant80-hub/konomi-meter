# konomi-meter

### ▶ **Live: https://sjgant80-hub.github.io/konomi-meter/**

What did your AI actually cost — and what needed to leave the machine?

[![witness](https://github.com/sjgant80-hub/konomi-meter/actions/workflows/witness.yml/badge.svg)](https://github.com/sjgant80-hub/konomi-meter/actions/workflows/witness.yml)

## 1 · Local inference is not free, and pricing it at zero breaks the analysis

Every write-up, every dashboard, every *"we moved it on-prem and saved 100%"* prices local at zero. And
the moment one side of a comparison is zero, the comparison stops being a decision: *"should this have
run locally"* has the answer *"yes, always"*, which is not information.

A local run costs electricity. 250W for forty seconds at 27p/kWh is about **0.075p** — genuinely
small, and **not zero**. That difference is what lets you say *"this task type is 50× cheaper locally"*
instead of the useless *"one costs money and one doesn't"*.

**What the model deliberately excludes** — because a cost model's exclusions *are* the model, and they
travel with every figure:

- the hardware purchase, unless you supply an amortisation rate (most people already own the machine,
  and the marginal cost of one more run really is just the power)
- your time waiting for a slow local run, which is often the real cost and is not money
- idle draw, cooling, and the rest of the building

This is a **marginal energy** cost and it is named as one.

## 2 · Sovereign share, measured twice

A thousand cheap local calls and one expensive frontier call is 99.9% local *by call count* and under
5% *by money*. From the live page, one illustrative month:

```
runs 542   total £15.35   electricity £0.04   left the machine £15.31
local by runs   91%
local by money   0%
```

Both are reported. The first is the one people quote; the second is the one on the bill.

## 3 · "Should have run locally" is a claim about capability, not price

This is the refusal the repo is built around.

Every remote call would have been cheaper locally — trivially, always. The real question is whether
the local tier could have **done** it, and the honest answer is usually that nobody knows, because
nobody tried.

| Verdict | Meaning |
|---|---|
| `AVOIDABLE` | Local has a recorded success rate on this task type at or above the bar. **The only figure that may be called a saving.** |
| `NECESSARY` | Local was tried and fell below the bar. Escaping was reasonable. |
| `UNPROVEN` | Local was never tried, or not enough times for the rate to mean anything. **No claim either way**, reported separately. |

```
51 of 542 runs left the machine, costing £15.31 against £0.04 of electricity for the
491 that stayed. £0.73 of that went on task types the local tier has demonstrably
handled — running them locally would have cost about £0.0019, a net £0.73. A further
£12.60 is UNPROVEN: local has never been tried on those task types, so it is not
counted as a saving — start with bulk-classify. £1.98 was on types local has tried and
failed, so it was reasonable.
```

A tool that folded that £12.60 into the saving would produce exactly the number its owner wants and
none of the information they need. Instead it is named, sized, and turned into a next action: the
fastest way to shrink your `UNPROVEN` column is to run those task types locally once and find out.

The counterfactual — *"running them locally would have cost about £0.0019"* — is computed only from
**measured** local runs on that exact task type, never from a guess.

## Attribution is by task type

"You spent £41 on the frontier" prompts no decision. "Four bulk-classification jobs cost £38 of it,
and that job type runs locally in nine seconds" prompts exactly one. The task type is the unit a person
can move; an individual call that already happened is not.

## Usage

```js
import { makeLedger, summary } from './ledger.mjs';
import { classify, reading } from './escape.mjs';

const ledger = makeLedger(runs, {
  local:  { watts: 250, pricePerKWh: 0.27 },
  remote: { T4: { inPerM: 3, outPerM: 15 } },
});
// a run: { taskType, tier, seconds, tokensIn, tokensOut, ok }

summary(ledger)        // by tier, by task type, sovereign share both ways
classify(ledger)       // AVOIDABLE / NECESSARY / UNPROVEN, per escaped run
reading(ledger)        // one paragraph you can act on
```

Tiers follow the cascade — `T0` built-in, `T1` browser model, `T2` local small, `T2.5` local large,
`T3` remote free, `T4` frontier. Note that `T3` is **remote**: free in money is not free in data.

## Verification

```bash
node test.mjs        # 132 assertions
```

| kernel | killed | reviewed-equivalent | verdict |
|---|---|---|---|
| `tariff.mjs` | 11 / 11 | 0 | **clean outright** |
| `ledger.mjs` | 30 / 30 | 0 | **clean outright** |
| `escape.mjs` | 26 / 26 | 0 | **clean outright** |

**67/67 mutants killed, zero baselines.** The cost arithmetic is checked against hand-computed values —
one hour at 250W and 40p/kWh is exactly 10p; a million tokens each way at £3 and £15 is exactly £18 —
because a cost model nobody verified is a spreadsheet with opinions in it.

## Two things that are refused rather than guessed

- **A remote run with no token counts is rejected.** It would price at zero, and that is how spend
  disappears from a report.
- **An unrecognised tier throws** rather than defaulting to free.

## Honest limits

- Success is a boolean you supply. If your definition of "local handled it" is generous, so is every
  figure downstream.
- This measures what you recorded. Work that never got logged is invisible, and nothing here can tell
  you it is missing.
- The default 250W / 27p is a starting point, not a claim about your machine.

## The suite

[konomi-rubric](https://sjgant80-hub.github.io/konomi-rubric/) ·
[konomi-redteam](https://sjgant80-hub.github.io/konomi-redteam/) ·
[konomi-regress](https://sjgant80-hub.github.io/konomi-regress/) ·
[konomi-clean](https://sjgant80-hub.github.io/konomi-clean/) ·
[konomi-judge](https://sjgant80-hub.github.io/konomi-judge/) ·
[konomi-export](https://sjgant80-hub.github.io/konomi-export/) ·
[konomi-canary](https://sjgant80-hub.github.io/konomi-canary/) ·
[konomi-ablate](https://sjgant80-hub.github.io/konomi-ablate/) ·
**konomi-meter** (what it cost, and what needed to leave)

Gated by [witness](https://github.com/sjgant80-hub/witness). MIT.
