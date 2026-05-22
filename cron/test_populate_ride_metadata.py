"""Unit tests for populate_ride_metadata.build_records.

The Firestore-write side is exercised manually against prod; here we only test
the pure transform from ride_metadata.json shape to Firestore-doc shape.
"""
from __future__ import annotations

from populate_ride_metadata import build_records


def _meta(**overrides):
    """Build a single ride_metadata entry with the fields the script reads."""
    base = {
        "name": "Test Ride",
        "park": "Disneyland",
        "land": "Tomorrowland",
        "lat": 33.81,
        "lng": -117.92,
        "themeparks_id": "uuid-1234",
        "tracks_wait_time": True,
    }
    base.update(overrides)
    return base


class TestBuildRecords:
    def test_emits_one_doc_per_entry_with_themeparks_id(self):
        records = build_records({
            "dl_test_ride": _meta(),
        })
        assert len(records) == 1
        rec = records[0]
        assert rec["rideId"] == "uuid-1234"
        assert rec["parkId"] == "7340550b-c14d-4def-80bb-acdb51d49a66"
        assert rec["name"] == "Test Ride"
        assert rec["lat"] == 33.81
        assert rec["lng"] == -117.92
        assert rec["source"] == "manual"

    def test_skips_entries_with_null_themeparks_id(self):
        records = build_records({
            "dl_show_only": _meta(themeparks_id=None),
        })
        assert records == []

    def test_dca_slug_maps_to_dca_park_uuid(self):
        records = build_records({
            "dca_test": _meta(park="Disney California Adventure", themeparks_id="dca-uuid"),
        })
        assert len(records) == 1
        assert records[0]["parkId"] == "832fcd51-ea19-4e77-85c7-75d5843b127c"

    def test_skips_unknown_slug_prefix(self):
        records = build_records({
            "mk_magic_kingdom_ride": _meta(themeparks_id="some-uuid"),
        })
        assert records == []

    def test_handles_multiple_entries(self):
        records = build_records({
            "dl_a": _meta(themeparks_id="uuid-a"),
            "dl_b": _meta(themeparks_id=None),  # skipped
            "dca_c": _meta(themeparks_id="uuid-c"),
        })
        assert len(records) == 2
        ride_ids = {r["rideId"] for r in records}
        assert ride_ids == {"uuid-a", "uuid-c"}

    def test_preserves_null_lat_lng(self):
        records = build_records({
            "dl_test": _meta(lat=None, lng=None),
        })
        assert records[0]["lat"] is None
        assert records[0]["lng"] is None
