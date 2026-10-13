#!/usr/bin/env python3
"""Exercise unchanged release installers only on a fresh hosted macOS runner."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import pty
import select
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'dist/release/smoke-evidence'
ASSETS = ROOT / 'dist/release/assets'
PRODUCT = Path.home() / 'Library/Application Support/CodexGoalProgress'
SERVICE = f'gui/{os.getuid()}/com.codexgoalprogress.helper'


def run(name, args, timeout=180, check=True, env=None):
    started = time.monotonic()
    result = subprocess.run([str(a) for a in args], capture_output=True, timeout=timeout, env=env)
    (EVIDENCE / f'{name}.stdout').write_bytes(result.stdout)
    (EVIDENCE / f'{name}.stderr').write_bytes(result.stderr)
    print(json.dumps({'step': name, 'exit': result.returncode, 'seconds': round(time.monotonic()-started, 2)}), flush=True)
    if check and result.returncode: raise RuntimeError(f'{name}: {result.stderr.decode(errors="replace")[-2000:]}')
    return result


def install_script(name, assets):
    env = {**os.environ, 'GOAL_PROGRESS_RELEASE_BASE_URL': assets.as_uri()}
    pid, master = pty.fork()
    if pid == 0:
        os.execvpe('/bin/sh', ['/bin/sh', str(assets / 'install.sh')], env)
    output = bytearray()
    answered = False
    deadline = time.monotonic() + 240
    status = None
    try:
        while status is None and time.monotonic() < deadline:
            if select.select([master], [], [], 0.2)[0]:
                try: output.extend(os.read(master, 65536))
                except OSError: pass
                if not answered and b'Restart now? [y/N]' in output:
                    os.write(master, b'y\n')
                    answered = True
            done, value = os.waitpid(pid, os.WNOHANG)
            if done: status = value
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            raise TimeoutError(f'{name}: installer did not finish')
        if os.waitstatus_to_exitcode(status) != 0: raise RuntimeError(f'{name}: installer failed')
        if b'Goal Progress is installed.' not in output: raise RuntimeError(f'{name}: completion missing')
    finally:
        os.close(master)
        (EVIDENCE / f'{name}.log').write_bytes(output)


def check_install(name, version):
    binary = PRODUCT / 'install/current/bin/goal-progress'
    manifest = json.loads((PRODUCT / 'install/manifest.json').read_text())
    assert manifest['releaseVersion'] == version
    assert hashlib.sha256(binary.read_bytes()).hexdigest() == manifest['helperSha256']
    for command in ['doctor', 'verify']:
        value = json.loads(run(f'{name}-{command}', [binary, command, '--json']).stdout)
        assert value['ok']
        if version != '0.3.9':
            assert value['details']['verification']['installation'] == 'pass'
    return manifest


def wait_for_normal_reopen(app, info):
    executable = str(app / 'Contents/MacOS' / info['CFBundleExecutable'])
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        ps = subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True, timeout=10)
        commands = [line.strip().split(maxsplit=1) for line in ps.splitlines()]
        normal = [parts[0] for parts in commands if len(parts) == 2 and parts[1] == executable]
        jobs = subprocess.check_output(['launchctl', 'list'], text=True, timeout=10)
        if not (PRODUCT / 'runtime/cdp.json').exists() and len(normal) == 1 and 'com.codexgoalprogress.restore-handoff-v2' not in jobs:
            (EVIDENCE / 'normal-reopen.json').write_text(json.dumps({'pids':normal,'runtimeRemoved':True,'restoreWorkerFinished':True}))
            return
        time.sleep(0.5)
    raise TimeoutError('Codex did not finish its documented normal-reopen handoff')


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        raise RuntimeError('This destructive installation check requires a fresh GitHub-hosted VM')
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('An Apple Silicon macOS runner is required')
    if PRODUCT.exists() or (Path.home() / '.codex').exists() or os.environ.get('GOAL_PROGRESS_ROOT'):
        raise RuntimeError('Refusing to use a runner with existing product or Codex data')
    EVIDENCE.mkdir(parents=True)
    assert run('existing-service', ['launchctl', 'print', SERVICE], check=False).returncode != 0
    run('gui-session', ['launchctl', 'print', f'gui/{os.getuid()}'])
    work = Path(os.environ['RUNNER_TEMP']) / 'goal-progress-release-smoke'
    work.mkdir()
    dmg = work / 'Codex.dmg'
    run('codex-download', ['curl', '-fL', '--retry', '2', '--max-time', '300',
        'https://persistent.oaistatic.com/codex-app-prod/Codex.dmg', '-o', dmg], timeout=330)
    attached = plistlib.loads(run('dmg-attach', ['hdiutil', 'attach', '-nobrowse', '-plist', dmg]).stdout)
    volumes = [Path(x['mount-point']) for x in attached['system-entities'] if 'mount-point' in x]
    matches = [app for volume in volumes for app in volume.glob('*.app')
        if plistlib.loads((app / 'Contents/Info.plist').read_bytes()).get('CFBundleIdentifier') == 'com.openai.codex']
    assert len(matches) == 1
    app = Path('/Applications') / matches[0].name
    if app.exists(): raise RuntimeError('Refusing to replace an existing official application')
    run('copy-official-app', ['sudo', 'ditto', matches[0], app])
    for volume in volumes: run('dmg-detach', ['hdiutil', 'detach', volume])
    run('official-signature', ['codesign', '--verify', '--deep', '--strict', app])
    identity = run('official-identity', ['codesign', '-dv', '--verbose=4', app]).stderr
    assert b'TeamIdentifier=2DC432GLL2' in identity and b'Identifier=com.openai.codex' in identity
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    (EVIDENCE / 'codex-version.json').write_text(json.dumps({key:info[key] for key in ['CFBundleIdentifier','CFBundleShortVersionString','CFBundleVersion']}))
    old_assets = work / 'v0.3.9'
    old_assets.mkdir()
    for name in ['codex-goal-progress-macos-arm64.zip', 'SHA256SUMS', 'install.sh']:
        run(f'download-old-{name}', ['curl', '-fL', '--retry', '2', '--max-time', '180',
            f'https://github.com/ezra-y/codex-goal-progress/releases/download/v0.3.9/{name}', '-o', old_assets / name])
    install_script('install-previous-release', old_assets)
    check_install('previous-release', '0.3.9')
    sentinels = {PRODUCT/'state/v1/release-preservation.txt': b'isolated history must survive\n',
                 PRODUCT/'preferences/release-preservation.txt': b'isolated preference must survive\n'}
    for path, data in sentinels.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o600)
    install_script('upgrade-to-candidate', ASSETS)
    version = json.loads((ROOT/'package.json').read_text())['version']
    upgraded = check_install('upgraded', version)
    assert all(path.read_bytes() == data for path, data in sentinels.items())
    binary = ROOT / 'dist/release/macos-arm64/bin/goal-progress'
    for attempt in range(3):
        result = json.loads(run(f'uninstall-{attempt}', [binary, 'uninstall', '--json', '--keep-history']).stdout)
        if result['code'] == 'UNINSTALL_OK': break
        assert result['code'] == 'UNINSTALL_RESTORE_SCHEDULED'
        wait_for_normal_reopen(app, info)
    assert result['ok'] and result['code'] == 'UNINSTALL_OK'
    assert all(not (PRODUCT / name).exists() for name in ['install', 'runtime'])
    assert run('service-removed', ['launchctl', 'print', SERVICE], check=False).returncode != 0
    cache = Path.home()/'.codex/plugins/cache/codex-goal-progress-local/codex-goal-progress'
    assert not cache.exists()
    assert all(path.read_bytes() == data for path, data in sentinels.items())
    install_script('clean-reinstall', ASSETS)
    clean = check_install('clean', version)
    assert clean['helperSha256'] == upgraded['helperSha256']
    assert all(path.read_bytes() == data for path, data in sentinels.items())
    summary = {'previousVersion':'0.3.9','version':version,'upgradePassed':True,'cleanReinstallPassed':True,
        'historyAndPreferencesPreserved':True,'helperSha256':clean['helperSha256'],
        'archiveSha256':hashlib.sha256((ASSETS/'codex-goal-progress-macos-arm64.zip').read_bytes()).hexdigest(),
        'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'environment':'fresh GitHub-hosted Apple Silicon macOS VM; synthetic preservation files; no user data',
        'liveGoalCreationTested':False}
    (EVIDENCE/'result.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)

if __name__ == '__main__':
    main()
