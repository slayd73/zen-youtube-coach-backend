import json

for f in ["t7.json", "t8.json", "t9.json"]:
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
        "provider=", m.get("providerUsed"),
        "ms=", m.get("elapsedMs"),
    )
