import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {test} from "node:test"

const repo = process.cwd()
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pipeline-shell-"))
  await mkdir(path.join(directory, "bin"))
  await mkdir(path.join(directory, "data"))
  await symlink(path.join(repo, "tools"), path.join(directory, "tools"))
  await symlink(path.join(repo, "node_modules"), path.join(directory, "node_modules"))
  const executable = path.join(directory, "bin", "corepack")
  await writeFile(executable, `#!/usr/bin/env node
const fs=require('fs'),path=require('path'); const args=process.argv.slice(2);
const arg=(name)=>args.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3);
const tool=args.find(v=>v.endsWith('.ts'));
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value)};
if(!tool){console.log('1');process.exit(0)}
fs.appendFileSync('calls.log',args.join(' ')+'\\n');
const report=(file,key,failed)=>write(file,JSON.stringify({schema_version:1,run_id:'fake',mode:'apply',status:failed?'failed':'success',started_at:new Date().toISOString(),ended_at:new Date().toISOString(),counts:{inserted:failed?0:1,failed:failed?1:0},stages:{},errors:failed?[{stage:'import',code:'FAKE_FAILURE',message:'failed',retryable:true}]:[],files:[{platform:key,status:failed?'failed':'success',counts:{inserted:failed?0:1},errors:[]}]}));
if(tool.endsWith('product-extraction-poc.ts'))write(path.join(arg('out-root'),arg('run-id'),'products.jsonl'),'{}\\n');
else if(tool.endsWith('onboard-classify.ts')){const i=args.indexOf(tool);write(args[i+3],JSON.stringify(JSON.parse(fs.readFileSync(args[i+2])).map(v=>v.key)))}
else if(tool.endsWith('run-pipeline-import.ts')){const key=JSON.parse(fs.readFileSync(arg('expected-configs')))[0].key;const failed=process.env.TEST_IMPORT_FAIL==='1';report(arg('report'),key,failed);process.exit(failed?1:0)}
else if(tool.endsWith('reclassify-categories.ts'))console.log('processed=0 changed=0');
else if(tool.endsWith('crawl.ts'))write('data/'+arg('site')+'-products.json',JSON.stringify([{newCrawl:true}]));
else if(tool.endsWith('import-products.ts'))report(arg('report'),arg('site'),false);
else if(tool.endsWith('recollect-metrics.ts')){if(process.env.TEST_VERIFY_FAIL==='1'&&args.some(v=>v.startsWith('--untouched-since=')))process.exit(9);write(arg('out'),JSON.stringify({metrics:{rows:1,colorNonCanonical:0}}));}
else if(tool.endsWith('invalidate-changed-embeddings.ts')){if(arg('snapshot'))write(arg('snapshot'),'{}\\n');if(process.env.TEST_EMBED_FAIL==='1'&&args.includes('--apply'))process.exit(9);}
else if(!tool.endsWith('check-onboard-anomalies.ts'))process.exit(95);
`)
  await chmod(executable, 0o755)
  const run = (script: string, args: string[], extra: Record<string, string> = {}) => spawnSync("bash", [path.join(repo, script), ...args], {
    cwd: directory, encoding: "utf8", env: {...process.env, PATH: `${path.join(directory, "bin")}:${process.env.PATH}`, ...extra},
  })
  return {directory, run}
}

test("onboarding skips guardrail after a failed import and recrawls changed policy inputs", async () => {
  const {directory, run} = await fixture()
  try {
    await writeFile(path.join(directory, "configs.json"), '[{"key":"brand"}]')
    const args = ["--configs", "configs.json", "--out-root", "runs", "--end", "0"]
    const failed = run("tools/onboard-batch.sh", args, {TEST_IMPORT_FAIL: "1"})
    assert.equal(failed.status, 1, failed.stderr)
    let calls = await readFile(path.join(directory, "calls.log"), "utf8")
    assert.doesNotMatch(calls, /reclassify-categories/)
    assert.equal(run("tools/onboard-batch.sh", args).status, 0)
    calls = await readFile(path.join(directory, "calls.log"), "utf8")
    assert.match(calls, /reclassify-categories\.ts --only-invalid --platform=brand/)
    assert.equal(calls.split("product-extraction-poc.ts").length - 1, 1)
    assert.equal(run("tools/onboard-batch.sh", [...args, "--variants", "hybrid"]).status, 0)
    calls = await readFile(path.join(directory, "calls.log"), "utf8")
    assert.equal(calls.split("product-extraction-poc.ts").length - 1, 2)
  } finally { await rm(directory, {recursive: true, force: true}) }
})

test("forcing only crawl invalidates the old import completion marker", async () => {
  const {directory, run} = await fixture()
  try {
    const keyDirectory = path.join(directory, "runs", "campaign", "brand")
    await mkdir(keyDirectory, {recursive: true})
    await writeFile(path.join(directory, "data", "brand-products.json"), '[{"oldCrawl":true}]')
    await writeFile(path.join(keyDirectory, "crawl.done"), "")
    await writeFile(path.join(keyDirectory, "import.done"), "")
    const result = run("tools/recollect-batch.sh", ["--keys", "brand", "--run-id", "campaign", "--out-root", "runs", "--skip-embeddings", "--force-stage", "crawl"])
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const calls = await readFile(path.join(directory, "calls.log"), "utf8")
    assert.match(calls, /src\/crawl.ts/)
    assert.match(calls, /src\/import-products.ts/)
    assert.match(await readFile(path.join(keyDirectory, "import-artifact.json"), "utf8"), /artifact_sha256/)
  } finally { await rm(directory, {recursive: true, force: true}) }
})

test("recollect scopes guardrail and fails when post verification fails", async () => {
  const {directory, run} = await fixture()
  try {
    const result = run("tools/recollect-batch.sh", ["--keys", "brand", "--run-id", "campaign",
      "--out-root", "runs", "--skip-embeddings"], {TEST_VERIFY_FAIL: "1"})
    assert.equal(result.status, 1)
    const calls = await readFile(path.join(directory, "calls.log"), "utf8")
    assert.match(calls, /reclassify-categories\.ts --only-invalid --platform=brand/)
  } finally { await rm(directory, {recursive: true, force: true}) }
})

test("embedding dry-run never completes the apply marker and requested apply failures propagate", async () => {
  const {directory, run} = await fixture()
  try {
    const args = ["--keys", "brand", "--run-id", "campaign", "--out-root", "runs"]
    assert.equal(run("tools/recollect-batch.sh", args).status, 0)
    const marker = path.join(directory, "runs", "campaign", "brand", "embed.done")
    await assert.rejects(readFile(marker), /ENOENT/)
    assert.equal(run("tools/recollect-batch.sh", [...args, "--apply-embeddings"],
      {TEST_EMBED_FAIL: "1"}).status, 1)
    assert.equal(run("tools/recollect-batch.sh", [...args, "--apply-embeddings"]).status, 0)
    assert.equal(await readFile(marker, "utf8"), "")
  } finally { await rm(directory, {recursive: true, force: true}) }
})
