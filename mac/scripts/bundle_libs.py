#!/usr/bin/env python3
"""Make IronHide.app self-contained.

Copies every non-system dynamic library that the app binary, ffmpeg and ffprobe need (libmpv and the ~40 Homebrew libraries
behind it) into Contents/Frameworks, rewrites each reference to @rpath/<name>, points the executables' rpath at that folder,
drops rpaths that lead back to Homebrew, and ad-hoc signs everything (Apple Silicon refuses unsigned or altered code).

usage: bundle_libs.py <IronHide.app> <extra executable> ...
"""
import os, re, shutil, subprocess, sys

SYSTEM = ('/System/', '/usr/lib/')


def run(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True).stdout


def deps(path):
    lines = run('otool', '-L', path).splitlines()[1:]
    return [l.strip().split(' (')[0] for l in lines if l.strip()]


def rpaths(path):
    out, found = run('otool', '-l', path).splitlines(), []
    for i, l in enumerate(out):
        if 'cmd LC_RPATH' in l:
            m = re.search(r'path (.+?) \(offset', out[i + 2])
            if m: found.append(m.group(1))
    return found


def resolve(ref, owner_src):
    """Where a reference made by owner_src (its original location) really lives."""
    base = os.path.dirname(owner_src)
    if ref.startswith('@loader_path/') or ref.startswith('@executable_path/'):
        p = os.path.join(base, ref.split('/', 1)[1])
        return os.path.realpath(p) if os.path.exists(p) else None
    if ref.startswith('@rpath/'):
        for rp in rpaths(owner_src):
            rp = rp.replace('@loader_path', base).replace('@executable_path', base)
            p = os.path.join(rp, ref[len('@rpath/'):])
            if os.path.exists(p): return os.path.realpath(p)
        for d in ('/opt/homebrew/lib', '/usr/local/lib'):
            p = os.path.join(d, ref[len('@rpath/'):])
            if os.path.exists(p): return os.path.realpath(p)
        return None
    return os.path.realpath(ref) if os.path.exists(ref) else None


def main():
    app, extras = sys.argv[1], sys.argv[2:]
    fw = os.path.join(app, 'Contents', 'Frameworks')
    os.makedirs(fw, exist_ok=True)
    exe_dir = os.path.join(app, 'Contents', 'MacOS')
    roots = [os.path.join(exe_dir, f) for f in os.listdir(exe_dir)] + extras
    # (bundled file, original location) pairs still to process
    todo = [(r, os.path.realpath(r)) for r in roots]
    done, copied = set(), {}
    while todo:
        path, src = todo.pop()
        if path in done: continue
        done.add(path)
        for ref in deps(path):
            if ref.startswith(SYSTEM) or ref.startswith('@rpath/libswift'): continue
            name = os.path.basename(ref)
            if path.endswith('/' + name) and ref == run('otool', '-D', path).splitlines()[-1].strip(): continue  # its own id
            real = resolve(ref, src)
            if not real:
                if ref.startswith('@'): continue  # already relative and not ours to fix
                sys.exit(f'cannot find {ref} (needed by {path})')
            dest = os.path.join(fw, name)
            if name not in copied:
                shutil.copy2(real, dest); os.chmod(dest, 0o755)
                run('install_name_tool', '-id', f'@rpath/{name}', dest)
                copied[name] = real
                todo.append((dest, real))
            if ref != f'@rpath/{name}':
                run('install_name_tool', '-change', ref, f'@rpath/{name}', path)
    # rpaths: libraries find their siblings next to themselves, executables find the Frameworks folder; nothing points at Homebrew
    for name in copied:
        p = os.path.join(fw, name)
        for rp in rpaths(p): run('install_name_tool', '-delete_rpath', rp, p)
        run('install_name_tool', '-add_rpath', '@loader_path', p)
    for r in roots:
        for rp in rpaths(r):
            if not rp.startswith('@'): run('install_name_tool', '-delete_rpath', rp, r)
        rel = os.path.relpath(fw, os.path.dirname(r))
        want = f'@executable_path/{rel}'
        if want not in rpaths(r): run('install_name_tool', '-add_rpath', want, r)
    # sign inside out: libraries, the tools, then the app as a whole (ad-hoc: no Apple account needed)
    for name in copied: run('codesign', '--force', '--sign', '-', os.path.join(fw, name))
    for r in roots: run('codesign', '--force', '--sign', '-', r)
    run('codesign', '--force', '--deep', '--sign', '-', app)
    # nothing may still point outside the app or the system
    leaks = [(f, d) for f in [*roots, *[os.path.join(fw, n) for n in copied]] for d in deps(f) if d.startswith(('/opt/homebrew', '/usr/local'))]
    if leaks: sys.exit('still linked outside the app: ' + ', '.join(f'{os.path.basename(f)} -> {d}' for f, d in leaks))
    print(f'bundled {len(copied)} libraries into {fw}')


if __name__ == '__main__':
    main()
