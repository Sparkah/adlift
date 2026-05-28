#!/usr/bin/env bash
# Assemble a static, replay-only build of the dashboard into static/ for hosting
# on Cloudflare Pages / GitHub Pages. Live runs need the Node server (or the MCP
# endpoint); the static build plays the pre-baked replay fixtures.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf static
mkdir -p static/data/baseline static/data/fixtures

# app shell - rewrite absolute asset paths to relative so it works at any base
sed -e 's#/style.css#style.css#g; s#/app.js#app.js#g' public/index.html > static/index.html
cp public/style.css static/style.css
cp public/app.js static/app.js

# data
cp data/baseline/*.png static/data/baseline/
cp data/fixtures/replay_*.json static/data/fixtures/

# combined campaigns list (same shape the server's /api/campaigns returns)
node -e '
const fs=require("fs"),p="data/baseline";
const a=fs.readdirSync(p).filter(f=>/^campaign.*\.json$/.test(f))
  .map(f=>JSON.parse(fs.readFileSync(p+"/"+f,"utf8")))
  .sort((x,y)=>(x.order||0)-(y.order||0));
fs.writeFileSync("static/data/campaigns.json",JSON.stringify(a));
console.log("campaigns.json:",a.map(c=>c.id).join(", "));
'
echo "built static/ ($(du -sh static | cut -f1))"
