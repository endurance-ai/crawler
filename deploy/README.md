# dev-app EC2 재수집 배치 셋업 (Phase 0 + Phase 1)

> 대상: dev-app EC2 (t4g.medium 4GB, ARM, Postgres + PostgREST shim 동거 호스트).
> 주의: 2026-05-26 마이그레이션 때 t4g.large→medium 다운스케일됨 — 리소스 캡과 swap 은 4GB 전제.
> 배경/설계: [`../docs/operations.md`](../docs/operations.md) §13 (큐 모델).
> 재수집 대상 엔진(cafe24/imweb=번들 chromium, shopify=fetch)은 ARM 에서 동작한다.
> `channel:'chrome'`(x86 필수)인 zara/farfetch/29cm 은 이 배치 대상이 아니다 (기존 로컬 플로우 유지).

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

일상 배치는 **갱신(kiko-refresh)** 이다 — 리스트만 훑어 재고/가격만 고친다.

```bash
sudo cp /opt/kiko-crawler/deploy/systemd/kiko-refresh.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiko-refresh.timer

# 수동 1회:
sudo systemctl start kiko-refresh.service
journalctl -u kiko-refresh -f
```

`kiko-recrawl.*` 는 온보딩급 재수집(상세 크롤 + LLM 재분류) 이라 **타이머로 돌리지
않는다** — 카테고리/색상을 다시 만들어야 할 때만 수동 실행한다. 두 경로의 차이는
`src/refresh-listing.ts` 헤더 참조.

## 4. 운영 규칙

- **리소스 캡**: `MemoryMax=1500M CPUQuota=150% Nice=15` — 4GB 에서 DB 동거의 전제 조건.
  완화는 CloudWatch 실측 근거로만 (t4g.large 리사이즈 시 3G 로 상향 가능).
- **갱신은 컬럼을 가려서 쓴다**: `refresh-listing` 은 `price/original_price/sale_price/
  in_stock` 만 UPDATE 한다. `import-products` 의 upsert 는 행 전체를 덮어쓰므로 갱신에
  쓰면 category/color/gender 가 날아간다 — 갱신 경로에서 import 를 호출하지 말 것.
- **리스트에 없는 상품**: 완전성 가드(`--min-coverage`, 기본 0.7) 를 통과한 런에서만
  품절 처리한다. 부분 실패한 크롤이 멀쩡한 상품을 대량으로 숨기는 사고를 막는 장치라
  임계값을 낮출 때는 근거가 필요하다.
- **신규 상품은 적재하지 않는다**: 갱신은 카테고리/성별을 만들지 않으므로(DB CHECK 필수)
  리스트에만 있는 신규 URL 은 카운트만 하고 넘긴다 — 온보딩 경로로 편입시켜야 한다.
- **신규 브랜드 편입**: 로컬 온보딩 → DB 등록 + config 커밋 → wrapper 의 git pull + codegen 이
  다음 런에 자동 반영. config 미등록 브랜드는 러너가 스킵하고 Discord 요약에 집계한다.
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
