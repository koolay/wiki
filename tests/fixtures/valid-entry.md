---
title: "Separation of Concerns"
date: 2026-06-28
summary: "Divide programs into distinct sections handling distinct concerns."
status: published
tags:
  - design-principles
  - architecture
keywords:
  - separation of concerns
  - modularity
applies_to:
  - "structuring large codebases"
  - "reducing coupling"
---

## 背景

Programs grow complex quickly.

## 核心思想

Each module should address a separate concern.

## 实践要点

- Split UI, business logic, and data access
- Avoid cross-layer imports

## 权衡与反模式

Over-separation creates unnecessary indirection.

## 参考

- Dijkstra, 1974
