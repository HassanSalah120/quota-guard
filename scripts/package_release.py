"""Build and verify allowlisted release ZIPs using only Python's standard library."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
MANIFEST = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
VERSION = MANIFEST['version']
if not re.fullmatch(r'\d+(?:\.\d+){1,3}', VERSION):
    raise ValueError('Invalid manifest version')


def source(name):
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name:
        raise ValueError(f'Unsafe archive path: {name}')
    file = ROOT.joinpath(*relative.parts)
    if file.is_symlink() or not file.resolve().is_relative_to(ROOT):
        raise ValueError(f'Unsafe source: {name}')
    return file.read_bytes()


def write_zip(file, entries):
    with zipfile.ZipFile(file, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            item = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, data, compresslevel=9)
    with zipfile.ZipFile(file) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(entries):
            raise ValueError(f'Invalid ZIP: {file.name}')
        for name, data in entries.items():
            if archive.read(name) != data:
                raise ValueError(f'ZIP byte mismatch: {name}')


def verify_images():
    expected = {
        'branding/quotaguard-logo.png': (800, 200),
        'branding/quotaguard-banner.png': (1280, 640),
        'cws/promo-tile-small-440x280.png': (440, 280),
        'cws/marquee-banner-1400x560.png': (1400, 560),
        'screenshots/on-video-pill.png': (1280, 720),
    }
    for size in [16, 32, 48, 128, 256, 512]:
        expected[f'branding/icon-{size}.png'] = (size, size)
        if size <= 128 and source(f'icons/icon{size}.png') != source(f'assets/branding/icon-{size}.png'):
            raise ValueError(f'Runtime icon differs from media icon: {size}')
    for file in (ROOT / 'assets/cws').glob('screenshot-*.png'):
        expected[file.relative_to(ROOT / 'assets').as_posix()] = (1280, 800)
    for file in (ROOT / 'assets/screenshots').glob('popup-*.png'):
        expected[file.relative_to(ROOT / 'assets').as_posix()] = (800, 1014)
    for name, dimensions in expected.items():
        data = source(f'assets/{name}')
        if data[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', data[16:24]) != dimensions:
            raise ValueError(f'Wrong PNG dimensions: {name}')
    print(f'PASS: {len(expected)} image dimensions and matching runtime icons')


def main():
    DIST.mkdir(exist_ok=True)
    verify_images()
    files = {'manifest.json', 'LICENSE', MANIFEST['background']['service_worker'], MANIFEST['action']['default_popup']}
    files.update(MANIFEST['icons'].values())
    files.update(MANIFEST['action']['default_icon'].values())
    for script in MANIFEST['content_scripts']:
        files.update(script.get('js', []))
        files.update(script.get('css', []))
    popup = source(MANIFEST['action']['default_popup']).decode('utf-8')
    files.update(re.findall(r'(?:src|href)="([^"#]+\.(?:js|css|png))"', popup))
    entries = {name: source(name) for name in files}
    install = f'''QuotaGuard {VERSION} - Chromium Manifest V3 extension

Install:
1. Extract this ZIP into a permanent folder.
2. Open chrome://extensions or edge://extensions.
3. Enable Developer mode, then choose Load unpacked.
4. Choose the extracted folder containing manifest.json.

Update an existing unpacked installation:
Extract the new files into your existing extension folder, click Reload on its
extension card, then refresh open Facebook, X, TikTok and YouTube tabs.
Keep the same installation to preserve its locally stored preferences.

Quality depends on formats offered by each video. Audio only is a request on
supported responses. Media sizes are measured values when available; buffered
bytes are not total file size or internet usage. No estimated savings are shown.

Documentation: https://github.com/HassanSalah120/quota-guard#readme
Releases: https://github.com/HassanSalah120/quota-guard/releases/latest
License: MIT (see LICENSE)
'''
    entries['INSTALL.txt'] = install.encode('utf-8')
    extension = DIST / f'quota-guard-v{VERSION}.zip'
    write_zip(extension, entries)
    # Extract only the already validated ZIP, into a new directory for receiver tests.
    extracted = Path(tempfile.mkdtemp(prefix=f'qg-release-v{VERSION}-', dir=DIST))
    with zipfile.ZipFile(extension) as archive:
        archive.extractall(extracted)
    if json.loads((extracted / 'manifest.json').read_text())['version'] != VERSION:
        raise ValueError('Extracted manifest version mismatch')
    for name in files:
        if (extracted / name).read_bytes() != source(name):
            raise ValueError(f'Extracted source mismatch: {name}')
    media_entries = {
        file.relative_to(ROOT).as_posix(): source(file.relative_to(ROOT).as_posix())
        for file in (ROOT / 'assets').rglob('*')
        if file.is_file() and file.suffix in {'.png', '.svg', '.md'}
    }
    media_entries['LICENSE'] = source('LICENSE')
    media = DIST / f'quota-guard-media-v{VERSION}.zip'
    write_zip(media, media_entries)
    sums = ''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in [extension, media])
    with (DIST / f'SHA256SUMS-v{VERSION}.txt').open('w', encoding='ascii', newline='\n') as output:
        output.write(sums)
    print(f'PASS: {len(entries)} allowlisted extension files; ZIP CRC, source bytes, manifest and extraction verified')
    print(f'PASS: {len(media_entries)} media files; ZIP CRC and source bytes verified')
    print(sums, end='')
    print(f'EXTRACTED_PATH={extracted}')


if __name__ == '__main__':
    main()
