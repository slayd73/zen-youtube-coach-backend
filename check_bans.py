import json
d=json.load(open("t9_v15.json","r",encoding="utf-8"))
s=(d.get("result",{}).get("script","") or "").lower()
print("has_test9", "test di 9 minuti" in s)
print("has_palestra", "palestra" in s)
print("has_2min", "2 minuti" in s)
print("has_4min", "4 minuti" in s)
print("has_6min", "6 minuti" in s)
