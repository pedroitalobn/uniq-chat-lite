FROM golang:1.25-alpine AS builder

RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o storychat ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates sqlite-libs tzdata

WORKDIR /app
COPY --from=builder /app/storychat .
COPY --from=builder /app/migrations ./migrations

RUN mkdir -p /app/sessions

EXPOSE 8080
CMD ["./storychat"]
