"""Offline continuation contracts; no private fixtures or provider calls."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw
import renderer
from extraction_diagnostics import extraction_issues

class ContinuationTests(unittest.TestCase):
    def test_diagnostics_keep_only_state_frame_and_bounded_counts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'extract-failure.json').write_text(json.dumps({'errors': [
                'running-right: frame 02 is empty or too sparse (10 pixels < 200, secret ignored)',
                'look-180-337: could not extract 8 sprite components',
                '/private/path: frame 02 has 42 chroma-adjacent pixels',
                'idle: frame 99 has 42 chroma-adjacent pixels'], 'warnings': []}))
            self.assertEqual(extraction_issues(root), [
                {'state':'running-right','frame':2,'kind':'sparse','actual':10,'expected':200},
                {'state':'look-180-337','kind':'components','expected':8}])
            (root/'extract-failure.json').write_text('[]')
            self.assertEqual(extraction_issues(root), [])

    def test_generation_plan_rejects_base_and_reused_rows_before_any_tool_call(self):
        job={'continuation':{'generationStages':['waving']}}
        with patch.object(renderer,'run_tool') as tool:
            for name in ['base','idle','look-0-157']:
                with self.assertRaises(renderer.RenderError): renderer.generate(Path('/unused'),job,name)
            tool.assert_not_called()

    def test_replaces_selected_gaze_and_animation_rows_only(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            source=Image.new('RGBA',(1536,2288),(10,70,120,127));source.save(root/'revision-source.webp',lossless=True,exact=True)
            Image.new('RGBA',(32,32),'orange').save(root/'base.png')
            rows=[{'name':'idle','frames':6,'row':0,'action':''},{'name':'look-180-337','frames':8,'row':10,'action':''}]
            for row in rows:
                image=Image.new('RGBA',(1536,512),'#ff00ff');draw=ImageDraw.Draw(image)
                for col in range(row['frames']):
                    x=round((col+.5)*1536/row['frames']);draw.ellipse((x-40,180,x+40,330),fill='orange')
                image.save(root/(row['name']+'.png'))
            job={'prompt':'','reviewBase':True,'rows':rows,'continuation':{'mode':'regenerate','generationStages':['look-180-337'],'compositionStages':[r['name'] for r in rows],'atlas':{'kind':'continuation-source.webp'}}}
            real=renderer.run_tool;calls=[]
            def offline(work,args):
                self.assertNotEqual(args[0],'gen');calls.append(args[0]);return real(work,args)
            with patch.object(renderer,'run_tool',side_effect=offline):self.assertEqual(renderer.compose(root,job),{'ok':True})
            self.assertEqual(calls,['prepare','extract'])
            with Image.open(root/'run/sprite-sheet-alpha.png') as result:
                for row in range(11):
                    box=(0,row*208,1536,(row+1)*208)
                    if row in [0,10]:self.assertEqual(result.getpixel((0,row*208)),(0,0,0,0))
                    else:self.assertEqual(result.crop(box).tobytes(),source.crop(box).tobytes())

    def test_finished_atlas_rebuild_requires_no_image_or_extract_call(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=Image.new('RGBA',(1536,2288),(1,2,3,127));source.save(root/'revision-source.webp',lossless=True,exact=True)
            job={'rows':[],'continuation':{'generationStages':[],'compositionStages':[],'atlas':{'kind':'source.png'}}}
            with patch.object(renderer,'run_tool') as tool:
                self.assertEqual(renderer.compose(root,job),{'ok':True});tool.assert_not_called()
            with Image.open(root/'run/sprite-sheet-alpha.png') as result:self.assertEqual(result.tobytes(),source.tobytes())

    def test_touching_poses_produce_actionable_sparse_frame_diagnostic(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);Image.new('RGBA',(32,32),'orange').save(root/'base.png')
            image=Image.new('RGB',(1536,512),'#ff00ff');draw=ImageDraw.Draw(image)
            for i in range(8):draw.rectangle((i*190+40,140,i*190+140,360),fill='orange')
            draw.rectangle((130,230,240,260),fill='orange')
            draw.rectangle((480,60,481,64),fill='orange')
            image.save(root/'running-right.png')
            job={'prompt':'','reviewBase':True,'rows':[{'name':'running-right','frames':8,'row':1,'action':''}]}
            with self.assertRaises(renderer.RenderError):renderer.compose(root,job)
            self.assertTrue(any(issue['kind']=='sparse' and issue['state']=='running-right' for issue in extraction_issues(root/'run')))

    def test_successful_extract_with_small_cloud_still_rejects_and_explains_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);Image.new('RGBA',(32,32),'orange').save(root/'base.png')
            image=Image.new('RGB',(1536,512),'#ff00ff');draw=ImageDraw.Draw(image)
            for i in range(8):draw.rectangle((i*190+40,140,i*190+140,360),fill='orange')
            draw.rectangle((130,230,240,240),fill='orange')
            draw.rectangle((210,60,249,99),fill='orange')
            image.save(root/'failed.png');before=(root/'failed.png').read_bytes()
            job={'prompt':'','reviewBase':True,'rows':[{'name':'failed','frames':8,'row':5,'action':''}]}
            with self.assertRaises(renderer.RenderError) as result:renderer.compose(root,job)
            error=result.exception
            self.assertEqual(error.failure_diagnostic,{'boundary':'renderer_process','reason':'invalid_image'})
            self.assertTrue(any(i['kind']=='invalid' and i['state']=='failed' and i['frame']==1 and i['actual']<i['expected'] for i in error.assembly_issues))
            self.assertTrue(json.loads((root/'run/frames/frames-manifest.json').read_text())['ok'])
            self.assertFalse((root/'run/extract-failure.json').exists())
            self.assertEqual((root/'failed.png').read_bytes(),before)

    def test_current_extract_failure_does_not_inherit_old_manifest_issues(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);run=root/'run';run.mkdir()
            (run/'sprite-request.json').write_text('{}');(run/'frames').mkdir()
            (run/'frames/frames-manifest.json').write_text(json.dumps({'warnings':['failed: frame 01 is much smaller than median (389 vs 9003)']}))
            (root/'idle.png').write_bytes(b'not-decoded-by-stub')
            def failed_extract(work,args):
                (run/'extract-failure.json').write_text(json.dumps({'errors':['idle: frame 02 is empty or too sparse (10 pixels < 200, test)']}))
                raise renderer.RenderError('invalid_sprite_extraction',failure_diagnostic={'boundary':'renderer_process','reason':'process_exit','exitCode':1})
            with patch.object(renderer,'prepare'),patch.object(renderer,'run_tool',side_effect=failed_extract),patch('sprite_gen.spec.layout.raw_rel',return_value='raw/idle.png'),patch('extraction_fallback.recover_failed_strips',return_value=False):
                with self.assertRaises(renderer.RenderError) as result:
                    renderer.compose(root,{'rows':[{'name':'idle','frames':6,'row':0,'action':''}]})
            self.assertEqual(result.exception.assembly_issues,[{'state':'idle','frame':2,'kind':'sparse','actual':10,'expected':200}])

    def test_main_serializes_only_current_structured_issue(self):
        import contextlib
        import io
        import sys
        issue={'state':'failed','frame':1,'kind':'invalid','actual':389,'expected':9003}
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'job.json').write_text('{}');out=io.StringIO()
            error=renderer.RenderError('invalid_sprite_extraction',failure_diagnostic={'boundary':'renderer_process','reason':'invalid_image'},assembly_issues=[issue])
            with patch.object(sys,'argv',['renderer.py',str(root),'compose']),patch.object(renderer,'compose',side_effect=error),contextlib.redirect_stdout(out):
                with self.assertRaises(SystemExit):renderer.main()
            response=json.loads(out.getvalue())
            self.assertEqual(response['assemblyIssues'],[issue])
            self.assertNotIn(str(root),out.getvalue())

if __name__=='__main__':unittest.main()
