# Bounded R05 live evidence

The single60-minute observation used ordinary real adsb.fi/HexDB responses on immutable trial commit432d7d0. Aircraft and flight references are pseudonyms. The final source/deployment and all measurements are documented in [the report](../IMPLEMENTATION.md).

The three `live-*.png` screenshots are real trial captures. The trial diagnostic screenshot retains an obsolete “temporarily unsecured” caption: normal PIN was never removed, and the automated browser used an independent private expiring credential. The final diagnostic captions were corrected; [new mocked screenshots](../browser/) show that presentation. Normal aircraft presentation did not change.

`analysis.json` is measured evidence. `conditional-replay.json` reuses captured responses at different times through both planners and must not be reported as a second live trial. `budget-*.json` are aggregate reads of the real shared store. `auth-cleanup.json` proves both immutable test credentials expired. No observation process remains.
