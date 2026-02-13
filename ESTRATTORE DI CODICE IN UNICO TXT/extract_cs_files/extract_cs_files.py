import os
import sys
from datetime import datetime
from typing import List, Set, Tuple


# ------------------------------------------------------------
# extract_cs_files.py (Windows-friendly)
#
# Uso da CMD:
#   python extract_cs_files.py paths.txt
#   python extract_cs_files.py paths.txt output.txt
#
# Uso con doppio click:
#   - cerca paths.txt nella stessa cartella dello script
#   - genera extracted_code.txt nella stessa cartella
#   - mostra errori e resta aperto (PAUSE)
#
# paths.txt format:
#   - Commenti: righe vuote o che iniziano con #
#   - Include:
#       C:\DEV\project, js, jsx, ts, tsx, json
#   - Exclude:
#       C:\DEV\project\node_modules, none
# ------------------------------------------------------------


def script_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def normalize_path(p: str) -> str:
    p = p.strip().strip('"').strip("'")
    return os.path.normpath(p)


def resolve_paths_file(arg_paths: str | None) -> str:
    if arg_paths:
        p = normalize_path(arg_paths)
        if not os.path.isabs(p):
            p = os.path.join(script_dir(), p)
        return p
    return os.path.join(script_dir(), "paths.txt")


def resolve_output_file(arg_out: str | None) -> str:
    if arg_out:
        out = normalize_path(arg_out)
        if not os.path.isabs(out):
            out = os.path.join(script_dir(), out)
        return out
    return os.path.join(script_dir(), "extracted_code.txt")


def parse_paths_file(paths_file: str) -> Tuple[List[Tuple[str, Set[str]]], Set[str]]:
    includes: List[Tuple[str, Set[str]]] = []
    excludes: Set[str] = set()

    with open(paths_file, "r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue

            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 2:
                continue

            root = normalize_path(parts[0])
            tokens = [t.strip().lower() for t in parts[1:] if t.strip()]

            if len(tokens) == 1 and tokens[0] == "none":
                excludes.add(root)
                continue

            exts: Set[str] = set()
            for t in tokens:
                t = t.lstrip(".").lower()
                if t and t != "none":
                    exts.add(t)

            if exts:
                includes.append((root, exts))

    return includes, excludes


def is_excluded(path: str, excludes: Set[str]) -> bool:
    norm = normalize_path(path)
    for ex in excludes:
        exn = normalize_path(ex)
        if norm.lower() == exn.lower():
            return True
        if norm.lower().startswith((exn + os.sep).lower()):
            return True
    return False


def try_read_text(file_path: str) -> str:
    # utf-8
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        pass

    # cp1252
    try:
        with open(file_path, "r", encoding="cp1252", errors="replace") as f:
            return f.read()
    except Exception:
        pass

    # latin-1 fallback
    with open(file_path, "r", encoding="latin-1", errors="replace") as f:
        return f.read()


def collect_files(includes: List[Tuple[str, Set[str]]], excludes: Set[str]) -> List[str]:
    collected: List[str] = []
    seen: Set[str] = set()

    for root, exts in includes:
        root = normalize_path(root)
        if not os.path.exists(root):
            continue

        if os.path.isfile(root):
            if is_excluded(root, excludes):
                continue
            ext = os.path.splitext(root)[1].lstrip(".").lower()
            if ext in exts:
                rp = os.path.abspath(root)
                if rp not in seen:
                    seen.add(rp)
                    collected.append(rp)
            continue

        for dirpath, dirnames, filenames in os.walk(root):
            if is_excluded(dirpath, excludes):
                dirnames[:] = []
                continue

            pruned = []
            for d in dirnames:
                full = os.path.join(dirpath, d)
                if not is_excluded(full, excludes):
                    pruned.append(d)
            dirnames[:] = pruned

            for fn in filenames:
                fp = os.path.join(dirpath, fn)
                if is_excluded(fp, excludes):
                    continue
                ext = os.path.splitext(fn)[1].lstrip(".").lower()
                if ext in exts:
                    rp = os.path.abspath(fp)
                    if rp not in seen:
                        seen.add(rp)
                        collected.append(rp)

    collected.sort(key=lambda p: p.lower())
    return collected


def write_output(output_path: str, files: List[str], includes: List[Tuple[str, Set[str]]], excludes: Set[str]) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)

    with open(output_path, "w", encoding="utf-8", newline="\n") as out:
        out.write("# =========================================================\n")
        out.write("# EXTRACTED CODE — single TXT snapshot\n")
        out.write(f"# Generated at: {now}\n")
        out.write(f"# Output: {output_path}\n")
        out.write("# =========================================================\n\n")

        out.write("# -------------------------\n# INCLUDES\n# -------------------------\n")
        for root, exts in includes:
            out.write(f"- {normalize_path(root)}  ({', '.join(sorted(exts))})\n")

        out.write("\n# -------------------------\n# EXCLUDES\n# -------------------------\n")
        for ex in sorted(excludes, key=lambda x: x.lower()):
            out.write(f"- {normalize_path(ex)}\n")

        out.write("\n# -------------------------\n")
        out.write(f"# FILES EXTRACTED: {len(files)}\n")
        out.write("# -------------------------\n\n")

        for i, fp in enumerate(files, start=1):
            out.write("\n\n")
            out.write("/* ======================================================== */\n")
            out.write(f"/* [{i}/{len(files)}] FILE: {fp} */\n")
            out.write("/* ======================================================== */\n\n")

            try:
                content = try_read_text(fp)
            except Exception as e:
                out.write(f"/* ERROR reading file: {e} */\n")
                continue

            out.write(content)

        out.write("\n\n# ================= END OF EXTRACT =================\n")


def pause_if_doubleclick():
    # Se lanciato da Explorer, è comodo fermarsi sempre alla fine.
    # Da CMD non dà fastidio: basta premere Invio.
    try:
        input("\nPremi INVIO per chiudere...")
    except Exception:
        pass


def main():
    # Double click: nessun argomento -> usa defaults
    arg_paths = sys.argv[1] if len(sys.argv) >= 2 else None
    arg_out = sys.argv[2] if len(sys.argv) >= 3 else None

    paths_file = resolve_paths_file(arg_paths)
    output_file = resolve_output_file(arg_out)

    if not os.path.exists(paths_file):
        print(f"❌ paths.txt non trovato: {paths_file}")
        print("Suggerimento: metti paths.txt nella stessa cartella di questo script.")
        pause_if_doubleclick()
        sys.exit(1)

    includes, excludes = parse_paths_file(paths_file)
    if not includes:
        print("❌ Nessuna regola INCLUDE trovata in paths.txt.")
        print("Formato INCLUDE: C:\\DEV\\project, js, jsx, ts, tsx")
        pause_if_doubleclick()
        sys.exit(1)

    files = collect_files(includes, excludes)
    write_output(output_file, files, includes, excludes)

    print(f"✅ OK. Estratti {len(files)} file.")
    print(f"📄 Output: {output_file}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ ERRORE: {e}")
        pause_if_doubleclick()
        raise
    else:
        # anche in caso di successo, se è doppio click è comodo vedere l’output
        if len(sys.argv) == 1:
            pause_if_doubleclick()
