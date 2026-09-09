FROM golang:1.22-alpine AS build

WORKDIR /src

COPY go.mod ./
COPY go.sum ./
COPY main.go ./

RUN go mod download
RUN CGO_ENABLED=0 go build -o /out/cms-api .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=build /out/cms-api /app/cms-api

EXPOSE 8082

ENTRYPOINT ["/app/cms-api"]
