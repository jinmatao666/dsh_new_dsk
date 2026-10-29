import unittest
from unittest.mock import patch
from PIL import Image
from semantic_change import discover, box, ask

C = {'change_type':'new','category':'建筑','description':'新增厂房','approximate_region':'右上'}

class Semantic(unittest.TestCase):
    def test_two_stages_deduplicate_same_event(self):
        replies = [{'candidates':[C,C]}, {'objects':[{'bbox_after':[100,100,300,300]}]},
                   {'objects':[{'bbox_after':[100,100,300,300]}]}]
        with patch('semantic_change.ask', side_effect=replies) as model:
            objects, evidence = discover(Image.new('RGB',(100,100)),Image.new('RGB',(100,100)))
        self.assertEqual(len(objects),1)
        self.assertEqual(len(evidence['localizations']),2)
        self.assertEqual(len(model.call_args_list[0].args[0]),2)
        self.assertAlmostEqual(objects[0]['box'][0],100/999)

    def test_invalid_or_unlocated_candidates_fail(self):
        for localization in [{'objects':[]},{'objects':[{'bbox_after':[900,100,200,300]}]},
                             {'objects':[{'bbox_after':[0,0,1000,1000]}]}]:
            with patch('semantic_change.ask',side_effect=[{'candidates':[C]},localization]):
                with self.assertRaises(ValueError):
                    discover(Image.new('RGB',(10,10)),Image.new('RGB',(10,10)))
        for value in [[False,0,100,100],[0,0,float('nan'),100],None]:
            with self.assertRaises(ValueError):box(value)

    def test_disappearance_requires_before_location(self):
        with patch('semantic_change.ask',side_effect=[{'candidates':[{**C,'change_type':'disappeared'}]},
                 {'objects':[{'bbox_after':[100,100,300,300]}]}]):
            with self.assertRaises(ValueError):discover(Image.new('RGB',(10,10)),Image.new('RGB',(10,10)))

    def test_truncated_model_reply_is_not_an_empty_success(self):
        with patch('semantic_change.post_json',return_value={'choices':[{'finish_reason':'length','message':{'content':'{}'}}]}):
            with self.assertRaises(ValueError):ask(['image-before','image-after'],'compare')
