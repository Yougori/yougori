"""Create a reviewable source-delivery ZIP from the verified release inventory.

Never publishes or copies installers. Only indexed archives and explicit public
license/build evidence are included; private build caches are excluded.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    subprocess.run(['node', 'scripts/compliance-check.mjs', '--package'], cwd=ROOT, check=True)
    report = json.loads((ROOT / 'compliance/release.json').read_text(encoding='utf-8'))
    fingerprint = hashlib.sha256(json.dumps({'inputs': report['inputs'], 'archives': report['archives']}, sort_keys=True).encode()).hexdigest()[:16]
    output = ROOT / 'build/compliance/dist' / f'Yougori-corresponding-source-{fingerprint}.zip'
    if output.exists():
        raise ValueError('The source package already exists; preserve it and use its recorded checksum.')
    output.parent.mkdir(parents=True, exist_ok=True)
    bundle = ROOT / 'build/compliance/bundle'
    temporary = output.with_suffix('.zip.part')
    with zipfile.ZipFile(temporary, 'x', allowZip64=True) as archive:
        for item in report['archives']:
            archive.write(bundle / item['file'], 'bundle/' + item['file'])
        for name in ('SOURCE_INDEX.json', 'SHA256SUMS'):
            archive.write(bundle / name, 'bundle/' + name, compress_type=zipfile.ZIP_DEFLATED)
        paths = ['LICENSE', 'COPYING', 'NOTICE', 'COMMERCIAL_LICENSE.md', 'docs/licensing.md', 'docs/rebuilding-third-party.md',
                 'docs/compliance-status.md', 'scripts/restore-compliance-sources.py',
                 'compliance/release.json', 'compliance/engineering-review.json', 'compliance/frontend.json', 'compliance/native.json',
                 'src-tauri/resources/THIRD_PARTY_NOTICES.md', 'src-tauri/resources/RUNTIME_LICENSES.txt',
                 'src-tauri/resources/APPLICATION_LICENSES.txt', 'src-tauri/resources/WORKSPACE_LICENSES.txt']
        paths += [path.relative_to(ROOT).as_posix() for path in (ROOT / 'compliance/notices').glob('*') if path.is_file()]
        paths += [path.relative_to(ROOT).as_posix() for path in (ROOT / 'compliance/evidence').glob('*') if path.is_file()]
        for name in sorted(set(paths)):
            archive.write(ROOT / name, name, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr('README.txt', 'Yougori matching third-party sources\n\n'
            'This ZIP accompanies the runtime inventory in compliance/release.json.\n'
            'Source archives, recipes and patches are in bundle/. Check bundle/SHA256SUMS.\n'
            'Read docs/rebuilding-third-party.md for restore/build/relink instructions.\n'
            'Example: python scripts/restore-compliance-sources.py bundle C:/yougori-rebuild\n'
            'Third-party sources retain their original licenses. Original Yougori material\n'
            'retains LICENSE/NOTICE and the separately identified component licenses.\n'
            'Historical installer coverage is described separately in docs/compliance-status.md.\n')
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip() is not None:
            raise ValueError('Source package failed its integrity check')
    temporary.rename(output)
    with output.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    output.with_suffix('.zip.sha256').write_text(checksum + '  ' + output.name + '\n', encoding='utf-8')
    print(f'Prepared {output.name} ({output.stat().st_size / 1024**3:.2f} GiB)')
    print('SHA256:', checksum)


if __name__ == '__main__':
    main()
