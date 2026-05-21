#!/usr/bin/env python3
"""P4: manual research result -> JSON + manifest update (idempotent)."""
import json
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parent.parent
BRANDS = REPO / "data" / "brand-enrichment" / "brands"
MANIFEST = REPO / "data" / "brand-enrichment" / "manifest.jsonl"

NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

# 9 brands researched via WebSearch on 2026-05-21
UPDATES = [
    # 산산기어
    {
        "brand_id": 827, "brand_name": "산산기어",
        "instagram_handle": "sansan_gear",
        "instagram_url": "https://www.instagram.com/sansan_gear/",
        "homepage_url": None,
        "description_ko": "Sangyup Lee, Sanghyun Kim 등 한국 크리에이티브 그룹이 운영하는 서울 기반 패션·아웃도어 브랜드. 미래적 디자인과 스트리트웨어를 결합한 서바이벌 의류로 알려져 있다.",
        "description_original": "Seoul-based fashion brand by a Korean creative collective (Sangyup Lee, Sanghyun Kim), blending streetwear with futuristic outdoor/survival gear.",
        "founder": ["Sangyup Lee", "Sanghyun Kim"],
        "founded_year": None,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.95, "homepage_url": 0.0, "description": 0.85, "founder": 0.85, "founded_year": 0.0, "origin_country": 0.95, "overall": 0.85},
        "sources": [
            {"type": "press", "url": "https://www.complex.com/style/a/shinnie-park/san-san-gear-complexcon-brands-to-watch-2024", "title": "ComplexCon 2024 Brands to Watch", "fetched_at": NOW},
            {"type": "instagram", "url": "https://www.instagram.com/sansan_gear/", "title": "@sansan_gear", "fetched_at": NOW},
        ],
    },
    # 써저리
    {
        "brand_id": 813, "brand_name": "써저리",
        "instagram_handle": "sur8ery",
        "instagram_url": "https://www.instagram.com/sur8ery/",
        "homepage_url": "https://www.sur8ery.com",
        "description_ko": "서울 동대문구에 본사를 둔 한국 패션 브랜드. 디자이너 김서준이 운영한다.",
        "description_original": "Seoul-based Korean fashion brand operated by SEOJUN KIM, headquartered in Dongdaemun-gu.",
        "founder": ["SEOJUN KIM"],
        "founded_year": None,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.95, "homepage_url": 0.95, "description": 0.8, "founder": 0.9, "founded_year": 0.0, "origin_country": 0.95, "overall": 0.85},
        "sources": [
            {"type": "official", "url": "https://www.sur8ery.com/about", "title": "SURGERY (써저리) Contact/About", "fetched_at": NOW},
            {"type": "instagram", "url": "https://www.instagram.com/sur8ery/", "title": "@sur8ery", "fetched_at": NOW},
        ],
    },
    # 언더마이카
    {
        "brand_id": 817, "brand_name": "언더마이카",
        "instagram_handle": "undermycarpresents",
        "instagram_url": "https://www.instagram.com/undermycarpresents/",
        "homepage_url": "https://www.undermycar.co.kr",
        "description_ko": "서울 중구 다산로에 매장을 둔 한국 패션 브랜드. PUMA 등 글로벌 브랜드와 협업하며 럭셔리·빈티지 무드의 의류를 선보인다.",
        "description_original": "Seoul-based Korean fashion brand known for collaborations with global brands like PUMA, presenting luxury and vintage aesthetics.",
        "founder": [],
        "founded_year": None,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.95, "homepage_url": 0.95, "description": 0.8, "founder": 0.0, "founded_year": 0.0, "origin_country": 0.95, "overall": 0.7},
        "review_reasons": ["founder_unknown", "year_unknown"],
        "sources": [
            {"type": "official", "url": "https://www.undermycar.co.kr/", "title": "Undermycar Worldwide", "fetched_at": NOW},
            {"type": "instagram", "url": "https://www.instagram.com/undermycarpresents/", "title": "@undermycarpresents", "fetched_at": NOW},
        ],
    },
    # 오호스
    {
        "brand_id": 821, "brand_name": "오호스",
        "instagram_handle": "ojos.official",
        "instagram_url": "https://www.instagram.com/ojos.official/",
        "homepage_url": "https://ojos.kr",
        "description_ko": "디자이너 김예림이 설립한 한국 여성복 브랜드. 유틸리테리언한 미학과 해체적 요소를 결합하며, ASICS·atmos Tokyo와의 협업, 도쿄 오모테산도 플래그십 스토어 등 글로벌 입지를 넓혀가고 있다.",
        "description_original": "Korean womenswear brand founded by Yerim Kim, blending utilitarian aesthetics with deconstructed elements. Known for collaborations with ASICS, atmos Tokyo and a flagship in Omotesando, Tokyo.",
        "founder": ["Yerim Kim"],
        "founded_year": None,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.95, "homepage_url": 0.95, "description": 0.9, "founder": 0.9, "founded_year": 0.0, "origin_country": 0.95, "overall": 0.85},
        "sources": [
            {"type": "official", "url": "https://ojos.kr/", "title": "OJOS 오호스", "fetched_at": NOW},
            {"type": "press", "url": "https://www.highsnobiety.com/p/best-korean-brands/", "title": "Highsnobiety — 29 Korean Brands", "fetched_at": NOW},
        ],
    },
    # 탄산마그네슘
    {
        "brand_id": 1642, "brand_name": "탄산마그네슘",
        "instagram_handle": "tansanmagnesium.kr",
        "instagram_url": "https://www.instagram.com/tansanmagnesium.kr/",
        "homepage_url": None,
        "description_ko": "서울 성동구 연무장길에 플래그십 스토어를 둔 한국 패션 브랜드 'tansan.'.",
        "description_original": "Korean fashion brand 'tansan.' with a flagship store on Yeonmujang-gil, Seongdong-gu, Seoul.",
        "founder": [],
        "founded_year": None,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.95, "homepage_url": 0.0, "description": 0.65, "founder": 0.0, "founded_year": 0.0, "origin_country": 0.9, "overall": 0.55},
        "review_reasons": ["founder_unknown", "year_unknown", "limited_press_coverage"],
        "sources": [
            {"type": "instagram", "url": "https://www.instagram.com/tansanmagnesium.kr/", "title": "@tansanmagnesium.kr", "fetched_at": NOW},
        ],
    },
    # ADER error
    {
        "brand_id": 1673, "brand_name": "ADER error",
        "instagram_handle": "ader_error",
        "instagram_url": "https://www.instagram.com/ader_error/",
        "homepage_url": "https://adererror.com",
        "description_ko": "2014년 서울에서 익명의 한국 크리에이티브 그룹이 설립한 유니섹스 패션 브랜드. A는 aesthetic, D는 drawing, er은 행위자(people who do)를 의미하며, 'Error'는 불완전함의 표현으로 재해석된다.",
        "description_original": "Seoul-based unisex fashion brand founded in 2014 by an anonymous collective of Korean creatives. 'A' for aesthetic, 'D' for drawing, 'er' for people; 'Error' reinterpreted as imperfection.",
        "founder": [],
        "founded_year": 2014,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.9, "homepage_url": 0.9, "description": 0.95, "founder": 0.5, "founded_year": 0.95, "origin_country": 0.95, "overall": 0.85},
        "review_reasons": ["founder_anonymous_by_design"],
        "sources": [
            {"type": "press", "url": "https://www.farfetch.com/style-guide/street-style/ader-error-korean-design-collective-interview/", "title": "Farfetch — Ader Error Interview", "fetched_at": NOW},
            {"type": "press", "url": "https://hypebae.com/2018/5/ader-error-korean-design-collective", "title": "Hypebae — Ader Error Korean Design Collective", "fetched_at": NOW},
        ],
    },
    # 999휴머니티
    {
        "brand_id": 1265, "brand_name": "999휴머니티",
        "instagram_handle": "999humanity",
        "instagram_url": "https://www.instagram.com/999humanity/",
        "homepage_url": "https://999humanity.kr",
        "description_ko": "성별, 문화, 스타일의 경계를 넘는 포용적 디자인을 제안하는 한국 캐주얼 패션 브랜드. 뉴발란스와 'HUMANBALANCE' 협업으로 알려져 있으며, 성수동에 플래그십 스토어가 있다.",
        "description_original": "Korean fashion brand proposing inclusive design that transcends gender/culture/style boundaries. Known for the 'HUMANBALANCE' collaboration with New Balance and a flagship store in Seongsu.",
        "founder": [],
        "founded_year": None,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.95, "homepage_url": 0.95, "description": 0.85, "founder": 0.0, "founded_year": 0.0, "origin_country": 0.95, "overall": 0.7},
        "review_reasons": ["founder_unknown", "year_unknown"],
        "sources": [
            {"type": "official", "url": "https://999humanity.kr/", "title": "999휴머니티 공식 웹사이트", "fetched_at": NOW},
            {"type": "press", "url": "https://www.marieclairekorea.com/fashion/2023/09/humanbalance/", "title": "Marie Claire Korea — HUMANBALANCE", "fetched_at": NOW},
        ],
    },
    # 타일레
    {
        "brand_id": 1250, "brand_name": "타일레",
        "instagram_handle": "taille.official",
        "instagram_url": "https://www.instagram.com/taille.official/",
        "homepage_url": "https://taille.kr",
        "description_ko": "한국의 여성복 브랜드 Taille. 무신사 등 주요 한국 패션 플랫폼에서 유통된다.",
        "description_original": "Korean womenswear brand Taille, distributed via major Korean fashion platforms including Musinsa.",
        "founder": [],
        "founded_year": None,
        "origin_country": "KR",
        "confidence": {"instagram_handle": 0.95, "homepage_url": 0.95, "description": 0.6, "founder": 0.0, "founded_year": 0.0, "origin_country": 0.9, "overall": 0.55},
        "review_reasons": ["founder_unknown", "year_unknown", "limited_press_coverage"],
        "sources": [
            {"type": "official", "url": "https://taille.kr/", "title": "TAILLE 타일레", "fetched_at": NOW},
            {"type": "instagram", "url": "https://www.instagram.com/taille.official/", "title": "@taille.official", "fetched_at": NOW},
        ],
    },
    # Aleksandre Akhalkatsishvili
    {
        "brand_id": 1023, "brand_name": "Aleksandre Akhalkatsishvili",
        "instagram_handle": "aleksandre_akhalkatsishvili",
        "instagram_url": "https://www.instagram.com/aleksandre_akhalkatsishvili/",
        "homepage_url": "https://akhalkatsishvili.com",
        "description_ko": "조지아 트빌리시 출신 디자이너 Aleksandre Akhalkatsishvili가 2018년 런칭한 동명 브랜드. 트빌리시 국립예술원 졸업, 2015 Be Next Fashion Design Contest 수상. 해체주의 미니멀리즘을 철학으로 직선 실루엣과 남성성·여성성의 결합이 특징.",
        "description_original": "Eponymous label launched in 2018 by Georgian designer Aleksandre Akhalkatsishvili (Tbilisi State Academy of Arts graduate, Be Next Fashion Design Contest 2015 winner). Deconstructive minimalism, straight-line silhouettes, masc/femme fusion.",
        "founder": ["Aleksandre Akhalkatsishvili"],
        "founded_year": 2018,
        "origin_country": "GE",
        "confidence": {"instagram_handle": 0.7, "homepage_url": 0.95, "description": 0.95, "founder": 0.95, "founded_year": 0.95, "origin_country": 0.95, "overall": 0.9},
        "sources": [
            {"type": "official", "url": "https://akhalkatsishvili.com/about/", "title": "About — Aleksandre Akhalkatsishvili", "fetched_at": NOW},
            {"type": "press", "url": "https://www.modaoperandi.com/editorial/aleksandre-akhalkatsishvili-tbilisi-fashion-week-interview", "title": "Moda Operandi — Tbilisi FW Interview", "fetched_at": NOW},
        ],
    },
]


def determine_status(reasons, overall):
    if reasons:
        return "review"
    if overall < 0.7:
        return "review"
    return "ok"


def main():
    # Load existing manifest into dict (brand_id -> last entry)
    manifest_by_id = {}
    order = []
    for line in MANIFEST.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r["brand_id"] not in manifest_by_id:
            order.append(r["brand_id"])
        manifest_by_id[r["brand_id"]] = r

    updated = []
    for u in UPDATES:
        bid = u["brand_id"]
        path = BRANDS / f"{bid}.json"
        # Load existing JSON (preserve brand_name_normalized etc)
        existing = json.loads(path.read_text()) if path.exists() else {}
        data = {**existing, **u}
        data.setdefault("schema_version", "1.0")
        data.setdefault("description_source_lang", "ko" if any('가' <= c <= '힣' for c in (data.get("description_ko") or "")) else "en")
        data.setdefault("brand_name_normalized", (data.get("brand_name") or "").lower())
        data["processed_at"] = NOW
        data["processed_by_session"] = "p4-manual-2026-05-21"
        # Remove stale ig_handle_guess if real IG confirmed
        if data.get("instagram_handle"):
            data.pop("ig_handle_guess", None)

        cf = data.get("confidence", {})
        overall = cf.get("overall", 0.5)
        reasons = data.get("review_reasons") or []
        status = determine_status(reasons, overall)

        # Write brand JSON
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2))

        # Update manifest entry
        manifest_by_id[bid] = {
            "brand_id": bid,
            "brand_name": data.get("brand_name"),
            "status": status,
            "confidence": overall,
            "ts": NOW,
            "reason": ",".join(reasons) or None,
        }
        updated.append((bid, data.get("brand_name"), status, overall))

    # Rewrite manifest deduped
    with MANIFEST.open("w") as f:
        for bid in order:
            f.write(json.dumps(manifest_by_id[bid], ensure_ascii=False) + "\n")
        # Append any new ids not in order (shouldn't happen here)
        for bid in manifest_by_id:
            if bid not in order:
                f.write(json.dumps(manifest_by_id[bid], ensure_ascii=False) + "\n")

    print(f"✅ Updated {len(updated)} brands:")
    for bid, name, status, conf in updated:
        print(f"   id={bid:5}  {name[:25]:25}  status={status:8}  conf={conf}")

    # Final manifest counts
    from collections import Counter
    counter = Counter(r["status"] for r in manifest_by_id.values())
    print(f"\n📊 Manifest after update: total={sum(counter.values())}")
    for s, n in counter.most_common():
        print(f"   {s:10}: {n}")


if __name__ == "__main__":
    main()
