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

알람 액션은 기존 알림 채널(SNS→Discord/이메일)로 연결.

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
corepack pnpm exec playwright install chromium --with-deps   # ARM chromium

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

```bash
sudo cp /opt/kiko-crawler/deploy/systemd/kiko-recrawl.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiko-recrawl.timer

# 수동 1회 (파일럿):
sudo systemctl start kiko-recrawl.service
journalctl -u kiko-recrawl -f
```

파일럿 기간에는 service 의 `ExecStart` 를 `--budget-minutes=240 --limit=200` 으로
제한해 수일 관측 후(브랜드당 p50/p95, 메모리 피크) limit 을 해제한다.

## 4. 운영 규칙

- **리소스 캡**: `MemoryMax=1500M CPUQuota=150% Nice=15` — 4GB 에서 DB 동거의 전제 조건.
  완화는 CloudWatch 실측 근거로만 (t4g.large 리사이즈 시 3G 로 상향 가능).
- **재수집은 게이트 ON**: 러너는 기존 crawl/import 경로를 그대로 쓴다.
  `CRAWLER_VALIDATION_ENABLED=false` 류 게이트 OFF 는 온보딩 크롤 전용 — 서버 env 에 넣지 말 것.
- **신규 브랜드 편입**: 로컬 온보딩 → DB 등록 + config 커밋 → wrapper 의 git pull + codegen 이
  다음 런에 자동 반영. config 미등록 브랜드는 러너가 스킵하고 Discord 요약에 집계한다.
- **디스크**: `data/*.json` 은 런마다 갱신 누적 — disk 알람 발화 시 오래된 파일 정리.
