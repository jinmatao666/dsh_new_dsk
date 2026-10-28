# Agent Note: Cap OpenBLAS threads in GIS expert containers

Status: implemented

English | [中文](2026-10-28-gis-expert-openblas-thread-cap.zh.md)

## Problem

Coordinate-transform, GIS format conversion, and CAD redline extraction containers set `pids_limit: 128`. Importing `ezdxf` pulls in NumPy/OpenBLAS, which tried to create dozens of threads and failed with `pthread_create ... Resource temporarily unavailable`. The conversion subprocess then exited non-zero; the worker surfaced the generic “文件处理失败” message and discarded stderr, so Docker logs often showed only an unrelated ezdxf cache warning. Local preview had no such PID cap, so the same upload succeeded on the developer machine.

## Decision

Set `OPENBLAS_NUM_THREADS`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS`, and `NUMEXPR_NUM_THREADS` to `1` in each of the three experts’ `compose.yml`, `compose.local-xinference.yml`, and `Dockerfile` `ENV`, so both Compose recreates and rebuilt images keep BLAS single-threaded under the existing PID budget.

## Alternatives considered

Raising `pids_limit` alone — rejected as the primary fix; BLAS still over-threads relative to the two-CPU quota and wastes PIDs that nested converters may need.

## Consequences

Production can recreate the Compose service after pulling the updated compose file (or inject the same variables into `.env`) without waiting for a full image rebuild; a rebuild still bakes the defaults into the image. GIS conversion and redline tasks that also import `ezdxf` inherit the same protection.

## Required verification

On the deployed host, after recreate: `docker compose -p wanwei-coordinate-transform exec expert python -c "import ezdxf, pyproj; print('ok')"` succeeds, and a small EPSG CSV task finishes without the generic processing-failure message.
