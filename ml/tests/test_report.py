from datetime import date

import pytest

from ml import evaluate, report


@pytest.fixture(scope="module")
def results(frame):
    from ml.tests.conftest import RIDE_CATS, STATUS_CATS

    return evaluate.run(frame, RIDE_CATS, STATUS_CATS, weeks=2, horizons=[30], run_staleness=False,
                        write_report=False, deployed_trained_through=None, model_dir="does-not-exist")


class TestRender:
    def test_includes_headline_and_footer(self, results):
        text = report.render(results)
        assert "## Headline" in text
        assert "lift_recipe_vs_persistence" in text
        assert "## Known issues" in text
        for issue in evaluate.KNOWN_ISSUES:
            assert issue in text

    def test_contaminated_flag_shown_when_set(self, results):
        results.meta["deployed_contaminated"] = True
        assert "CONTAMINATED" in report.render(results)
        results.meta["deployed_contaminated"] = False
        assert "CONTAMINATED" not in report.render(results)

    def test_pipe_table_fallback(self, results):
        text = report._pipe_table(results.headline)
        assert text.splitlines()[0].startswith("| horizon |")


class TestWrite:
    def test_dated_name_and_collision_suffix(self, results, tmp_path):
        first = report.write(results, report_dir=str(tmp_path), label="smoke")
        second = report.write(results, report_dir=str(tmp_path), label="smoke")
        third = report.write(results, report_dir=str(tmp_path), label="smoke")
        stem = f"{date.today():%Y-%m-%d}_smoke"
        assert first.name == f"{stem}.md"
        assert second.name == f"{stem}-2.md"
        assert third.name == f"{stem}-3.md"
        assert first.read_text().startswith("# Forward-holdout evaluation")


def test_pipe_table_keeps_int_columns():
    import pandas as pd

    df = pd.DataFrame({"n": [24236], "mae": [1.5]}, index=pd.Index([30], name="horizon"))
    assert report._pipe_table(df).splitlines()[2] == "| 30 | 24236 | 1.50 |"
