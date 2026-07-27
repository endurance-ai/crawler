# dev-app EC2 재수집 배치 셋업 (Phase 0 + Phase 1)

> **이관 예정:** 크롤 배치를 AWS 동거 호스트에서 연구실 서버로 옮기는 최신 계획과
> 실행 순서는 [`../.moai/plans/batch-server-migration-alert-signals-plan.md`](../.moai/plans/batch-server-migration-alert-signals-plan.md),
> [`../docs/batch-server-migration-runbook.md`](../docs/batch-server-migration-runbook.md)를 따른다.
> 본 문서의 AWS 절차는 현재 운영 상태와 롤백 기준을 확인하기 위해 보존한다.
>
> 대상: dev-app EC2 (t4g.medium 4GB, ARM, Postgres + PostgREST shim 동거 호스트).
> 주의: 2026-05-26 마이그레이션 때 t4g.large→medium 다운스케일됨 — 리소스 캡과 swap 은 4GB 전제.
> 배경/설계: [`../docs/operations.md`](../docs/operations.md) §13 (큐 모델).
> 갱신 워크리스트는 브랜드가 아니라 `platform_key` 단위이며 등록된 모든 엔진을
> dispatch한다. 엔진별 브라우저 런타임 요구사항은 배포 전 probe로 확인한다.

## 0. 순서 요약

1. 리소스 모니터링 (CloudWatch agent + 알람) ← **크롤 배치 도입 전 베이스라인 1일+ 확보**
2. 크롤러 설치 + probe 검증
3. systemd timer 설치 → 수동 1회 실행 → 파일럿(--limit=200 유지 수일)

## 1. swap + 리소스 모니터링 (선행)

물리 4GB 에 db 컨테이너 캡(3G)이 이미 있으므로 크롤러 도입 전 swap 4GB 를 만든다:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```bash
# CloudWatch agent 설치 (Amazon Linux 2023 ARM)
sudo dnf install -y amazon-cloudwatch-agent

# 설정 배치 (이 리포의 deploy/cloudwatch/amazon-cloudwatch-agent.json)
sudo cp /opt/kiko-crawler/deploy/cloudwatch/amazon-cloudwatch-agent.json \
  /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
```

> EC2 인스턴스 롤에 `CloudWatchAgentServerPolicy` 가 부착되어 있어야 한다.

알람 2개 (콘솔 또는 CLI, 네임스페이스 `KikoCrawler`):

| 알람 | 조건 | 이유 |
|---|---|---|
| `kiko-devapp-mem-high` | `mem_used_percent > 85` (5분 2회) | Postgres 보호 — 크롤러 폭주 조기 감지 |
| `kiko-devapp-disk-high` | `disk used_percent > 80` (/) | data/*.json 누적 + WAL |

알람 액션은 SNS 토픽 `kiko-devapp-alerts` 로 연결 (계정에 기존 알림 채널이 없어 신규 생성).

## 2. 크롤러 설치

```bash
# Node 22 (x86 스니펫과 달리 ARM 도 nodesource 동일)
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs git
corepack enable

sudo git clone <crawler-repo> /opt/kiko-crawler
sudo chown -R ec2-user:ec2-user /opt/kiko-crawler
cd /opt/kiko-crawler
corepack pnpm install --frozen-lockfile

# ARM chromium — playwright 의 --with-deps 는 apt 전용이라 AL2023 에서 실패한다.
# 시스템 라이브러리는 dnf 로 직접 깔고, 브라우저만 playwright 로 받는다.
sudo dnf install -y alsa-lib atk at-spi2-atk at-spi2-core cups-libs libdrm \
  libXcomposite libXdamage libXfixes libXrandr libxkbcommon mesa-libgbm nss pango
corepack pnpm exec playwright install chromium

# env — DB 는 같은 호스트이므로 localhost
cat > .env.local <<'EOF'
DB_URL=http://localhost:3001
DB_TOKEN=<service token>
DISCORD_WEBHOOK_URL=<optional — recrawl 요약/실패 알림>
EOF
# .env 에 R2 키 등 크롤 스테이지 환경 배치 (.env.example 참조)
```

검증:

```bash
corepack pnpm crawl --probe=<cafe24 키>     # ARM chromium 동작 확인
corepack pnpm crawl --probe=<imweb 키>
curl -fsS localhost:3001/ >/dev/null && echo "DB OK"
corepack pnpm recrawl -- --dry-run           # 워크리스트 확인 (크롤 없음)
```

## 3. systemd 배치

일상 배치는 **갱신(kiko-refresh)** 이다. 한 런이 끝난 뒤 15분 후 다시 시작해
새벽에만 몰지 않고 source queue를 계속 순환한다. 리스트에서 기존 상품의
재고/가격만 직접 고치고, 신규 URL은 별도 LLM 후보 큐로 보낸다.

```bash
sudo cp /opt/kiko-crawler/deploy/systemd/kiko-refresh.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiko-refresh.timer

# 수동 1회:
sudo systemctl start kiko-refresh.service
journalctl -u kiko-refresh -f
journalctl -u kiko-refresh-candidates -f
```

`kiko-recrawl.*` 는 온보딩급 재수집(상세 크롤 + LLM 재분류) 이라 **타이머로 돌리지
않는다** — 카테고리/색상을 다시 만들어야 할 때만 수동 실행한다. 두 경로의 차이는
`src/refresh-listing.ts` 헤더 참조.

## 4. 운영 규칙

- **리소스 캡**: `MemoryMax=1500M CPUQuota=150% Nice=15` — 4GB 에서 DB 동거의 전제 조건.
  완화는 CloudWatch 실측 근거로만 (t4g.large 리사이즈 시 3G 로 상향 가능).
- **갱신 병렬도**: `refresh-listing` 기본값은 서로 다른 브랜드 2개 동시 실행이다.
  Cafe24 목록은 상품 DOM이 준비되는 즉시 진행하고(고정 3초 sleep 없음), 빈/AJAX
  목록만 최대 3초 기다린다. `--concurrency` 상향은 배치 중 메모리 실측 후에만 한다.
- **갱신은 컬럼을 가려서 쓴다**: `refresh-listing` 은 `price/original_price/sale_price/
  in_stock` 만 UPDATE 한다. `import-products` 의 upsert 는 행 전체를 덮어쓰므로 갱신에
  쓰면 category/color/gender 가 날아간다 — 갱신 경로에서 import 를 호출하지 말 것.
- **리스트에 없는 상품**: 완전성 가드(`--min-coverage`, 기본 0.7) 를 통과한 런에서만
  품절 처리한다. 부분 실패한 크롤이 멀쩡한 상품을 대량으로 숨기는 사고를 막는 장치라
  임계값을 낮출 때는 근거가 필요하다.
- **신규 상품은 LLM worker만 적재한다**: 리스트에만 있는 URL은
  `product_refresh_candidates`로 보내고, 기존 `brand_nodes`와 정확히 하나로
  매칭된 후보만 상세 추출 → LLM → QC/validation을 거쳐 적재한다.
- **신규 브랜드는 절대 만들지 않는다**: 브랜드가 없거나 중복 매칭되는 후보는
  `brand_unmatched`에 남는다. refresh와 후보 worker 어느 쪽도 `brand_nodes`를 INSERT하지 않는다.
- **신규 source도 자동 편입하지 않는다**: 갱신 대상은 코드에 이미 등록된 config 중
  DB에 기존 상품이 있는 `platform_key`뿐이다. 신규 브랜드/source 온보딩은 기존 수동 절차를 따른다.
- **디스크**: `data/*.json` 은 런마다 갱신 누적 — disk 알람 발화 시 오래된 파일 정리.

## 5. 배포 기록 (2026-07-18)

위 절차대로 dev-app 에 설치 완료. 현재 상태와 식별자:

| 항목 | 값 |
|---|---|
| 호스트 | `ec2-user@15.165.107.28` (i-01956ed16d12ee792, t4g.medium) |
| 체크아웃 | `/opt/kiko-crawler` (dev 브랜치, deploy key `dev-app EC2 (recrawl batch, read-only)`) |
| 타이머 | `kiko-recrawl.timer` **enabled** — 매일 04:00 KST |
| 파일럿 제한 | `/etc/systemd/system/kiko-recrawl.service.d/pilot-limit.conf` (`--limit=200`) — 관측 후 이 파일 삭제로 해제 |
| 알림 | SNS `kiko-devapp-alerts` → 이메일 |
| 검증 | DB OK · cafe24(rense)/imweb(heretic) probe 통과 · `recrawl --dry-run` 워크리스트 86브랜드 |

설치 중 절차서와 어긋났던 지점 (재설치 시 주의):

1. **인스턴스 스펙**: 설계는 t4g.large(8GB) 전제였으나 실제는 **t4g.medium(4GB)** — 2026-05-26 마이그레이션 때 다운스케일됨. `MemoryMax` 를 3G→1500M 로 낮추고 swap 4GB 를 추가했다.
2. **IAM**: `dev-app-ec2-role` 에 `CloudWatchAgentServerPolicy` 가 없어 `PutMetricData` 가 403 이었다. 주의할 점은 **agent 기동 직후 로그에는 오류가 없다** — 첫 flush(1분 후)에야 `E! AccessDenied` 가 찍히므로, 기동 확인만으로 성공 판정하면 안 되고 `list-metrics` 로 실제 도착을 봐야 한다.
3. **playwright**: `--with-deps` 는 apt 전용이라 AL2023 에서 실패 (§2 참조).
4. **deploy key**: org 정책에서 deploy key 가 비활성이라 등록이 거부됐다. 조직 설정에서 허용으로 바꾼 뒤 등록.
5. **disk 알람 디멘전**: `disk_used_percent` 는 `InstanceId` 만으로는 매칭되지 않는다 — `path=/`, `device=nvme0n1p1`, `fstype=xfs` 를 모두 지정해야 한다 (mem 은 `InstanceId` 만으로 충분).
