"""Bounded, current-attempt extraction diagnostics. No provider calls."""
import json
import tempfile
import unittest
from pathlib import Path
import extraction_diagnostics as diagnostics

WARNING = 'failed: frame 01 is much smaller than median (389 vs 9003)'
ISSUE = {'state': 'failed', 'frame': 1, 'kind': 'invalid', 'actual': 389, 'expected': 9003}


class ExtractionDiagnosticsTests(unittest.TestCase):
    def test_successful_manifest_size_warning_is_actionable(self):
        report = {'ok': True, 'errors': [], 'warnings': [WARNING]}
        self.assertEqual(diagnostics.issues_from_report(report), [ISSUE])

    def test_failure_report_recognizes_both_relative_size_warnings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'extract-failure.json').write_text(json.dumps({'errors': [], 'warnings': [
                WARNING, 'idle: frame 00 is much larger than median (27000 vs 9003)']}))
            self.assertEqual(diagnostics.extraction_issues(root), [ISSUE,
                {'state': 'idle', 'frame': 0, 'kind': 'invalid', 'actual': 27000, 'expected': 9003}])

    def test_explicit_current_report_does_not_read_an_older_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'frames').mkdir()
            (root / 'frames/frames-manifest.json').write_text(json.dumps({'warnings': [WARNING]}))
            (root / 'extract-failure.json').write_text(json.dumps({'errors': [
                'running: could not extract 6 sprite components']}))
            self.assertEqual(diagnostics.extraction_issues(root), [
                {'state': 'running', 'kind': 'components', 'expected': 6}])
            self.assertEqual(diagnostics.issues_from_report({'ok': True, 'warnings': []}), [])

    def test_untrusted_reports_are_bounded_and_never_become_private_messages(self):
        for value in [None, [], 'private', {'warnings': [WARNING + ' private']},
                      {'warnings': ['secret: frame 01 is much smaller than median (389 vs 9003)',
                                    'failed: frame 08 is much smaller than median (389 vs 9003)',
                                    'failed: frame 01 is much smaller than median (389 vs 25000001)']},
                      {'warnings': [WARNING], 'extra': 'x' * 131072}]:
            with self.subTest(value_type=type(value).__name__):
                self.assertEqual(diagnostics.issues_from_report(value), [])

    def test_deduplicates_issues_and_preserves_existing_formats(self):
        self.assertEqual(diagnostics.issues_from_report({'errors': [
            'running: frame 02 is empty or too sparse (10 pixels < 200, ignored)',
            'waving: could not extract 4 sprite components',
            'idle: frame 00 has 3 non-transparent edge pixels',
            'review: frame 02 has 4 chroma-adjacent pixels'], 'warnings': [WARNING, WARNING]}), [
            {'state': 'running', 'frame': 2, 'kind': 'sparse', 'actual': 10, 'expected': 200},
            {'state': 'waving', 'kind': 'components', 'expected': 4},
            {'state': 'idle', 'frame': 0, 'kind': 'edge', 'actual': 3},
            {'state': 'review', 'frame': 2, 'kind': 'chroma', 'actual': 4}, ISSUE])


if __name__ == '__main__':
    unittest.main()
