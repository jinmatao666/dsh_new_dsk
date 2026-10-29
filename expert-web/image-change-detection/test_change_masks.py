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
