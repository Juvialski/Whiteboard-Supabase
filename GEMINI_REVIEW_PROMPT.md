# Optional AI Studio verification instruction

The supplied ZIP contains final file contents and should be pasted into matching
paths without rewriting them. AI Studio only needs to run:

```text
Run npm ci --include=dev, then npm run verify. Do not redesign the UI, weaken RLS,
change the secure share-token flow, add direct board_shards writes, split the
single authenticated board WebSocket, loosen CSP, or add paid infrastructure.
Report any build/test failure exactly before modifying code.
```
