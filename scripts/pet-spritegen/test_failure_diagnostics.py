import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).with_name('renderer.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

class FailureDiagnosticTests(unittest.TestCase):
    def test_timeout_is_labeled_without_command_or_private_output(self):
        error = subprocess.TimeoutExpired(['private prompt', 'secret'], 220, output='private body', stderr='secret')
        with patch.object(renderer.subprocess, 'run', side_effect=error):
            with self.assertRaises(renderer.RenderError) as result:
                renderer.run_tool(Path('/tmp'), ['gen'])
        self.assertEqual(str(result.exception), 'outcome_unknown')
        self.assertEqual(result.exception.failure_diagnostic['reason'], 'process_timeout')
        self.assertNotIn('private', json.dumps(result.exception.failure_diagnostic))

    def test_process_failure_keeps_exit_and_http_status_without_stderr(self):
        reply = subprocess.CompletedProcess([], 1, '', 'openai-gen: image request failed (HTTP 503) code=server_is_overloaded; private response and secret')
        with patch.object(renderer.subprocess, 'run', return_value=reply):
            with self.assertRaises(renderer.RenderError) as result:
                renderer.run_tool(Path('/tmp'), ['gen'])
        self.assertEqual(result.exception.failure_diagnostic['exitCode'], 1)
        self.assertEqual(result.exception.provider_failure['httpStatus'], 503)
        self.assertNotIn('secret', json.dumps(result.exception.failure_diagnostic))

    def test_unexpected_dimensions_retains_only_numeric_shape_and_usage_presence(self):
        def fake_provider(root, args):
            renderer.Image.new('RGB', (1536,512), 'green').save(root/'base.png')
            (root/'base.provider-report.json').write_text(json.dumps({'provider':'openai','model':renderer.MODEL,'extra':{'usage':{'input_tokens_details':{'text_tokens':1,'image_tokens':2},'output_tokens':3}}}))
        with tempfile.TemporaryDirectory() as folder, patch.object(renderer,'run_tool',side_effect=fake_provider):
            with self.assertRaises(renderer.RenderError) as result:
                renderer.generate(Path(folder), {'prompt':'private character'}, 'base')
        diagnostic=result.exception.failure_diagnostic
        self.assertEqual((diagnostic['boundary'],diagnostic['reason'],diagnostic['width'],diagnostic['height'],diagnostic['usageAvailable']),('provider_image','unexpected_dimensions',1536,512,True))
        self.assertNotIn('private character',json.dumps(diagnostic))

    def test_malformed_report_is_identified_without_copying_text(self):
        def fake_provider(root, args):
            (root/'base.provider-report.json').write_text('private malformed response')
        with tempfile.TemporaryDirectory() as folder, patch.object(renderer,'run_tool',side_effect=fake_provider):
            with self.assertRaises(renderer.RenderError) as result:
                renderer.generate(Path(folder), {'prompt':'private character'}, 'base')
        self.assertEqual(result.exception.failure_diagnostic['reason'],'invalid_json')
        self.assertNotIn('private',json.dumps(result.exception.failure_diagnostic))

if __name__=='__main__':unittest.main()
