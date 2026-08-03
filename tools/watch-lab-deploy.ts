#!/usr/bin/env npx tsx
/**
 * 연구실 서버가 성별 롤백 코드를 받았는지 DB 신호로 확인한다.
 *
 * SSH 없이 확인하는 방법: 머지 이후 refresh-candidates 워커가 넣은 신규 행에
 * gender 가 실려 있으면 새 코드다. 구 코드는 gender 를 만들지 않으므로 NULL 로
 * 들어온다 (migration 104 적용 전이라 NULL INSERT 가 아직 가능하다).
 *
 * migration 104 는 이 확인이 끝난 뒤에만 적용할 것 — 구 코드가 도는 상태에서
 * CHECK 이 걸리면 15분마다 신규상품 INSERT 가 전량 실패하는데 가격·재고
 * UPDATE 는 계속 성공해 대시보드에 드러나지 않는다.
 */
import {createClient} from "@supabase/supabase-js"
const MERGED_AT = process.argv.find(a=>a.startsWith("--since="))?.split("=")[1] ?? "2026-08-03T07:36:38Z"
async function main(){
const db=createClient(process.env.DB_URL!,process.env.DB_TOKEN!)
const {data,count}=await db.from("products")
  .select("gender,gender_source,created_at,platform",{count:"exact"})
  .gt("created_at",MERGED_AT).order("created_at",{ascending:false}).limit(50)
const rows=(data??[]) as any[]
const withG=rows.filter(r=>Array.isArray(r.gender)&&r.gender.length>0).length
const nullG=rows.filter(r=>!r.gender||r.gender.length===0).length
const {count:nulls}=await db.from("products").select("*",{count:"exact",head:true}).is("gender",null)
console.log(`머지(${MERGED_AT}) 이후 신규 ${count ?? 0}건 · 표본 ${rows.length} (gender 있음 ${withG} / 없음 ${nullG})`)
console.log(`현재 gender IS NULL 총계: ${nulls}`)
for(const r of rows.slice(0,5)) console.log(`  ${String(r.created_at).slice(11,19)} ${String(r.platform).padEnd(16)} ${JSON.stringify(r.gender)} src=${r.gender_source}`)
if((count??0)===0) console.log(`\n⏳ 아직 신규 유입 없음 — 판정 불가`)
else if(nullG>0) console.log(`\n❌ 구 코드 흔적 (gender NULL 유입) — 104 적용 금지`)
else console.log(`\n✅ 신규 코드 확인 (전량 gender 보유) — 104 적용 가능`)
}
main()
