# Codex task — Kraken bot hardening 08: maker-fee optimization

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/08-maker-fee-optimization.spec.md` — why the current
   0.2% price buffer is paying taker fees and how to fix it
2. `tasks/specs/08-maker-fee-optimization.plan.md`

## Your job

Replace the hardcoded `price * 1.002` (buy) and `price * 0.998` (sell)
buffers with configurable basis-point constants `ENTRY_PRICE_BUFFER_BPS`
and `EXIT_PRICE_BUFFER_BPS`, both defaulting to 10 bps (0.10%). This
tightens the buffer from 20 bps to 10 bps so orders more often rest on
the book as maker fills instead of crossing as takers.

This is the single highest-leverage P&L improvement on the hardening
list. The bot's 7-day P&L is essentially bottlenecked by fees, and
halving the spread buffer should materially reduce effective taker rate.

## Owned paths

- `scripts/cc_brain.py`

## Required outcome

- `ENTRY_PRICE_BUFFER_BPS` and `EXIT_PRICE_BUFFER_BPS` constants added
  near other strategy parameters, both defaulting to `10`
- New helpers `_limit_buy_price(price, pair)` and `_limit_sell_price(price, pair)`
  that apply the buffers and round to the pair's `pair_decimals`
- All four call sites updated to use the helpers:
  - sweep_dust sell (~line 1010)
  - Step 5a rotation (~line 1236)
  - Step 5b entry (~line 1261)
  - Step 5c exit (~line 1278)
- Syntax check passes

## Verification

```bash
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('OK')"
python -c "
from scripts.cc_brain import (
    _limit_buy_price, _limit_sell_price,
    ENTRY_PRICE_BUFFER_BPS, EXIT_PRICE_BUFFER_BPS,
)
assert ENTRY_PRICE_BUFFER_BPS == 10
assert EXIT_PRICE_BUFFER_BPS == 10
# At 100 mid with 10 bps, buy limit should be 100.10, sell 99.90 (pre-rounding)
b = _limit_buy_price(100.0, 'BTC/USD')
s = _limit_sell_price(100.0, 'BTC/USD')
print(f'buy={b} sell={s}')
# BTC/USD has pair_decimals=1, so round to 1 decimal: 100.1 and 99.9
"
```

## Done criteria

Git commit per the plan's commit message template.
