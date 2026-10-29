"""Chinese deliverable names and bounded ZIP creation for one owned task."""
import io
import re
import zipfile

NAMES = {'result.json': '分析结果.json', 'annotated.png': '标注图.png',
         'aligned-before.png': '配准前期图.png', 'model-evidence.json': '模型分析依据.json',
         'objects.csv': '变化明细.csv', 'source.png': '原始图.png',
         'comparison.png': '前后对比图.png', 'difference-heatmap.png': '像素差异热力图.png',
         'mask.png': '分割掩膜.png'}

def bundle_name(task):
    name = task['options'].get('taskName') or (task['input_names'] or task['inputs'] or ['变化分析'])[0]
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).rstrip('. ')[:100] + '_成果.zip'

def build_bundle(directory, outputs):
    stream = io.BytesIO()
    total = 0
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in outputs:
            path = directory / name
            if path.parent != directory or path.is_symlink() or not path.is_file():
                raise ValueError('成果文件不存在或已删除')
            total += path.stat().st_size
            if total > 120 * 1024 * 1024:
                raise ValueError('成果超过120MB，请分别下载文件')
            archive.write(path, NAMES.get(name, name))
    return stream.getvalue()
