"""Add the tunnel location to exactly one named server; never rewrite existing routes."""
import argparse
from pathlib import Path
import re


def patch(source: str, snippet: str, hostname: str, port: int) -> str:
    # Preserve offsets while excluding braces and keywords inside comments/strings.
    masked = list(source)
    quote = None
    comment = False
    escape = False
    for i, char in enumerate(source):
        if comment:
            if char == '\n':
                comment = False
            else:
                masked[i] = ' '
        elif quote:
            masked[i] = ' '
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == quote:
                quote = None
        elif char == '#':
            comment = True
            masked[i] = ' '
        elif char in ('"', "'"):
            quote = char
            masked[i] = ' '
    text = ''.join(masked)
    candidates = []
    for match in re.finditer(r'\bserver\s*\{', text):
        opening = text.index('{', match.start())
        depth = 1
        end = opening + 1
        while end < len(text) and depth:
            depth += (text[end] == '{') - (text[end] == '}')
            end += 1
        if depth:
            raise ValueError('Unbalanced nginx configuration')
        block = text[opening + 1:end - 1]
        names = re.findall(r'\bserver_name\s+([^;]+);', block)
        listens = re.findall(r'\blisten\s+([^;]+);', block)
        if any(hostname in name.split() for name in names) and any(
            re.search(rf'(?:^|:)\b{port}\b', listen.split()[0]) for listen in listens
        ):
            candidates.append((opening, end - 1))
    if len(candidates) != 1:
        raise ValueError('Expected exactly one matching server_name/listen block')
    opening, closing = candidates[0]
    marker = '# BEGIN WANWEI RESOURCE TUNNEL'
    if marker in source:
        if source.count(marker) != 1 or marker not in source[opening:closing]:
            raise ValueError('Unexpected existing tunnel marker')
        expected = marker + '\n' + snippet.rstrip() + '\n# END WANWEI RESOURCE TUNNEL'
        if expected not in source[opening:closing]:
            raise ValueError('Existing tunnel differs; review it manually')
        return source
    if '/api/desktop-resources/tunnel' in source:
        raise ValueError('Existing unowned tunnel route; review it manually')
    addition = '\n' + marker + '\n' + snippet.rstrip() + '\n# END WANWEI RESOURCE TUNNEL\n'
    return source[:closing] + addition + source[closing:]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--hostname', required=True)
    parser.add_argument('--port', type=int, default=3300)
    args = parser.parse_args()
    if args.output.exists() or args.source.resolve() == args.output.resolve():
        parser.error('Output must be a new file, not the active configuration')
    result = patch(args.source.read_text(encoding='utf-8'),
                   Path(__file__).with_name('gateway-tunnel.location.conf').read_text(encoding='utf-8'),
                   args.hostname, args.port)
    with args.output.open('x', encoding='utf-8', newline='\n') as output:
        output.write(result)
