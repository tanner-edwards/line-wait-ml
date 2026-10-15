import json
from datetime import date, datetime

import pandas as pd

from ml import evaluate
from ml.manifest import read_manifest, write_manifest


class TestWriteManifest:
    def test_writes_expected_keys(self, tmp_path):
        out = write_manifest(date(2026, 10, 4), path=tmp_path / "models" / "manifest.json")
        data = json.loads(out.read_text())
        assert set(data) == {"trained_through", "exported_at", "git_sha", "recipe"}
        assert data["trained_through"] == "2026-10-04"
        assert data["recipe"] == "A"
        datetime.fromisoformat(data["exported_at"])  # parses

    def test_accepts_timestamp(self, tmp_path):
        out = write_manifest(pd.Timestamp("2026-10-04"), recipe="B", path=tmp_path / "manifest.json")
        data = json.loads(out.read_text())
        assert data["trained_through"] == "2026-10-04"
        assert data["recipe"] == "B"


class TestReadManifest:
    def test_round_trip(self, tmp_path):
        path = write_manifest(date(2026, 10, 4), path=tmp_path / "manifest.json")
        assert read_manifest(path)["trained_through"] == "2026-10-04"

    def test_missing_file_is_none(self, tmp_path):
        assert read_manifest(tmp_path / "nope.json") is None

    def test_bad_json_is_none(self, tmp_path):
        (tmp_path / "manifest.json").write_text("{not json")
        assert read_manifest(tmp_path / "manifest.json") is None


class TestEvaluateUsesManifest:
    def _run(self, frame, model_dir, **kw):
        from ml.tests.conftest import RIDE_CATS, STATUS_CATS

        return evaluate.run(frame, RIDE_CATS, STATUS_CATS, weeks=2, horizons=[30],
                            run_staleness=False, write_report=False, model_dir=str(model_dir), **kw)

    def test_manifest_date_used_when_not_passed(self, frame, tmp_path):
        write_manifest(date(2026, 8, 10), path=tmp_path / "manifest.json")
        res = self._run(frame, tmp_path)
        assert res.meta["deployed_trained_through"] == date(2026, 8, 10)
        assert res.meta["deployed_contaminated"] is False

    def test_explicit_date_wins_over_manifest(self, frame, tmp_path):
        write_manifest(date(2026, 8, 10), path=tmp_path / "manifest.json")
        res = self._run(frame, tmp_path, deployed_trained_through=date(2026, 9, 30))
        assert res.meta["deployed_trained_through"] == date(2026, 9, 30)
        assert res.meta["deployed_contaminated"] is True

    def test_no_manifest_stays_unknown(self, frame, tmp_path):
        res = self._run(frame, tmp_path)
        assert res.meta["deployed_trained_through"] is None
        assert res.meta["deployed_contaminated"] is True

    def test_git_ref_ignores_working_tree_manifest(self, frame, tmp_path):
        # Unresolvable ref: deployed.* returns None for missing git objects.
        write_manifest(date(2026, 8, 10), path=tmp_path / "manifest.json")
        res = self._run(frame, tmp_path, deployed_git_ref="no-such-ref-xyz")
        assert res.meta["deployed_trained_through"] is None
        assert res.meta["deployed_contaminated"] is True
