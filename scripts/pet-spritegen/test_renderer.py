import importlib.util
import json
import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).with_name('renderer.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

def base_prompt(brief):
    captured = []
    class StopBeforeProvider(Exception): pass
    def capture(_root, args):
        captured.append(Path(args[args.index('--prompt-file') + 1]).read_text())
        raise StopBeforeProvider()
    with tempfile.TemporaryDirectory() as folder, patch.object(renderer, 'run_tool', side_effect=capture):
        try:
            renderer.generate(Path(folder), {'prompt': brief}, 'base')
        except StopBeforeProvider:
            pass
    return captured[0]

class RendererTests(unittest.TestCase):
    def test_reference_is_sent_to_base_and_changes_do_not_repeat_in_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            reference = root/'reference.png'
            renderer.Image.new('RGBA', (64,64), 'red').save(reference)
            captured = []
            class StopBeforeProvider(Exception): pass
            def capture(_root, args):
                captured.append((args, Path(args[args.index('--prompt-file') + 1]).read_text()))
                raise StopBeforeProvider()
            for prompt in ['', 'Remove glasses and make the sweater red']:
                job = {'prompt': prompt, 'hasReference': True, 'reviewBase': True}
                with patch.object(renderer, 'run_tool', side_effect=capture):
                    with self.assertRaises(StopBeforeProvider): renderer.generate(root, job, 'base')
                args, text = captured[-1]
                self.assertEqual(args[args.index('--ref') + 1], str(reference))
                self.assertIn('Preserve its recognizable silhouette', text)
                self.assertIn(json.dumps(prompt), text)
                row = renderer.row_prompt(job, {'name': 'idle', 'frames': 6, 'action': 'resting'})
                self.assertIn('approved character', row)
                self.assertNotIn('Requested appearance changes', row)
                if prompt: self.assertNotIn(prompt, row)

    def test_missing_reference_never_falls_back_to_text_generation(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(renderer, 'run_tool') as call:
            with self.assertRaises(renderer.RenderError):
                renderer.generate(Path(folder), {'prompt': '', 'hasReference': True}, 'base')
            call.assert_not_called()

    def test_parallel_rows_keep_their_own_prompt_report_and_pixels(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root/'run').mkdir(); (root/'run/sprite-request.json').write_text('{}')
            renderer.Image.new('RGB', (1024,1024), 'green').save(root/'base.png')
            guides = root/'run/references/layout-guides'; guides.mkdir(parents=True)
            names = ('idle','running','running-left','running-right')
            colors = ('red','blue','green','yellow')
            for name in names: renderer.Image.new('RGB',(1536,208),'white').save(guides/(name+'.png'))
            job = {'prompt':'Synthetic character', 'rows':[{'name':name,'frames':6,'action':'RESTING ONLY' if name=='idle' else name} for name in names]}
            started = threading.Barrier(4); written = threading.Barrier(4); observed = {}
            def provider_boundary(_root, args):
                self.assertEqual(args[0], 'gen')
                out = Path(args[args.index('--out')+1]); name = out.stem
                prompt = Path(args[args.index('--prompt-file')+1]); report = Path(args[args.index('--report')+1])
                started.wait(timeout=3)
                observed[name] = {'prompt':prompt.read_text(), 'promptPath':str(prompt), 'reportPath':str(report), 'args':args}
                renderer.Image.new('RGB',(1536,512),colors[names.index(name)]).save(out)
                output = (names.index(name)+1)*100
                temporary = root/(name+'.report.tmp')
                temporary.write_text(json.dumps({'provider':'openai','model':renderer.MODEL,'extra':{'usage':{'input_tokens_details':{'text_tokens':1,'image_tokens':2},'output_tokens':output}}}))
                temporary.replace(report); written.wait(timeout=3)
                return '{}'
            with patch.object(renderer,'run_tool',side_effect=provider_boundary), ThreadPoolExecutor(max_workers=4) as pool:
                futures = {name:pool.submit(renderer.generate,root,job,name) for name in names}
                results = {name:f.result(timeout=5) for name,f in futures.items()}
            self.assertIn('RESTING ONLY',observed['idle']['prompt'])
            self.assertIn('while stationary',observed['running']['prompt'])
            self.assertNotEqual(observed['idle']['promptPath'],observed['running']['promptPath'])
            self.assertNotEqual(observed['idle']['reportPath'],observed['running']['reportPath'])
            self.assertEqual(results['idle']['usage']['outputTokens'],100)
            self.assertEqual(results['running']['usage']['outputTokens'],200)
            self.assertEqual(len({item['promptPath'] for item in observed.values()}), 4)
            self.assertEqual(len({item['reportPath'] for item in observed.values()}), 4)
            for name,color in zip(names, [(255,0,0),(0,0,255),(0,128,0),(255,255,0)]):
                self.assertEqual(results[name]['usage']['outputTokens'], (names.index(name)+1)*100)
                with renderer.Image.open(root/(name+'.png')) as image: self.assertEqual(image.getpixel((0,0)),color)
                args=observed[name]['args'];self.assertEqual(args[args.index('--model')+1],'gpt-image-2.5-sunburst');self.assertEqual(args[args.index('--quality')+1],'high')
                self.assertEqual(args[args.index('--aspect-ratio')+1],'3:1');self.assertEqual(args[args.index('--facing-fix')+1],'none')

    def test_base_keeps_unicode_after_api_json_roundtrip(self):
        brief = 'Добрый Ёжик, café 🦊'
        prompt = json.loads(json.dumps({'prompt': base_prompt(brief)}))['prompt']
        self.assertIn(brief, prompt)
        self.assertNotIn('\\u0414', prompt)
        self.assertEqual(json.loads(prompt.split('Character/style brief only: ', 1)[1]), brief)

    def test_rows_keep_unicode_after_api_json_roundtrip(self):
        brief = 'Разноцветный тролль в комбинезоне'
        for name in ['idle', 'running', 'look-0-157', 'look-180-337']:
            with self.subTest(name=name):
                text = renderer.row_prompt({'prompt': brief}, {'name': name, 'frames': 8, 'action': 'resting'})
                prompt = json.loads(json.dumps({'prompt': text}))['prompt']
                self.assertIn(brief, prompt)
                self.assertNotIn('\\u0420', prompt)

    def test_quotes_controls_and_literal_escape_sequences_remain_data(self):
        for brief in ['A fox named "Lumi"\\friend\nnext line\tpose', 'Ёжик "Луми"\\дом\nновая строка', r'A literal \u0434 is not decoded']:
            with self.subTest(brief=brief):
                base = base_prompt(brief).split('Character/style brief only: ', 1)[1]
                row = renderer.row_prompt({'prompt': brief}, {'name': 'idle', 'frames': 6, 'action': 'resting'})
                encoded = row.split('Character brief (style only): ', 1)[1].split('\nAction:', 1)[0]
                for value in [base, encoded]:
                    self.assertEqual(json.loads(value), brief)
                    self.assertNotIn('\n', value)
                    self.assertNotIn('\t', value)
                if brief.isascii():
                    self.assertEqual(base, json.dumps(brief))
                    self.assertEqual(encoded, json.dumps(brief))

    def test_proxy_is_required_and_has_no_public_or_user_supplied_fallback(self):
        for value in ['', 'https://example.com', 'http://user:pass@172.17.0.1:18089', 'http://172.17.0.1:18089/path']:
            with self.assertRaises(ValueError): renderer.proxy_environment(value)
        result = renderer.proxy_environment('http://172.17.0.1:18089')
        self.assertEqual(result['HTTPS_PROXY'], 'http://172.17.0.1:18089')
        self.assertEqual(result['NO_PROXY'], 'localhost,127.0.0.1')
        self.assertEqual(renderer.proxy_environment('http://172.17.0.1:18090')['HTTPS_PROXY'], 'http://172.17.0.1:18090')

    def test_working_state_means_stationary_processing(self):
        text = renderer.row_prompt({'prompt': 'robot'}, {'name': 'running', 'frames': 6, 'action': 'running'})
        self.assertIn('stationary', text)
        self.assertIn('No walking', text)
        self.assertNotIn('Action: running', text)

    def test_gaze_prompts_cover_all_sixteen_ordered_directions(self):
        first = renderer.row_prompt({'prompt': 'fox'}, {'name': 'look-0-157', 'frames': 8, 'action': ''})
        second = renderer.row_prompt({'prompt': 'fox'}, {'name': 'look-180-337', 'frames': 8, 'action': ''})
        for degree in [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5]: self.assertIn(f'{degree:g} degrees', first)
        for degree in [180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5]: self.assertIn(f'{degree:g} degrees', second)
        self.assertIn('pupils', first)

    def test_provider_error_is_sanitized_and_never_retried(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/'job.json').write_text('{}')
            with patch.object(renderer.subprocess, 'run') as run:
                run.return_value.returncode = 1
                run.return_value.stderr = 'HTTP 503 private prompt secret'; run.return_value.stdout = ''
                with self.assertRaises(renderer.RenderError) as caught: renderer.run_tool(root, ['gen'])
                self.assertEqual(str(caught.exception), 'outcome_unknown')
                self.assertEqual(run.call_count, 1)

    def test_known_rejection_is_distinguished_from_timeout(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(renderer.subprocess, 'run') as run:
                run.return_value.returncode = 1; run.return_value.stderr = 'openai-gen: image request failed (HTTP 429) code=rate_limit_exceeded; no retry or provider fallback: private'; run.return_value.stdout = ''
                with self.assertRaises(renderer.RenderError) as caught: renderer.run_tool(Path(folder), ['gen'])
                self.assertEqual(str(caught.exception), 'provider_rate_limited')

    def test_only_safe_failure_fields_survive_the_pinned_prefix(self):
        samples = [
            ("openai-gen: credential OPENAI_API_KEY rejected (HTTP 403) code=unsupported_country_region_territory; check key: private-prompt sk-secret", {'httpStatus': 403, 'code': 'unsupported_country_region_territory'}),
            ("openai-gen: refused by the provider's content policy (HTTP 400) code=moderation_blocked moderation_stage=input; no retry: private-prompt", {'httpStatus': 400, 'code': 'moderation_blocked', 'moderationStage': 'input'}),
            ('openai-gen: image request failed (HTTP 400) code=private-prompt-secret; no retry: bearer secret', {'httpStatus': 400, 'code': 'unrecognized'}),
            ('openai-gen: image request failed (HTTP 503) code=server_is_overloaded; no retry: private-prompt', {'httpStatus': 503, 'code': 'server_is_overloaded'}),
        ]
        for line, expected in samples:
            self.assertEqual(renderer.provider_failure(line), expected)
            self.assertNotIn('secret', json.dumps(renderer.provider_failure(line)))
        self.assertIsNone(renderer.provider_failure('private text HTTP 400 code=moderation_blocked'))
        self.assertIsNone(renderer.provider_failure('openai-gen: request failed; body says (HTTP 400)'))

    def test_failed_call_preserves_diagnostics_without_retry(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(renderer.subprocess, 'run') as run:
            run.return_value.returncode = 1
            run.return_value.stderr = 'openai-gen: credential OPENAI_API_KEY rejected (HTTP 401) code=invalid_api_key; private response'
            with self.assertRaises(renderer.RenderError) as caught:
                renderer.run_tool(Path(folder), ['gen'])
            self.assertEqual(str(caught.exception), 'provider_rejected')
            self.assertEqual(caught.exception.provider_failure, {'httpStatus': 401, 'code': 'invalid_api_key'})
            self.assertEqual(run.call_count, 1)

    def test_usage_only_output_and_missing_usage_reserve_policy(self):
        result = renderer.safe_usage({'extra': {'usage': {'input_tokens_details': {'text_tokens': 100, 'image_tokens': 10}, 'output_tokens': 1000, 'private': 'secret'}}})
        self.assertAlmostEqual(result['costUsd'], .03058)
        self.assertNotIn('secret', str(result))
        self.assertIsNone(renderer.safe_usage({}))

if __name__ == '__main__': unittest.main()
