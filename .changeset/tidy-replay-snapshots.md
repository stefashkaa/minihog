---
'minihog': minor
---

Reuse serialized replay events and UTF-8 byte counts when batching requests. Preserve `beforeSend` redaction and custom property serialization. Omit nonvisual script nodes, comments, and head whitespace from snapshots by default, with a `slimDOMOptions` override for integrations that need them.
