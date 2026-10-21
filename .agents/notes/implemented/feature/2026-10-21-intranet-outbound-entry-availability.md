# Agent Note: Disable outbound feature entries without direct Internet access

Status: implemented

English | [中文](2026-10-21-intranet-outbound-entry-availability.zh.md)

## Problem

Intranet users need to see that automation and connector entries exist without opening a page only to encounter a large unavailable illustration. Deployment mode alone cannot distinguish a machine with working direct Internet access from one using a relay or offline resources.

## Decision

Deployment confirmation publishes the resource route's cached direct-connectivity result to the Client. No second probe implementation or relay connection is introduced. In intranet mode, automation and connector entries require enabled successful direct detection. Disabled detection, offline resources and failed or unconfirmed detection keep them grey and non-clickable with “当前网络环境不可达，请检查您的网络”. A relay is not direct connectivity. Internet-mode behavior and explicit administrator visibility remain unchanged.

The shared panel prevents alternate entry points from opening an unavailable page and closes an active page when availability is lost. Confirmed recovery enables the entry without reopening the page. Existing authentication refresh triggers update the result; native mode and background task scheduling are not changed.

## Alternatives considered

Browser online status does not establish public connectivity. Probing the backend establishes only backend reachability. Maintaining another probe and cache would allow the resource route and sidebar to disagree. Reusing the Host decision preserves one meaning of direct connectivity.

## Consequences

Tests cover disabled detection, direct success and failure, cached results, snapshot validation, disabled click behavior and recovery. The desktop-profile browser regression verifies retained disabled entries and exact tooltips in intranet mode, while expert and skill panels remain usable. Administrator-hidden entries remain absent rather than being restored by connectivity checks.
