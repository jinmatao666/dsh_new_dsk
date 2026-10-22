import fs from 'fs';
import path from 'path';

function nativeSelectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return nativeSelectFiles(file);
    if (!/\.[jt]sx?$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) return [];
    return /<select(?:\s|>)/.test(fs.readFileSync(file, 'utf8')) ? [path.relative(process.cwd(), file)] : [];
  });
}

test('production admin controls do not reintroduce OS-rendered native selects', () => {
  expect(nativeSelectFiles(path.join(process.cwd(), 'src'))).toEqual([]);
});

test('the admin entry loads selection styling for custom and library controls', () => {
  expect(fs.readFileSync(path.join(process.cwd(), 'src/index.js'), 'utf8')).toContain("import './styles/admin-selects.css'");
});
