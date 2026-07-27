# 연구실 서버 배치 이관 Runbook

> 상태: 실행 대기
> 관련 PLAN:
> [`../.moai/plans/batch-server-migration-alert-signals-plan.md`](../.moai/plans/batch-server-migration-alert-signals-plan.md)
> 원칙: AWS의 앱/DB는 유지하고 크롤 배치 실행 책임만 연구실 서버로 옮긴다.

## 다른 PC에서 재개

```text
crawler/AGENTS.md,
crawler/.moai/plans/batch-server-migration-alert-signals-plan.md,
crawler/docs/batch-server-migration-runbook.md를 읽고 미완료 체크포인트부터 진행한다.
Phase 0 안정화 완료 전에는 catalog event 작업을 운영 배포하지 않는다.
기존 dirty 파일과 사용자 변경사항은 수정하거나 커밋하지 않는다.
```

## 0. 전환 규칙

- AWS와 연구실 서버에서 같은 batch를 동시에 실행하지 않는다.
- dry-run과 DB write가 없는 probe는 cutover 전에 연구실 서버에서 실행해도 된다.
- 첫 DB write pilot은 AWS timer를 끄고 기존 unit이 모두 inactive인 것을 확인한 뒤
  실행한다.
- `kiko-refresh` 성공 후 `kiko-refresh-candidates`가 실행된다.
- `kiko-recrawl`은 timer를 설치하지 않고 수동 실행한다.
- 전환 중 실패하면 연구실 timer를 먼저 중지한 뒤 AWS timer를 복구한다.
- 실제 host, key, token, env 값은 이 문서에 기록하지 않는다.

## 1. 체크포인트

| 단계 | 상태 | 완료 시각 | 근거/메모 |
| --- | --- | --- | --- |
| 연구실 서버 자원 통과 | TODO |  |  |
| DB 사설 연결 통과 | TODO |  |  |
| AWS 배포 SHA/unit 백업 | TODO |  |  |
| 연구실 runtime/test 통과 | TODO |  |  |
| AWS timer 정지 | TODO |  |  |
| 단일 source pilot 통과 | TODO |  |  |
| 전체 refresh/candidate 통과 | TODO |  |  |
| 연구실 timer 활성화 | TODO |  |  |
| 24~48시간 안정화 통과 | TODO |  |  |

`TODO`를 `DONE`으로 바꿀 때 실행 명령, 결과 요약, run ID를 근거/메모에 남긴다.

## 2. 연구실 서버 자원 확인

연구실 서버에서 실행한다.

```bash
date -Is
uname -a
uname -m
nproc
free -h
df -h /
systemctl --version | head -1
uptime
```

전체 배치 이관 통과 기준:

- Linux와 systemd 사용 가능
- 24시간 안정적으로 가동 가능
- batch가 사용할 수 있는 CPU 4코어 이상
- batch가 사용할 수 있는 RAM 8GB 이상
- root 또는 작업 볼륨 여유 20GB 이상

제한된 운영 기준:

- CPU 2코어/RAM 4GB 이상이면 `kiko-refresh`와 candidate concurrency 1만 허용한다.
- `recrawl-batch`는 필요할 때 다른 batch를 멈추고 수동 실행한다.
- CPU 2코어 또는 RAM 4GB 미만이면 이관하지 않는다.

서버가 다른 연구 작업과 자원을 공유한다면 총 사양이 아니라 **배치에 실제로 할당할
수 있는 자원**으로 판단한다.

## 3. AWS 현재 상태 기록

AWS에서 실행한다. 출력에 secret 값이 포함되지 않게 한다.

```bash
cd /opt/kiko-crawler
git branch --show-current
git rev-parse HEAD
git status --short

systemctl list-timers --all 'kiko-*'
systemctl is-active kiko-refresh.service
systemctl is-active kiko-refresh-candidates.service
systemctl is-active kiko-recrawl.service

systemctl cat kiko-refresh.service
systemctl cat kiko-refresh-candidates.service
systemctl cat kiko-recrawl.service
systemctl cat kiko-refresh.timer
systemctl cat kiko-recrawl.timer

journalctl -u kiko-refresh.service -n 200 --no-pager
journalctl -u kiko-refresh-candidates.service -n 200 --no-pager
journalctl -u kiko-recrawl.service -n 200 --no-pager
```

환경변수는 이름만 기록한다.

```bash
cd /opt/kiko-crawler
grep -hE '^[A-Z][A-Z0-9_]*=' .env .env.local 2>/dev/null \
  | cut -d= -f1 | sort -u
```

반드시 기록할 항목:

- 실제 배포 SHA
- 설치된 unit/drop-in의 전체 내용
- refresh와 recrawl timer의 활성 여부
- service의 실행 사용자, checkout 경로, resource limit
- 최근 성공 refresh와 candidate run 시각/메트릭
- 수동 pilot에 사용할 대표 source key

로컬 PC의 현재 HEAD를 배포 기준으로 추정하지 않는다. AWS에서 확인한 SHA가
lift-and-shift 기준이다.

## 4. DB 연결

연구실 서버에서 AWS PostgREST에 접근할 때 일반 인터넷에 DB를 공개하지 않는다.

### 선택 A: Tailscale/WireGuard

양쪽 서버에 설치 권한이 있고 PostgREST가 tailnet 경로에서 접근 가능하도록 제한할
수 있을 때 사용한다.

검증:

```bash
tailscale status
curl -fsS --max-time 5 "http://<aws-tailnet-address>:3001/" >/dev/null
```

`DB_URL`은 tailnet 주소를 사용한다. AWS security group이나 host firewall은 tailnet
인터페이스에서 필요한 포트만 허용한다.

### 선택 B: 지속형 SSH tunnel

PostgREST가 AWS localhost에만 bind되어 있거나 Tailscale 설치가 어려울 때 사용한다.
연구실 서버의 systemd가 다음 연결을 유지하도록 구성한다.

```bash
ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:3001:127.0.0.1:3001 \
  <aws-user>@<aws-host>
```

이 경우 연구실 서버의 `DB_URL`은 `http://127.0.0.1:3001`이다. interactive shell에
의존하지 않도록 tunnel용 systemd service와 재시작 정책을 먼저 설치한다.

### 연결 검증

secret을 출력하지 말고 status만 확인한다.

```bash
curl -fsS --max-time 5 "$DB_URL/" >/dev/null
curl -fsS --max-time 10 \
  -H "Authorization: Bearer $DB_TOKEN" \
  -H "apikey: $DB_TOKEN" \
  "$DB_URL/product_refresh_sources?select=platform_key&limit=1" >/dev/null
```

아래도 cutover 전에 각각 확인한다.

- Git 원격 저장소
- npm/pnpm registry
- Playwright browser 다운로드 또는 내부 mirror
- 대상 쇼핑몰 outbound HTTPS
- R2 endpoint
- OpenAI API
- Apify API

## 5. 연구실 서버 설치

경로와 service user는 다음 기본값을 사용한다.

```text
checkout: /opt/kiko-crawler
service user: kiko-crawler
runtime: Node.js 22 + corepack/pnpm
browser: Playwright Chromium
```

설치 개요:

```bash
sudo useradd --system --create-home --shell /bin/bash kiko-crawler
sudo mkdir -p /opt/kiko-crawler
sudo chown kiko-crawler:kiko-crawler /opt/kiko-crawler

sudo -u kiko-crawler git clone <crawler-repository> /opt/kiko-crawler
cd /opt/kiko-crawler
sudo -u kiko-crawler git checkout <aws-deployed-sha>
sudo -u kiko-crawler corepack pnpm install --frozen-lockfile
sudo -u kiko-crawler corepack pnpm exec playwright install chromium
```

Playwright OS 라이브러리는 연구실 서버 배포판의 공식 설치 방법으로 설치한다.
`playwright install --with-deps chromium`을 지원하는 Debian/Ubuntu 계열이면 우선
사용하고, 다른 배포판이면 누락 라이브러리를 명시적으로 설치한다.

환경 파일은 secure copy 등 별도 채널로 전달한다.

```bash
sudo chown kiko-crawler:kiko-crawler /opt/kiko-crawler/.env.local
sudo chmod 600 /opt/kiko-crawler/.env.local
```

다음 값이 연구실 환경에 맞는지 확인한다.

- `DB_URL`: tailnet 주소 또는 SSH tunnel localhost
- `DB_TOKEN`
- R2 관련 endpoint/key
- `OPENAI_API_KEY`
- `APIFY_TOKEN`
- `DISCORD_WEBHOOK_URL`
- `CRAWLER_BROWSER_CHANNEL=chromium`

env 파일이나 secret은 Git에 추가하지 않는다.

## 6. DB write 전 검증

연구실 서버에서 실행한다.

```bash
cd /opt/kiko-crawler
corepack pnpm typecheck
corepack pnpm test

corepack pnpm refresh -- --dry-run
corepack pnpm recrawl -- --dry-run
```

대표 source probe를 실행한다. probe는 대상 사이트별 실제 browser/network 동작을
확인하되 DB import를 수행하지 않아야 한다.

```bash
corepack pnpm crawl -- --probe=<representative-source>
```

통과 조건:

- typecheck/test 신규 실패 0
- DB read 성공
- worklist가 AWS 결과와 설명 가능한 범위에서 일치
- Playwright Chromium 시작 성공
- 대표 source에서 상품 목록 파싱 성공
- secret이 journal이나 console에 출력되지 않음

## 7. systemd 준비

repository의 unit을 연구실 서버용 service user와 경로에 맞게 설치한다. refresh
service의 `OnSuccess=kiko-refresh-candidates.service` 연결은 유지한다.

```bash
sudo cp deploy/systemd/kiko-refresh.service /etc/systemd/system/
sudo cp deploy/systemd/kiko-refresh.timer /etc/systemd/system/
sudo cp deploy/systemd/kiko-refresh-candidates.service /etc/systemd/system/
sudo cp deploy/systemd/kiko-recrawl.service /etc/systemd/system/
```

현재 repository unit은 AWS의 `ec2-user`를 사용한다. 연구실 서버에서는 unit을
시작하기 전에 세 service 모두에 아래 형식의 drop-in을 만든다.

```ini
# /etc/systemd/system/<service-name>.service.d/lab.conf
[Service]
User=kiko-crawler
Group=kiko-crawler
Environment=HOME=/home/kiko-crawler
```

적용 대상:

```text
kiko-refresh.service
kiko-refresh-candidates.service
kiko-recrawl.service
```

drop-in을 만든 뒤 반영하고 최종 합성 unit을 검토한다.

```bash
sudo systemctl daemon-reload
systemctl cat kiko-refresh.service
systemctl cat kiko-refresh-candidates.service
systemctl cat kiko-recrawl.service
```

unit 또는 drop-in에서 다음을 확인한다.

- `User=kiko-crawler`
- `WorkingDirectory=/opt/kiko-crawler`
- `Environment=HOME=/home/kiko-crawler`
- `CRAWLER_BROWSER_CHANNEL=chromium`
- host 자원에 맞는 `MemoryMax`, `CPUQuota`
- refresh timer의 `Persistent=true`
- recrawl timer는 설치하거나 enable하지 않음

이 단계에서는 아직 연구실 refresh timer를 enable하지 않는다.

## 8. Cold cutover

### 8.1 AWS 신규 실행 차단

먼저 timer만 중지한다. 실행 중 service를 즉시 kill하지 않는다.

```bash
sudo systemctl disable --now kiko-refresh.timer
sudo systemctl disable --now kiko-recrawl.timer
```

기존 실행이 끝날 때까지 기다린다.

```bash
systemctl is-active kiko-refresh.service
systemctl is-active kiko-refresh-candidates.service
systemctl is-active kiko-recrawl.service
```

세 unit이 모두 `inactive` 또는 `failed`이고, 실패 원인이 정리된 뒤에만 다음 단계로
간다. cutover 시각과 마지막 AWS run ID를 체크포인트에 기록한다.

### 8.2 연구실 단일 source pilot

AWS에서 기록한 대표 source 하나만 실행한다.

```bash
cd /opt/kiko-crawler
corepack pnpm refresh -- --site=<representative-source> --concurrency=1
```

검증 항목:

- refresh run이 success로 종료
- coverage가 기존 AWS 실행과 유사
- 가격/재고 update failure 0
- 신규 URL은 candidate로만 들어가고 직접 상품 insert하지 않음
- browser/process가 종료 후 남지 않음
- 메모리와 실행시간이 자원 기준 안에 있음

candidate가 생성됐다면 한 건만 처리한다.

```bash
corepack pnpm refresh:candidates -- --limit=1 --concurrency=1
```

QC 거절 또는 정상 import가 멱등하게 기록되는지 확인한다.

### 8.3 전체 수동 실행

```bash
corepack pnpm refresh -- --budget-minutes=240
corepack pnpm refresh:candidates -- --limit=50 --concurrency=1
```

`OnSuccess` unit 연결을 검증할 때는 command 직접 실행이 아니라 service로 한 번
실행한다.

```bash
sudo systemctl start kiko-refresh.service
journalctl -u kiko-refresh.service -f
```

refresh 종료 후 candidate service가 시작됐는지 별도 terminal에서 확인한다.

```bash
journalctl -u kiko-refresh-candidates.service -f
```

### 8.4 연구실 timer 활성화

전체 수동 실행이 성공한 뒤에만 활성화한다.

```bash
sudo systemctl enable --now kiko-refresh.timer
systemctl list-timers --all 'kiko-*'
```

AWS timer가 disabled이고 연구실 timer만 enabled인지 양쪽에서 확인한다.

## 9. 안정화 관측

최소 24~48시간 또는 2~3회전 동안 다음을 기록한다.

- refresh source 성공/실패 수와 coverage
- `product_refresh_runs` 실행시간과 update failure
- candidate discovered/imported/failed/rejected/brand_unmatched 수
- browser crash, OOM, timeout, HTTP 429/403
- `systemctl show <unit> -p MemoryPeak -p CPUUsageNSec`
- disk 증가량과 남은 공간
- SSH tunnel/Tailscale 재연결 여부

DB 확인 예시:

```sql
SELECT id, platform_key, status, started_at, ended_at, duration_ms, metrics,
       error_message
FROM product_refresh_runs
ORDER BY id DESC
LIMIT 30;

SELECT status, count(*)
FROM product_refresh_candidates
GROUP BY status
ORDER BY status;

SELECT platform_key, last_attempted_at, last_succeeded_at, last_status, last_error
FROM product_refresh_sources
ORDER BY last_attempted_at DESC NULLS LAST;
```

안정화 통과 기준:

- 예상한 timer 발화 누락 0
- refresh fatal failure 0
- DB update failure 0
- candidate worker가 backlog를 지속적으로 줄임
- OOM/강제 종료 0
- 메모리 peak가 설정 limit 안에 있고 다른 연구 작업에 영향 없음
- 네트워크 tunnel 장시간 단절 없음

통과 후 체크포인트에 `Phase 0 complete`와 마지막 확인 run ID를 기록한다. 그 다음
PLAN의 Phase 1 이벤트 schema 작업을 시작한다.

## 10. 롤백

연구실 서버에서 신규 실행을 먼저 차단한다.

```bash
sudo systemctl disable --now kiko-refresh.timer
```

실행 중 refresh/candidate/recrawl이 있으면 정상 종료를 기다린다. 즉시 종료가 필요한
장애라면 현재 run ID와 중단 원인을 기록한 뒤 해당 service만 stop한다.

AWS에서 unit 상태와 checkout SHA가 cutover 전 기록과 같은지 확인한 뒤 복구한다.

```bash
sudo systemctl enable --now kiko-refresh.timer
systemctl list-timers --all 'kiko-*'
```

`kiko-recrawl.timer`는 복구하지 않는다. recrawl은 어느 서버에서든 수동 실행 전용으로
유지한다.

롤백 후 확인:

- 연구실 timer disabled
- AWS refresh timer enabled
- 동시에 active인 refresh service가 없음
- 다음 AWS refresh run success
- candidate backlog가 다시 처리됨

## 11. 이관 후 다음 작업

서버 이관 안정화가 끝나면 아래 순서로 진행한다.

1. `product_refresh_*` migration 원장화
2. `product_state_history`, `catalog_events`, advisory lock
3. 가격/재고 observation과 기준선
4. 신규 상품 신상 event와 브랜드 세일 집계
5. 인스타/공홈 콘텐츠 source와 crawler
6. 후속 APNs/알림함 delivery
