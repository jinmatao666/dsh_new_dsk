import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
from ocr import extract, aligned_pair, OCRError

class MaskTests(unittest.TestCase):
    def test_expansion_uses_only_added_pixels_and_duplicate_masks_count_once(self):
        old = np.zeros((100,100),dtype=bool);old[20:60,20:60]=True
        new = old.copy();new[20:60,60:70]=True
        event={'box':[.2,.2,.7,.6],'bbox_before':[.2,.2,.6,.6],
               'bbox_after':[.2,.2,.7,.6],'change_type':'expanded','category':'建筑','description':'厂房扩建'}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';Image.new('RGB',(100,100),'white').save(source)
            with patch('ocr.model_configuration',return_value=True), patch('semantic_change.discover',return_value=([event,event],{})), patch('ocr.sam_segment',side_effect=[
                    [{'mask':old}],[{'mask':new}],[{'mask':old}],[{'mask':new}]]):
                files=extract([source,source],root/'out',{'align':False,'precise':True})
            result=json.loads(files[0].read_text(encoding='utf-8'))
            self.assertEqual(result['count'],1)
            self.assertAlmostEqual(result['changed_area_ratio'],.04)
            self.assertAlmostEqual(result['objects'][0]['area_ratio'],.04)
            self.assertEqual(np.count_nonzero(np.asarray(Image.open(root/'out'/'mask.png'))),400)

    def test_equal_size_without_features_can_use_registered_positions(self):
        details={}
        aligned, valid, matrix=aligned_pair(Image.new('RGB',(100,100),'white'),Image.new('RGB',(100,100),'black'),True,details)
        self.assertEqual(details['method'],'assumed_coregistered')
        self.assertTrue(np.all(aligned==255))
        self.assertTrue(np.all(valid==255))
        with self.assertRaises(OCRError):
            aligned_pair(Image.new('RGB',(100,100),'white'),Image.new('RGB',(200,100),'black'),True)

    def test_empty_event_does_not_discard_other_real_masks(self):
        mask = np.zeros((100,100), dtype=bool); mask[20:40,20:40] = True
        other = np.zeros((100,100), dtype=bool); other[60:80,60:80] = True
        events = [dict(box=[.2,.2,.4,.4], bbox_after=[.2,.2,.4,.4],
                       change_type='new', category='建筑', description=f'新增{i}') for i in range(3)]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'source.png'; Image.new('RGB',(100,100),'white').save(source)
            with patch('ocr.model_configuration',return_value=True), patch('semantic_change.discover',return_value=(events,{})), patch('ocr.sam_segment',side_effect=[
                    [{'mask':mask}], [], [], [{'mask':other}]]):
                files=extract([source,source],root/'out',{'align':False,'precise':True})
            result=json.loads(files[0].read_text(encoding='utf-8'))
            self.assertEqual(result['count'],3)
            self.assertFalse(result['segmentation_complete'])
            self.assertEqual(result['unsegmented_count'],1)
            self.assertAlmostEqual(result['changed_area_ratio'],.08)
            self.assertIsNone(result['objects'][-1]['area_ratio'])
            self.assertEqual(result['objects'][-1]['segmentation_status'],'unavailable')
            evidence=json.loads((root/'out'/'model-evidence.json').read_text(encoding='utf-8'))
            self.assertEqual([x['status'] for x in evidence['segmentation']],['segmented','unavailable','segmented'])
            self.assertEqual(len(evidence['segmentation'][1]['phases'][0]['attempts']),2)

    def test_crop_retry_maps_mask_back_without_changing_confidence(self):
        from ocr import segment_change
        source=Image.new('RGB',(100,80),'white'); valid=np.full((80,100),255,dtype='uint8')
        calls=[]
        def sam(image, **kwargs):
            calls.append((image.size,kwargs))
            if len(calls)==1: return []
            mask=np.zeros((image.height,image.width),dtype=bool)
            mask[8:24,8:28]=True
            return [{'mask':mask}]
        attempts=[]
        with patch('ocr.sam_segment',side_effect=sam):
            mask=segment_change(source,[.2,.25,.4,.45],'建筑',.35,valid,attempts)
        self.assertEqual(calls[1][0],(36,32))
        self.assertEqual(calls[1][1]['prompt'],'building')
        self.assertEqual([call[1]['score'] for call in calls],[.35,.35])
        self.assertEqual(np.count_nonzero(mask),320)
        self.assertTrue(mask[20:36,20:40].all())
        self.assertEqual(attempts[1]['crop_xyxy'],[12,12,48,44])

    def test_all_empty_masks_do_not_publish_fake_area_or_mask(self):
        event=dict(box=[.2,.2,.4,.4],bbox_after=[.2,.2,.4,.4],change_type='new',category='建筑',description='新增')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';Image.new('RGB',(100,100),'white').save(source)
            with patch('ocr.model_configuration',return_value=True),patch('semantic_change.discover',return_value=([event],{})),patch('ocr.sam_segment',return_value=[]):
                files=extract([source,source],root/'out',{'align':False,'precise':True})
            result=json.loads(files[0].read_text(encoding='utf-8'))
            self.assertEqual(result['count'],1)
            self.assertIsNone(result['changed_area_ratio'])
            self.assertFalse((root/'out'/'mask.png').exists())
            self.assertIn('仅定位',result['warning'])

    def test_protocol_error_is_not_treated_as_empty_mask(self):
        from ocr import segment_change
        with patch('ocr.sam_segment',side_effect=OCRError('bad response')):
            with self.assertRaisesRegex(OCRError,'bad response'):
                segment_change(Image.new('RGB',(100,100)),[.2,.2,.4,.4],'建筑',.35,np.ones((100,100)),[])

    def test_missing_temporal_mask_is_not_interpreted_as_absent_object(self):
        old=np.zeros((100,100),dtype=bool);old[20:40,20:40]=True
        event=dict(box=[.2,.2,.6,.6],bbox_before=[.2,.2,.4,.4],bbox_after=[.2,.2,.6,.6],
                   change_type='expanded',category='建筑',description='扩建')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';Image.new('RGB',(100,100),'white').save(source)
            with patch('ocr.model_configuration',return_value=True),patch('semantic_change.discover',return_value=([event],{})),patch('ocr.sam_segment',side_effect=[[{'mask':old}],[],[]]):
                files=extract([source,source],root/'out',{'align':False,'precise':True})
            result=json.loads(files[0].read_text(encoding='utf-8'))
            self.assertIsNone(result['changed_area_ratio'])
            self.assertIsNone(result['objects'][0]['area_ratio'])
            self.assertFalse(result['segmentation_complete'])
