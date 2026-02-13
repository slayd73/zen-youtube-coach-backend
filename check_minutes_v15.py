import json
for f in ["t7_v15.json","t8_v15.json","t9_v15.json"]:
    d=json.load(open(f,"r",encoding="utf-8"))
    m=d.get("meta",{})
    adj=m.get("adjusted") or {}
    print(f, "success=", d.get("success"),
          "words=", m.get("wordCount"),
          "range=", (m.get("minWords"), m.get("maxWords")),
          "padded=", adj.get("padded"),
          "trimmed=", adj.get("trimmed"),
          "clampIters=", adj.get("clampIters"),
          "ms=", m.get("elapsedMs"))
