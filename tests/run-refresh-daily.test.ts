import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import test from "node:test"

const script = readFileSync(new URL("../scripts/run-refresh-daily.sh", import.meta.url), "utf8")
const timer = readFileSync(new URL("../deploy/systemd/lab/kiko-refresh.timer", import.meta.url), "utf8")
const service = readFileSync(new URL("../deploy/systemd/lab/kiko-refresh.service", import.meta.url), "utf8")

test("daily refresh splits a multi-word PNPM command before passing it through xvfb-run", () => {
  assert.match(script, /read -r -a pnpm_command <<< "\$PNPM"/)
  assert.match(script, /"\$\{prefix\[@\]\}" "\$\{pnpm_command\[@\]\}" refresh/)
  const commandLines = script
    .split("\n")
    .filter((line) => !line.startsWith("PNPM=") && !line.startsWith("read -r -a pnpm_command"))
  assert.doesNotMatch(commandLines.join("\n"), /\$PNPM/)
})

test("daily refresh runs Zara detail coverage beside Cafe24 and waits before finalizing", () => {
  assert.match(script, /start_zara_fallback_phase[\s\S]*--type=zara/)
  assert.match(script, /--zara-source-concurrency=1/)
  assert.match(script, /wait_zara_fallback_phase[\s\S]*refresh:batch -- --finalize/)
  assert.match(script, /--type=cafe24,shopify,imweb,sixshop/)
  assert.match(script, /--priority=oldest/)
})

test("daily refresh gives rate-limited Shopify detail recovery the long parallel window", () => {
  assert.match(script, /start_shopify_fallback_phase[\s\S]*--type=shopify/)
  assert.match(script, /--shopify-source-concurrency=1/)
  assert.match(script, /wait_shopify_fallback_phase[\s\S]*refresh:batch -- --finalize/)
})

test("daily refresh checks every existing ShopLCDC detail URL including out-of-stock rows", () => {
  assert.match(script, /start_shoplcdc_fallback_phase[\s\S]*--type=cafe24 --site=shoplcdc/)
  assert.match(script, /--site=shoplcdc[\s\S]*--priority=oldest/)
  assert.match(script, /wait_shoplcdc_fallback_phase[\s\S]*refresh:batch -- --finalize/)
  assert.match(script, /"\$shoplcdc_fallback_pid"/)
})

test("daily refresh reserves a three-hour guard-recovery window", () => {
  assert.match(script, /date -d "\$scheduled_for 12:00"/)
  assert.match(script, /deadline_epoch=\$\(\(start_epoch \+ 16 \* 60 \* 60 \+ 15 \* 60\)\)/)
  assert.match(script, /cafe24_deadline_epoch=\$\(\(start_epoch \+ 13 \* 60 \* 60\)\)/)
  assert.match(script, /fallback_start_epoch=\$\(\(start_epoch \+ 13 \* 60 \* 60 \+ 15 \* 60\)\)/)
  assert.match(script, /--reconcile-min-coverage=1/)
  assert.match(timer, /OnCalendar=\*-\*-\* 12:00:00 Asia\/Seoul/)
  assert.match(service, /TimeoutStartSec=63000/)
})

test("daily refresh measures coverage from the actual batch invocation", () => {
  assert.match(script, /coverage_start=\$\(TZ=Asia\/Seoul date -d "@\$now_epoch" --iso-8601=seconds\)/)
  assert.doesNotMatch(script, /coverage_start=.*@\$start_epoch/)
})

test("recovered early phase errors do not fail the finalized service", () => {
  assert.match(script, /completed with \$phase_failures recorded phase failure/)
  assert.doesNotMatch(script, /if \[ "\$phase_failures" -gt 0 \]; then\s+exit 1/)
})
