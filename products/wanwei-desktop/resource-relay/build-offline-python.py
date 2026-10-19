"""Download binary Python dependencies and create an uploadable wheel-only ZIP."""
import argparse
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--platform', help='For example win_amd64; omit for the current OS')
    parser.add_argument('--python-version', help='For example 3.11; must match the desktop Python')
    parser.add_argument('--abi', help='For example cp311')
    parser.add_argument('packages', nargs='+', help='Package requirements, e.g. pandas==2.2.3')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists; choose another filename')
    if any(item.startswith('-') or '://' in item or '@' in item or '/' in item or '\\' in item for item in args.packages):
        parser.error('Use package names/version constraints, not URLs, paths or pip flags')
    with tempfile.TemporaryDirectory(prefix='wanwei-wheels-') as directory:
        command = [sys.executable, '-m', 'pip', 'download', '--only-binary=:all:', '--dest', directory]
        for option in ['platform', 'python_version', 'abi']:
            value = getattr(args, option)
            if value:
                command.extend(['--' + option.replace('_', '-'), value])
        subprocess.run(command + args.packages, check=True)
        wheels = sorted(Path(directory).glob('*.whl'))
        if not wheels:
            raise RuntimeError('No binary wheels downloaded')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(args.output, 'x', compression=zipfile.ZIP_STORED) as archive:
                for wheel in wheels:
                    archive.write(wheel, wheel.name)
        except BaseException:
            args.output.unlink(missing_ok=True)
            raise
        print(f'Created {args.output.resolve()} ({len(wheels)} wheel files)')


if __name__ == '__main__':
    main()
