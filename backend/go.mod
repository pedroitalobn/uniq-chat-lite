module github.com/uniq-chat/backend

go 1.25.0

require (
	github.com/gofiber/fiber/v2 v2.52.5
	github.com/gofiber/websocket/v2 v2.2.1
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/google/uuid v1.6.0
	github.com/joho/godotenv v1.5.1
	github.com/minio/minio-go/v7 v7.0.99
	github.com/nats-io/nats.go v1.49.0
	github.com/rabbitmq/amqp091-go v1.10.0
	github.com/rs/zerolog v1.34.0
	github.com/sashabaranov/go-openai v1.41.2
	github.com/stripe/stripe-go/v76 v76.25.0
	github.com/valyala/fasthttp v1.51.0
	go.mau.fi/whatsmeow v0.0.0-20260322133016-ce4daa5e5a86
	golang.org/x/crypto v0.48.0
	golang.org/x/net v0.50.0
	google.golang.org/protobuf v1.36.11
	gorm.io/driver/postgres v1.5.9
	gorm.io/driver/sqlite v1.5.6
	gorm.io/gorm v1.30.0
)

require (
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/andybalholm/brotli v1.0.5 // indirect
	github.com/beeper/argo-go v1.1.2 // indirect
	github.com/boombuler/barcode v1.0.1-0.20190219062509-6c824513bacc // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/elliotchance/orderedmap/v3 v3.1.0 // indirect
	github.com/fasthttp/websocket v1.5.3 // indirect
	github.com/go-ini/ini v1.67.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20231201235250-de7065d80cb9 // indirect
	github.com/jackc/pgx/v5 v5.5.5 // indirect
	github.com/jackc/puddle/v2 v2.2.1 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/klauspost/compress v1.18.2 // indirect
	github.com/klauspost/cpuid/v2 v2.2.11 // indirect
	github.com/klauspost/crc32 v1.3.0 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mattn/go-runewidth v0.0.15 // indirect
	github.com/mattn/go-sqlite3 v1.14.34 // indirect
	github.com/minio/crc64nvme v1.1.1 // indirect
	github.com/minio/md5-simd v1.1.2 // indirect
	github.com/nats-io/nkeys v0.4.12 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/petermattis/goid v0.0.0-20260113132338-7c7de50cc741 // indirect
	github.com/philhofer/fwd v1.2.0 // indirect
	github.com/pquerna/otp v1.5.0 // indirect
	github.com/rivo/uniseg v0.2.0 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/rs/xid v1.6.0 // indirect
	github.com/savsgio/gotils v0.0.0-20230208104028-c358bd845dee // indirect
	github.com/tinylib/msgp v1.6.1 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/tcplisten v1.0.0 // indirect
	github.com/vektah/gqlparser/v2 v2.5.27 // indirect
	go.mau.fi/libsignal v0.2.1 // indirect
	go.mau.fi/util v0.9.6 // indirect
	go.yaml.in/yaml/v3 v3.0.4 // indirect
	golang.org/x/exp v0.0.0-20260212183809-81e46e3db34a // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
	golang.org/x/text v0.34.0 // indirect
)

// Fork local do whatsmeow com cherry-picks de PRs upstream relevantes:
//   #1107 (poll vote LID), #1091 (range queries perf), #974 (GetManyPNsForLIDs),
//   #1101 (bulk insert), #749 (BuildContact), #1106 (pin edit attr).
// Pasta dentro de backend/ pra que o Docker build context (./backend)
// inclua o fork — sem isso o `go mod download` falha pq o path replace
// resolve fora do contexto. Veja CHANGELOG-WHATSMEOW.md na raiz.
replace go.mau.fi/whatsmeow => ./vendor-fork/whatsmeow
