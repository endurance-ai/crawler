# 갱신 배치 연구실 서버 이사 (가격·재고 재수집)

대상: `kiko-refresh` / `kiko-refresh-candidates` 를 dev-app EC2 → 연구실 배치 서버로.
유닛: `deploy/systemd/lab/` (EC2 프로필 `deploy/systemd/` 은 컷오버 전까지 그대로 둔다)

> 이 문서는 **호스트가 바뀌면 무효가 되는 전제**들을 모은 것이다. EC2 절차서
> (`deploy/README.md`)를 그대로 따르면 안 되는 지점만 다룬다.

---

## 1. 왜 그냥 복사하면 안 되나

EC2 유닛의 값 대부분이 **"4GB 호스트에서 Postgres 와 동거"** 라는 전제에서 나왔다.
연구실 서버는 DB 가 동거하지 않으므로 그 값들은 근거 없는 제약이 된다.

| EC2 값 | 왜 그랬나 | 연구실에서 |
|---|---|---|
| `MemoryMax=1500M` `CPUQuota=150%` `Nice=15` | 4GB 에서 Postgres 보호 | **존재 이유 소멸.** 그대로 옮기면 근거 없이 처리량만 깎는다. lab 유닛에서 비워 뒀다 |
| `--concurrency` 기본 2 | 같은 이유 | **처리량의 실제 레버.** §5 참조 |
| `CRAWLER_BROWSER_CHANNEL=chromium` | ARM 호스트에 Chrome 채널 없음 | x86 이면 제거 가능 (zara/farfetch 가 Chrome 채널을 선호) |
| `User=ec2-user` `HOME=/home/ec2-user` | — | `kjk` 로 |
| `DB_URL=http://<EC2 공인 IP>:3001` | 원래 localhost 였다가 공인 IP | §3 참조 |

## 2. ⚠️ 첫 실행의 함정 — 서킷브레이커가 EC2 실패 이력을 물려받는다

`refresh-listing` 은 `product_refresh_runs` 이력에서 **마지막 성공 이후 연속 실패**를
세어 3회부터 backoff 한다 (3회 12h / 4회 1일 / 5회 3일 / 6회 7일 / 7회+ 14일).
이 계산은 **호스트를 구분하지 않는다.**

그런데 지금 연쇄 중인 소스는 대부분 **EC2 네트워크에서 못 닿아서** 실패한 것이다
(실측 2026-07-30 기준 49개 소스, 대표적으로 `kith` `browns` `zara-kr` `zara-us`
`end` `intl` — 전부 해외). 연구실 네트워크에서는 닿을 수 있다.

→ **이사 후 첫 실행은 반드시 `--ignore-backoff`.**

```bash
# 첫 실행: backoff 무시하고 전 소스 시도 → 새 호스트 기준 성공/실패를 다시 쌓는다
sudo systemctl stop kiko-refresh.timer
/opt/kiko-crawler/scripts/run-refresh.sh --budget-minutes=240 --ignore-backoff
```

이 한 바퀴가 돌면 이력이 새 호스트 기준으로 갱신돼 이후엔 브레이커가 정상 동작한다.
빼먹으면 **연구실에서는 멀쩡히 닿는 소스가 최대 14일까지 격리된다.**

## 3. DB 접속 — 평문 공인 IP 를 그대로 쓰지 말 것

현재 `DB_URL=http://15.165.107.28:3001` (dev-app **공인 IP**, 평문 HTTP, Bearer 토큰).
EC2 안에서는 사실상 localhost 였기에 문제가 아니었다. 연구실에서 이대로 붙으면
**인터넷 구간에 서비스 토큰이 평문으로 흐른다.**

배치 서버가 tailnet(`100.70.x.x`)에 있으므로 dev-app 도 tailnet 주소로 붙이는 것이 맞다.

성능은 문제없다 — 원격 왕복 실측:

```
단건 왕복  min=8ms  p50=13ms  max=77ms
```

| 작업 | 왕복 수 | 추정 |
|---|---|---|
| `last_seen_at` 갱신 (한 바퀴 147,409행, 4KB 청크) | ~1,500 | **20초** |
| 같은 양을 단건 UPDATE 로 했다면 | 147,409 | 32분 ← 청킹이 필수였던 이유 |
| 변경분 단건 UPDATE (평균 32행/런 × 357소스) | 11,424 | **2.5분** |
| `fetchExistingRows` 페이징 (1,000행씩) | ~150 | 2초 |

즉 **원격화 후에도 UPDATE 는 병목이 아니다.** 한 바퀴 예산 대비 ~1% 다.
(EC2-local 기준 실측은 전체 76.8h 중 0.22% 였다. 원격에서도 결론 유지 →
배치 UPDATE 전환(C4)은 여전히 값어치 없음.)

## 4. `REFRESH_EXCLUDE` 재검토

호스트별로 못 닿는 소스를 config 수정 없이 건너뛰는 env 다. **EC2 네트워크 기준으로
채워진 값**이므로 이사 시 비우고 실측해야 한다. §2 의 첫 실행이 그 실측을 겸한다.

첫 실행 결과에서 여전히 실패하는 소스만 다시 넣는다. 항구적으로 못 닿는 소스는
서킷브레이커에 맡기지 말고 여기에 넣는 것이 맞다 — 브레이커는 14일마다 재시도한다.

## 5. 동시성·예산 — 목표는 매일 한 바퀴

병목은 UPDATE 가 아니라 **크롤 시간**이다. 느린 런일수록 갱신 건수는 적다 —
`yearsago` 6,474초에 updated **2건**, `cayl` 2,887초에 **0건**.

소스별 최근 런 1회씩 합산한 **한 패스 총 크롤시간 = 30.6시간** (357 소스, 평균 309초,
최장 `yearsago` 87.6분). 이것이 한 바퀴의 작업량이다.

| concurrency | 한 패스 | 필요 예산 |
|---|---|---|
| 2 (EC2 기본) | 15.3h | 240분으로 완주 불가 |
| **4 (lab 시작값)** | **7.7h** | **480분** |
| 6 | 5.1h | 360분 |
| 8 | 3.8h | 240분 |

**EC2 에서 매일 못 돌던 진짜 원인은 동시성 2 + 예산 240분의 조합이다.** 워크리스트가
`last_attempted_at` 오름차순이라 결국 순환하긴 하지만 한 바퀴에 며칠 걸린다.

lab 유닛은 **`--concurrency=4 --budget-minutes=480`** 으로 시작한다. 연속
타이머(`OnUnitInactiveSec=15min`)와 합쳐 하루 ~3바퀴가 되어 목표를 넘긴다.

### 상향 절차 — 한 패스 완주할 때마다 한 단계씩

| 볼 것 | 어디서 | 판단 |
|---|---|---|
| 피크 RSS / swap 진입 | `systemd-cgtop`, `/proc/meminfo` | 여유 있으면 4 → 6 |
| load avg / CPU | `uptime`, `vmstat` | 코어 수 대비 여유 확인 |
| 예산 소진 여부 | 런 로그 `⏱️ 예산 N분 소진` | 소진되면 완주 못한 것 → 예산 또는 동시성 ↑ |
| 소스별 소요 변화 | `product_refresh_runs.duration_ms` | 동시성 올렸는데 소스별 소요가 늘면 자원 경합 → 되돌린다 |

Playwright chromium 이 소스마다 뜨므로 **CPU 보다 메모리가 먼저 걸린다.** 근거 없이
한 번에 올리지 않는다.

> ⚠️ 가격 상세 폴백(§7)이 42개 소스에 방문 시간을 더한다. 그 코드가 배포된 뒤
> 한 패스를 **다시 재서** 예산·동시성을 재조정할 것. 위 30.6h 는 폴백 이전 값이다.

## 6. 순서

```
1. 체크아웃 + pnpm install --frozen-lockfile + playwright install chromium
2. /etc/kiko-crawler.env 작성 (DB_URL 은 tailnet 주소, DB_TOKEN, REFRESH_EXCLUDE= 비움)
3. probe 검증:  pnpm crawl --probe=<cafe24 키> / <imweb 키>
                pnpm refresh -- --dry-run     ← 워크리스트 + 🔌 서킷브레이커 대기 확인
4. **첫 실행 --ignore-backoff** (§2). 타이머 미기동 상태에서 수동 1회
5. 결과 검토 → REFRESH_EXCLUDE 확정, concurrency/리소스 캡 결정
6. deploy/systemd/lab/* 설치 → timer enable
7. EC2 쪽 timer disable (⚠️ 아래)
```

> ⚠️ **EC2 타이머를 반드시 끌 것.** 두 호스트가 동시에 돌면 같은 소스를 중복 크롤하고
> `product_refresh_runs` 이력이 섞여 서킷브레이커 판정이 오염된다.
> `deploy/README.md` 에 기록된 대로 `kiko-recrawl.timer` 는 문서상 "타이머로 안 돌림"
> 인데 실제로는 enabled 로 04:00 KST 발화하도록 설치돼 있다. 컷오버 전
> `systemctl list-timers --all | grep kiko` 로 **실제 상태를 확인**하고 끈다.

## 7. 커버리지 — 전 브랜드가 갱신되게 하는 나머지

이사만으로는 100% 가 안 된다. 실측(2026-07-30) 재고 88,411 기준 **85.1% 는 이미 7일
이내 갱신**되고 있고, 나머지 **54개 platform / 13,176건**이 갱신 성공 이력이 0이다.
원인이 셋으로 갈린다:

| # | 원인 | platform | 재고 | 조치 |
|---|---|---|---|---|
| A | 가격이 리스트에 없고 상세에만 있음 | 42 | 6,182 | **코드로 해결됨** — 가격 복구 전용 상세 방문(Step 3b) + 품질 경고를 완전성 가드에서 분리 |
| B | config 자체가 없음 (`products.platform` 이 `cafe24`/`shopify` 로 박힘) | 2 | 5,505 | 아래 절차 |
| C | config disabled (cateNo stale) | 10 | 1,489 | B 의 detect 가 cateNo 를 다시 뽑은 뒤 `DISABLED_KEYS` 에서 제거 |

### B·C 복구 절차 (도구는 이미 있다)

```bash
# 1) platform_type + cateNo 재탐지 (--preserve-status 는 이제 실제로 보존한다)
pnpm brand-crawl -- detect --platform-type=unknown --url=present \
  --preserve-status --limit=100 --concurrency=4

# 2) config 생성
pnpm exec dotenv -e .env.local -- tsx tools/generate-platform-configs.ts

# 3) orphan 상품의 platform 라벨 복구 (읽기전용 plan → apply)
pnpm exec dotenv -e .env.local -- tsx tools/repair-product-platforms.ts --plan=/tmp/p.json
pnpm exec dotenv -e .env.local -- tsx tools/repair-product-platforms.ts --apply=/tmp/p.json

# 4) 생성된 config 검증 크롤 후 커밋
```

> 3) 은 config 가 생긴 **뒤에** 돌려야 한다. 그 전에는 호스트가 어떤 config 에도
> 매칭되지 않아 `changes=0 unresolved=5,505` 로 한 건도 못 고친다 (실측).

## 8. 이사 후에 열리는 것

- **C1 재고 sweep** — `last_seen_at` 이 신뢰 가능해지는 시점은 **새 호스트에서 한 바퀴
  돈 뒤**다. 그 전에는 어떤 staleness sweep 도 위험하다 (스펙 그대로 돌리면 재고
  상품 85% 품절 처리 — `docs/operations.md` §6 머리 참조).
- **동시성 상향** — 위 §5.
- **해외 소스 회수** — `kith`/`browns`/`zara-*`/`end`/`intl` 등이 연구실 네트워크에서
  닿는지가 첫 실행에서 판명된다. 닿으면 그만큼 갱신 커버리지가 늘어난다.
- **신규 상품 큐 소진** — 워커 상한이 풀렸으므로(`--budget-minutes` + clamp 제거)
  `discovered` 31,901 이 줄기 시작해야 한다. 첫 런에서 건당 소요·토큰 비용을 재고
  예산(현재 90분)을 조정한다. `brand_unmatched` 44,466 은
  `tools/rematch-brand-unmatched.ts --apply` 로 41,423 건 회수 가능(실측).
