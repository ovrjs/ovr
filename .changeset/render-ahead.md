---
"ovr": patch
---

A child renders at most about 256 KB before its turn.

Children beside each other start together, and those after the one being sent queue what they render. One that streams a lot, such as a large list from a generator, behind one that is slow was rendered whole into memory before any of it was sent: 32 MB in a test. It now stops about 256 KB ahead and goes on as it is read. What each child waits for still starts as soon as the page does.
