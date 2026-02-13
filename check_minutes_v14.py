import json

for f in ["t7_v14.json", "t8_v14.json", "t9_v14b.json"]:
    with open(f, "r", encoding="utf-8") as fp:
        d = json.load(fp)
    m = d.get("meta", {})
    adj = m.get("adjusted") or {}
    print(
        f,
        "success=", d.get("success"),
        "words=", m.get("wordCount"),
        "target=", m.get("targetWords"),
        "range=", (m.get("minWords"), m.get("maxWords")),
        "padded=", adj.get("padded"),
        "trimmed=", adj.get("trimmed"),
        "ms=", m.get("elapsedMs"),
    )
