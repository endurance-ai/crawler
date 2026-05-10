# Project Interview

Project: endurance-ai/crawler
Date: 2026-05-05
Mode: existing-project

## Round 1: Ownership and Purpose
Question: 이 crawler 리포의 현재 소유/방향을 어떻게 정의할까요?
Answer: Active product being developed further — kiko.ai 의 SKU 공급원으로 계속 확장 중. ZARA / H&M / 유니클로 등 신규 해외 SPA 플랫폼 추가가 다음 마일스톤. 문서는 현재 구조 + 로드맵을 함께 반영해야 함.

## Round 2: Constraints and Non-Goals
Question: 알려진 제약/기술부채는?
Answer: Anti-bot + scrape ethics — robots.txt / ToS 준수가 핵심 제약. IP 차단 우회 / CAPTCHA 강제 풀이 금지. rate limit 필수. 추가로 인지된 제약: (1) Supabase 스키마는 kiko.ai 소유 — crawler 는 write-only, 스키마 변경 금지. (2) 테스트/린트 인프라 부재 (typecheck only). (3) R2 통합 미완성.

## Round 3: Documentation Priority
Question: 문서에서 가장 정확하게 담아야 할 것은?
Answer: Engine 추상화 + 신규 플랫폼 추가 가이드 — Cafe24Engine / ShopifyEngine 의 계약, SiteConfig 스키마, 새 플랫폼 등록 절차가 1순위. 다음 세션 작업이 이 영역(6개 신규 플랫폼)이라 doc 정확도가 곧바로 작업 품질에 직결됨.
