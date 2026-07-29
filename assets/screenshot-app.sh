#!/usr/bin/env bash
# Erneuert die App-Screenshots für Kapitel 03 aus den echten Cockpit-Dateien.
# Ausführen aus dem Projektordner:  bash assets/screenshot-app.sh
set -e
cd "$(dirname "$0")/.."
PW=/opt/node22/lib/node_modules/playwright/index.mjs
CHROME=${CHROME:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}
npx --yes http-server -p 8899 -s . >/dev/null 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT; sleep 3
node --input-type=module <<NODE
import { chromium } from '$PW';
const b=await chromium.launch({executablePath:'$CHROME',args:['--no-sandbox']});
const m=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const p=await m.newPage();
await p.goto('http://127.0.0.1:8899/krebs-cockpit-mobile.html',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(5000);
await p.screenshot({path:'assets/media/app-cockpit-mobile.jpg',type:'jpeg',quality:88,animations:'disabled',timeout:30000});
const d=await b.newContext({viewport:{width:1400,height:880},deviceScaleFactor:1.6});
const q=await d.newPage();
await q.goto('http://127.0.0.1:8899/krebs-cockpit-pro.html',{waitUntil:'domcontentloaded'});
await q.waitForTimeout(5000);
await q.screenshot({path:'assets/media/app-cockpit-desktop.jpg',type:'jpeg',quality:84,animations:'disabled',timeout:30000});
await b.close();
console.log('✓ App-Screenshots erneuert');
NODE
