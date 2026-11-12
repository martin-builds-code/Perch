# What HexDB `updated_at` establishes

Checked 11 November 2026 using [HexDB's published API documentation](https://hexdb.io/) and its linked [hexdb-radar client repository](https://github.com/joshuadouch/hexdb-radar).

The recommended route endpoint is `GET /api/v2/routes/{callsign}`. Its example includes an ISO `updated_at` value. The documentation does **not define it as a flight date, last flown time, last observation or database-row update**. The example's `2014-04-20T11:02:19Z` equals the older API example's Unix `updatetime` value `1397991739`; this establishes format correspondence, not event semantics. The radar client uses route lookups but does not document the provider's database schema.

Our cases have repeated identical timestamps across unrelated callsigns: four at `2025-05-18T18:30:22Z`, three at `2026-02-18T19:54:09Z`, and groups in October 2026. A batch refresh/import is a reasonable hypothesis, not an established explanation. The website's general database-update date is separate from individual associations.

**Conclusion:** the field's exact event meaning remains unknown. Age is elapsed time since that supplied timestamp, not proven time since a route was flown. This uncertainty alone does not validate an old association. The operational 180-day rule remains unchanged pending an explicit policy decision.

The [completed owner review](HUMAN-VERIFICATION.md) subsequently corroborated all seven historical route pairs, including four aged about 542 days. That establishes that those old associations were useful for those observed flights; it does not identify what event the timestamp records or prove that all old associations remain correct.
