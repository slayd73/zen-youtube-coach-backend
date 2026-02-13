import os
import re
import sys
from datetime import datetime

# Header riga singola tipo:
# /* [1/231] FILE: C:\DEV\path\to\file.js */
HEADER_RE = re.compile(r'^\s*/\*\s*\[\d+/\d+\]\s*FILE:\s*(.+?)\s*\*/\s*$')

def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)

def norm_win_path(p: str) -> str:
    return os.path.normpath(p.strip())

def is_separator_line(line: str) -> bool:
    """
    Riconosce SOLO i separatori artificiali tipo:
      /* ======== */
      /* ======================= */
      // ------------------------
      // ____________
    e scarta queste righe.
    Non tocca commenti "normali" (con lettere/numeri).
    """
    s = line.strip()
    if not s:
        return False

    # /* ... */
    if s.startswith("/*") and s.endswith("*/"):
        inner = s[2:-2].strip()
        if inner and set(inner).issubset(set("= -_")):
            useful = inner.replace(" ", "")
            return len(useful) >= 5 and set(useful).issubset(set("=-_"))
        return False

    # // ...
    if s.startswith("//"):
        inner = s[2:].strip()
        if inner and set(inner).issubset(set("= -_")):
            useful = inner.replace(" ", "")
            return len(useful) >= 5 and set(useful).issubset(set("=-_"))
        return False

    return False

def drop_leading_separators_for_json(lines: list[str]) -> list[str]:
    """
    Protezione extra: per .json rimuove separatori artificiali e righe vuote in testa,
    finché il primo carattere non whitespace non diventa { oppure [.
    """
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.strip() == "" or is_separator_line(ln):
            i += 1
            continue
        stripped = ln.lstrip()
        if stripped.startswith("{") or stripped.startswith("["):
            return lines[i:]
        return lines
    return lines

def write_text_file_if_missing(path: str, content: str) -> bool:
    """Scrive il file solo se non esiste. Ritorna True se creato."""
    if os.path.exists(path):
        return False
    ensure_dir(os.path.dirname(path))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return True

def main():
    if len(sys.argv) < 3:
        print("Uso:")
        print("  python unpack_extracted_code.py <extracted_code.txt> <restore_root>")
        print('Esempio:')
        print('  python unpack_extracted_code.py extracted_code.txt "C:\\DEV\\Restore App SLAYD INTELLIGENCE"')
        sys.exit(1)

    extracted_txt = os.path.abspath(sys.argv[1])
    restore_root = os.path.abspath(sys.argv[2])

    if not os.path.exists(extracted_txt):
        print(f"❌ File non trovato: {extracted_txt}")
        sys.exit(1)

    ensure_dir(restore_root)

    prefix_candidates = [
        r"C:\DEV\zen-youtube-coach-backend",
        r"C:\DEV\zen-youtube-coach-dashboard",
        r"C:\DEV\ZenTranscriptEngine",
    ]
    prefix_candidates = [os.path.normpath(p) for p in prefix_candidates]

    def map_to_restore(original_path: str) -> str:
        op = os.path.normpath(original_path)
        for pref in prefix_candidates:
            if op.lower().startswith(pref.lower() + os.sep) or op.lower() == pref.lower():
                rel = os.path.relpath(op, pref)
                project_name = os.path.basename(pref)
                return os.path.join(restore_root, project_name, rel)
        return os.path.join(restore_root, "_misc", os.path.basename(op))

    written = 0
    current_file = None
    current_lines: list[str] = []

    def flush():
        nonlocal written, current_file, current_lines
        if current_file is None:
            return

        out_path = map_to_restore(current_file)
        out_dir = os.path.dirname(out_path)
        ensure_dir(out_dir)

        lines_to_write = current_lines

        # Protezione extra per JSON (package.json, ecc.)
        _, ext = os.path.splitext(out_path)
        if ext.lower() == ".json":
            lines_to_write = drop_leading_separators_for_json(lines_to_write)

        with open(out_path, "w", encoding="utf-8", newline="\n") as f:
            f.write("".join(lines_to_write))

        written += 1
        current_file = None
        current_lines = []

    with open(extracted_txt, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = HEADER_RE.match(line)
            if m:
                flush()
                current_file = norm_win_path(m.group(1))
                current_lines = []
                continue

            if current_file is None:
                continue

            if is_separator_line(line):
                continue

            current_lines.append(line)

    flush()

    # ============================================================
    # POST-UNPACK: ENV bootstrap (one-shot restore)
    # ============================================================
    dashboard_root = os.path.join(restore_root, "zen-youtube-coach-dashboard")
    backend_root   = os.path.join(restore_root, "zen-youtube-coach-backend")

    created_env = []
    stamp = datetime.now().isoformat(timespec="seconds")

    # Dashboard: .env.local
    dash_env_path = os.path.join(dashboard_root, ".env.local")
    dash_env = (
        "# Auto-generated by unpack_extracted_code.py (restore bootstrap)\n"
        f"# Generated: {stamp}\n"
        "VITE_API_BASE=http://localhost:4000/api\n"
        "# Inserisci la tua Clerk publishable key (pk_test_... o pk_live_...)\n"
        "VITE_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME\n"
        "# Opzionale: template JWT Clerk\n"
        "# VITE_CLERK_JWT_TEMPLATE=\n"
    )
    if write_text_file_if_missing(dash_env_path, dash_env):
        created_env.append(dash_env_path)

    # Backend: .env (placeholder, no segreti)
    backend_env_path = os.path.join(backend_root, ".env")
    backend_env = (
        "# Auto-generated by unpack_extracted_code.py (restore bootstrap)\n"
        f"# Generated: {stamp}\n"
        "NODE_ENV=development\n"
        "PORT=4000\n"
        "\n"
        "# --- Providers (inserisci le chiavi reali qui / su Render) ---\n"
        "# AI_PROVIDER=groq\n"
        "# GROQ_API_KEY=\n"
        "# OPENAI_API_KEY=\n"
        "\n"
        "# --- Transcript Engine / YouTube ---\n"
        "# YT_DLP_PATH=\n"
        "# FFMPEG_PATH=\n"
        "\n"
        "# --- Clerk backend (se usi auth server-side) ---\n"
        "# CLERK_SECRET_KEY=\n"
    )
    if write_text_file_if_missing(backend_env_path, backend_env):
        created_env.append(backend_env_path)

    print(f"✅ Ricostruzione completata. File scritti: {written}")
    print(f"📁 Root restore: {restore_root}")

    if created_env:
        print("🧩 Creati file env mancanti:")
        for p in created_env:
            print(f"  + {p}")
    else:
        print("🧩 Env già presenti: nessun file env creato.")

if __name__ == "__main__":
    main()
