ARG PARVIS_VERSION=dev
ARG ALPINE_MIRROR=mirrors.tuna.tsinghua.edu.cn/alpine
ARG DOCKER_MIRROR=docker.m.daocloud.io

FROM --platform=$BUILDPLATFORM ${DOCKER_MIRROR}/library/node:20 AS web-builder
ARG PARVIS_VERSION
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG DSH_ADMIN_PUBLIC_URL=/dsh-admin
ARG DSH_API_PUBLIC_URL=/dsh-api

ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always

WORKDIR /web

# 主控制台没有独立锁文件，组织管理端使用已有 package-lock.json。
# 先复制依赖清单，方便 Docker 复用依赖安装缓存。
COPY web/air/package.json ./air/package.json
COPY web/org-admin/package.json web/org-admin/package-lock.json ./org-admin/

RUN npm install --prefix /web/air --no-audit --no-fund
RUN npm ci --prefix /web/org-admin --no-audit --no-fund

COPY web/air ./air
COPY web/org-admin ./org-admin
RUN mkdir -p /web/build

RUN DISABLE_ESLINT_PLUGIN=true \
    REACT_APP_VERSION="$PARVIS_VERSION" \
    PUBLIC_URL="$DSH_ADMIN_PUBLIC_URL" \
    REACT_APP_SERVER="$DSH_API_PUBLIC_URL" \
    npm run build --prefix /web/air

RUN DISABLE_ESLINT_PLUGIN=true \
    REACT_APP_VERSION="$PARVIS_VERSION" \
    npm run build:unix --prefix /web/org-admin

FROM ${DOCKER_MIRROR}/library/golang:alpine AS go-builder
ARG PARVIS_VERSION
ARG GO_PROXY=https://goproxy.cn,direct
ARG ALPINE_MIRROR

ENV GOPROXY=$GO_PROXY

RUN sed -i "s#dl-cdn.alpinelinux.org/alpine#${ALPINE_MIRROR}#g" /etc/apk/repositories && \
    apk add --no-cache \
    gcc \
    musl-dev \
    sqlite-dev \
    build-base

ENV GO111MODULE=on \
    CGO_ENABLED=1 \
    GOOS=linux

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=web-builder /web/build ./web/build

RUN go build -trimpath \
    -ldflags "-s -w -X 'github.com/songquanpeng/one-api/common.Version=${PARVIS_VERSION}' -linkmode external -extldflags '-static'" \
    -o one-api

FROM ${DOCKER_MIRROR}/library/alpine:latest
ARG ALPINE_MIRROR

RUN sed -i "s#dl-cdn.alpinelinux.org/alpine#${ALPINE_MIRROR}#g" /etc/apk/repositories && \
    apk add --no-cache ca-certificates tzdata

COPY --from=go-builder /build/one-api /one-api

EXPOSE 3000 3001
WORKDIR /data
ENTRYPOINT ["/one-api"]
