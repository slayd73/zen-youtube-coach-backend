const fs = require("fs");

const raw = fs.readFileSync("out.json", "utf8");
const j = JSON.parse(raw);

let csv = (j.fliki && j.fliki.csv) ? j.fliki.csv : (j.flikiCSV || "");
csv = String(csv);

// normalizza newlines e virgolette
csv = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
csv = csv.replace(/\\"/g, '"');

fs.writeFileSync("fliki-fixed.csv", csv, "utf8");

const lines = csv.split("\n").length;
console.log("OK fliki-fixed.csv lines=" + lines);
