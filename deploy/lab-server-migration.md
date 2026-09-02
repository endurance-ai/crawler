# 갱신 배치 연구실 서버 이사 (가격·재고 재수집)

대상: `kiko-refresh` / `kiko-refresh-candidates` 를 dev-app EC2 → 연구실 배치 서버로.
유닛: `deploy/systemd/lab/` (EC2 프로필 `deploy/systemd/` 은 컷오버 전까지 그대로 둔다)

> 이 문서는 **호스트가 바뀌면 무효가 되는 전제**들을 모은 것이다. EC2 절차서
> (`deploy/README.md`)를 그대로 따르면 안 되는 지점만 다룬다.

---

## 0. 실측한 서버 상태 (2026-07-31)

```
호스트   gpusystem (kjk@100.70.101.17)   Ubuntu 22.04.1 LTS · x86_64 · 12 core · 62GB
체크아웃 /home/kjk/kiko-crawler  (dev)   ← /opt 아님. 유닛 경로가 이걸 따라야 한다
툴체인   node v22.23.1 · corepack · pnpm  (모두 ~/.local/bin — systemd 기본 PATH 에 없음)
브라우저 playwright chromium-1217 설치됨 + /usr/bin/google-chrome 존재
env      .env / .env.local 존재. REFRESH_EXCLUDE 에 이미 연구실 전용 값(032c 차단)
sudo     비밀번호 필요. **단 유닛 설치에는 sudo 가 필요 없다** — Linger=yes 라
         user unit 으로 넣으면 로그인 없이 부팅 시 돈다 (§6)
```

이미 이 서버에서 refresh 를 돌려본 흔적이 있다(`REFRESH_EXCLUDE` 의 032c 주석).
체크아웃은 #54 시점이었고 `REFRESH_EXCLUDE` 로컬 수정으로 **dirty** 상태였다 —
그 상태로는 `git pull --ff-only` 가 막힌다(§1 의 바로 그 함정). 해당 수정은 이미
dev(#55)에 있어 stash 후 pull 했다.

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

> ⚠️ **정정 (2026-07-31 실측)**: 처음엔 "tailnet 주소로 붙여라" 라고 적었으나
> **dev-app 은 tailnet 에 없다.** `tailscale status` 상 노드는 gpusystem 과 macOS
> 하나뿐이다. 즉 현재로선 실행 불가능한 권고였다. 선택지는 셋이다 —
> (a) dev-app 을 tailnet 에 넣는다(인프라 작업), (b) shim 에 TLS 를 붙인다,
> (c) dev 환경이므로 감수한다. 어느 쪽이든 **평문 HTTP + Bearer 토큰이 공인
> 인터넷을 지난다**는 사실은 그대로다.

성능은 문제없다 — 연구실 서버에서 dev-app 까지 실측:

```
HTTP 404 (PostgREST 루트 정상 응답) · 8.6ms
참고: 개발 맥에서 잰 값은 p50 13ms
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

| concurrency | 한 패스 (추정) | 필요 예산 |
|---|---|---|
| 2 (EC2 기본) | 15.3h | 240분으로 완주 불가 |
| 4 | 7.7h | 480분 |
| 6 | 5.1h | 360분 |
| 8 | 3.8h | 240분 |

**EC2 에서 매일 못 돌던 진짜 원인은 동시성 2 + 예산 240분의 조합이다.** 워크리스트가
`last_attempted_at` 오름차순이라 결국 순환하긴 하지만 한 바퀴에 며칠 걸린다.

> ⚠️ 위 표는 **가격 상세 폴백(Step 3b) 이전** 추정치다. 실측은 아래.

### 첫 패스 실측 (2026-08-01) — concurrency 4

```
495분 소요 · 237/381 소스 · 예산 480분 소진으로 중단
가격변동 5,790 · 재고변동 5,409 · LLM후보 47,054 · 가드발동 21
가격복구(Step 3b) 125개 소스에서 발동   ← 사전 추정 42개보다 훨씬 넓었다
피크 RSS 4.5GB / 62GB · load 1.6 / 12 core · swap 0
```

한 패스 환산 **≈13시간**. 추정표(7.7h)보다 느린 이유는 가격 폴백이 125개 소스에
방문 시간을 더했기 때문이다 — "폴백 배포 후 다시 재라"고 적어둔 그대로다.

자원이 크게 남아 **`--concurrency=8`** 로 올렸다(≈6.5시간 → 480분 예산 안에 들어옴).
메모리는 선형 증가를 가정해도 ~9GB 라 여유가 크다.

**커버리지 효과** (한 패스 미완주 상태에서도):

| 지표 | 이사 전 | 첫 패스 후 |
|---|---|---|
| 7일 이내 갱신 | 85.1% | **93.4%** |
| 1일 이내 갱신 | 45.6% | **50.7%** |
| 성공 이력 없는 platform | 54개 / 재고 13,176 | **25개 / 6,125** |
| 재고 상품 | 88,411 | 92,427 |

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
6. deploy/systemd/lab/* 설치 → timer enable   ← **sudo 불필요, 아래**
7. (EC2 timer disable — **이미 완료됨**, 아래)
```

### 타이머 설치 — 권한 부여도 담당자 대기도 필요 없다

`sudo` 에는 비밀번호가 걸려 있지만(§0), **이 유닛들은 시스템 유닛일 이유가 없다.**
확인한 사실:

```
loginctl show-user kjk -p Linger   →  Linger=yes
systemctl --user is-system-running →  running
```

`Linger=yes` 면 **로그인 세션이 없어도 유저 매니저가 부팅 시 뜬다.** 시스템 유닛으로
얻는 것이 없고, user unit 은 `kjk` 가 자기 홈에 파일을 놓는 것이라 sudo 가 개입하지
않는다. 그래서 `deploy/systemd/lab/*` 는 user unit 으로 작성돼 있다 — `User=` 가 없고
(유저 매니저가 곧 `kjk`), `WantedBy=default.target` 이다.

```bash
mkdir -p ~/.config/systemd/user
cp ~/kiko-crawler/deploy/systemd/lab/* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kiko-refresh.timer
```

확인 · 운용:

```bash
systemctl --user list-timers --all | grep kiko
journalctl --user -u kiko-refresh -f
systemctl --user stop kiko-refresh.timer     # 멈출 때
```

> 시스템 유닛으로 가야 할 이유가 생긴다면(예: 유저 매니저와 무관한 부팅 순서 의존)
> 그때는 `sudo cp` → `sudo systemctl daemon-reload` → `sudo systemctl enable --now`
> 세 줄이고, `kjk` 가 비밀번호를 알면 직접 실행하면 된다. 별도 권한 부여는
> 그 경우에도 필요 없다.

> ✅ **EC2 배치는 이미 정지했다 (2026-07-29 09:38 KST 이후).** 확인 근거는
> `systemctl` 이 아니라 **DB 실행 이력**이다 — 타이머가 enabled 여도 서비스가 죽어
> 있으면 `systemctl` 만으로는 판단이 안 되기 때문이다.
>
> ```
> refresh-listing 런 (KST)
>   07-27  275건  00:01~23:44   ← 24시간 순환 = EC2 타이머 가동 중
>   07-28  391건  00:00~23:57
>   07-29  213건  00:01~09:38   ← 09:38 이후 중단
>   07-30    0건                 ← 타이머가 살아있다면 200~400건이 찍혀야 한다
> ```
>
> `product_crawl_runs` 의 `recrawl` 스테이지는 기록 자체가 없다.
>
> **EC2 는 영구 퇴역한다** (2026-07-31 결정). 갱신 배치의 유일한 실행 위치는 이제
> 연구실 서버다. 그래도 두 호스트 동시 실행이 위험하다는 사실은 남는다 — 중복
> 크롤에 `product_refresh_runs` 이력이 섞여 서킷브레이커 판정이 오염된다. EC2 에
> 다시 손댈 일이 생기면 `systemctl list-timers --all | grep kiko` 로 실제 상태부터 본다.

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

## 9. 성별 롤백 배포 (2026-08-03)

`products.gender` 출처가 VLM 에서 크롤러로 되돌아왔다. 연구실 배치에 영향이 있다.

### ~~코드는 자동으로 반영된다~~ → **더 이상 아니다 (2026-08-26 정정)**

> ⛔ 원문은 "`batch_prep()` 이 매 런 `git pull --ff-only` + `pnpm install` 을
> 돌리므로 **수동 배포 단계는 없다**" 였다. **지금은 틀렸다.** 배포 방식이
> 릴리스 디렉터리로 바뀌면서 자동 pull 이 꺼졌다. §9-1 을 볼 것.
>
> 이 서술을 믿고 방치한 결과, 실행 릴리스가 origin/dev 보다 **50 커밋 뒤**에서
> 멈춰 있었고 커밋되지 않은 핫패치 17개 파일이 서버에만 쌓여 있었다
> (2026-08-26 실측, PR #115 로 회수).

`kiko-refresh.service` 가 `OnSuccess=kiko-refresh-candidates.service` 로
연쇄한다는 것은 그대로다 — refresh 가 한 번 돌면 신규상품 워커가 이어서 돈다.

### 9-1. 실제 배포 방식 — 릴리스 디렉터리 + 심볼릭

```
~/kiko-crawler-runtime  ->  ~/kiko-crawler-releases/<YYYYMMDD>-<이름>   ← 실행되는 코드
~/kiko-crawler                                                          ← 별개 개발 체크아웃 (실행 안 됨)
```

systemd 유닛 둘 다 `WorkingDirectory=/home/kjk/kiko-crawler-runtime` 이고
`ExecStart` 도 그 경로다. 즉 **배포 = 새 릴리스를 만들고 심볼릭을 옮기는 것**이다.

유닛에 `Environment=BATCH_SKIP_UPDATE=true` 가 박혀 있고, `batch_prep()` 은 이
값이 켜져 있으면 `git pull` 과 `pnpm install` 을 건너뛴다 (`prep 3/3` codegen 만
돈다). **런타임을 핀 고정하는 것이 의도다** — 배치가 도는 도중에 코드가 바뀌지
않게 한다. 그러므로 `~/kiko-crawler-runtime` 에서 `git pull` 을 기대하지 말 것.

절차:

```bash
NEW=~/kiko-crawler-releases/$(date +%Y%m%d)-<이름>
git clone -q ~/kiko-crawler-runtime "$NEW"
cd "$NEW"
git remote set-url origin git@github.com:endurance-ai/crawler.git
git fetch -q origin dev && git checkout -q -B dev origin/dev
cp -p ~/kiko-crawler-runtime/.env ~/kiko-crawler-runtime/.env.local ./
corepack pnpm install --frozen-lockfile

# 검증 후에만 교체 — 배치가 전부 inactive 인지 먼저 확인한다
systemctl --user is-active kiko-refresh kiko-refresh-candidates \
  kiko-price-backfill kiko-product-images
node --test --import tsx ./tests/*.test.ts
ln -sfn "$NEW" ~/kiko-crawler-runtime
```

롤백은 심볼릭을 이전 릴리스로 되돌리는 한 줄이다. 이전 릴리스 디렉터리를
바로 지우지 말 것.

⚠️ `pnpm install` 후 `node_modules/.pnpm` 에 `@esbuild+linux-x64` 가 있는지
확인한다. 없으면 `tsx` 가 전부 죽는다 — 리포의 `pnpm-lock.yaml` 이 플랫폼
바이너리를 빠뜨린 이력이 있다(2026-08-26, 이 커밋에서 수정).

단 `run-refresh-candidates.sh` 는 `batch_prep` 을 부르지 않는다.

### [HARD] 배포 순서 — 이걸 어기면 신규상품 유입이 조용히 0 이 된다

```
1. sql/runbooks/2026-08-03-delete-gender-null.sql   (성별 미확인 행 삭제)
2. kiko.ai-app migration 103                        (canonical 밖 값 정리)
3. **크롤러 코드가 이 서버에 올라온 것을 확인**       ← 아래 검증
4. kiko.ai-app migration 104                        (CHECK + VALIDATE)
```

3 을 건너뛰고 4 를 적용하면 `chk_products_gender_required` 가 걸린 상태에서 옛
코드가 돌아 **신규상품 워커가 한 런치(예산 90분) 를 통째로 실패**한다. 가격·재고
UPDATE 는 계속 성공하므로 대시보드는 초록색인 채 유입만 멈춘다 — migration 099 가
기록한 color 사고와 같은 모양이다.

현재 운영은 `18:00 KST` 야간 1회다. refresh는 600분 예산·소스당 10분 재개 조각·
동시성 6·hard timeout 10시간 30분이며 성공 후 신규상품 워커가 `OnSuccess`로 이어진다. 가격·재고 행, 보조
`last_seen`, candidate, 실행 이력의 개별 DB 실패는 기록하고 다음 항목으로 넘어간다.
초기 worklist를 만들 수 없을 때만 전체 런이 실패한다.

2026-08-17 고정 24소스 audit(15분 claim window)에서 동시성 4는 17조각·14소스,
동시성 6은 27조각·23소스를 처리했고 둘 다 오류 0이었다. c6 메모리는 32GiB 가용,
swap 0이어서 일일 커버리지 기준으로 6을 채택했다.

운영 체크아웃은 `/home/kjk/kiko-crawler-runtime`이다. 작업용 dirty checkout과
분리하며 배치 안에서 git pull이나 pnpm install을 실행하지 않는다. 새 코드 배포는
runtime checkout을 명시적으로 fast-forward하고 검증한 뒤 수행한다.

검증:

```bash
ssh kjk@100.70.101.17
git -C /home/kjk/kiko-crawler-runtime log --oneline -1
grep -c . /home/kjk/kiko-crawler-runtime/src/lib/product-gender.ts
systemctl --user status kiko-refresh-candidates
```

배포 후 한 사이클 지나면 신규 행에 gender 가 실리는지 확인:

```sql
SELECT gender_source, count(*) FROM products
WHERE created_at > now() - interval '1 hour' GROUP BY 1;
```

### 예상되는 부작용: 신규 온보딩 브랜드의 수율 하락

성별을 확정하지 못한 상품은 **적재하지 않는다**. codegen 이 만드는
`platforms.generated.ts` 항목은 카테고리명이 `CatN` 플레이스홀더이고
`defaultGender` 도 없으므로, 상품명·URL 에 성별 신호가 없는 신규 브랜드는
상품이 전량 드랍될 수 있다.

대응: `pnpm propose:site-gender --allow-null-source` 로 후보를 뽑고, **사이트를
직접 확인한 뒤** `src/configs/gender-defaults.ts` 에 추가한다. 근거 없이 값을
넣지 말 것 — 특히 "성별 카테고리가 없다"는 unisex 의 근거가 아니라 "모름"이고,
unisex 는 검색에서 남녀 양쪽에 노출된다. 판단 기준은 그 파일 헤더에 있다.
