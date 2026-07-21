import { useCallback, useEffect, useRef, useState } from 'react'

/* Live-Sync gegen server.py: /sync/all pollen, /sync/admin mit CAS schreiben. */
export function useSync() {
  const [records, setRecords] = useState({})
  const [online, setOnline] = useState(false)
  const recRef = useRef({})

  const poll = useCallback(async () => {
    try {
      const r = await fetch('/sync/all', { cache: 'no-store' })
      if (!r.ok) throw new Error()
      const data = await r.json()
      const next = {}
      for (const [cid, rec] of Object.entries(data)) {
        if (cid.startsWith('__')) continue
        if (!rec || typeof rec.state !== 'string') continue
        try {
          next[cid] = {
            cid,
            rev: rec.rev || 0,
            ts: rec.ts || 0,
            state: JSON.parse(rec.state),
            raw: rec.state,
            profile: rec.profile ? JSON.parse(rec.profile) : null,
          }
        } catch { /* defekter Datensatz – überspringen */ }
      }
      recRef.current = next
      setRecords(next)
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
  }, [poll])

  /* CAS-Schreiben: bei 409 Server-Stand übernehmen und Mutation erneut anwenden. */
  const write = useCallback(async (cid, mut) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const rec = recRef.current[cid]
      if (!rec) return false
      const st = JSON.parse(JSON.stringify(rec.state))
      mut(st)
      const raw = JSON.stringify(st)
      try {
        const r = await fetch('/sync/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cid, state: raw, ts: Date.now(), baseRev: rec.rev }),
        })
        const j = await r.json().catch(() => null)
        if (r.status === 409) {
          if (j && typeof j.state === 'string') {
            recRef.current = {
              ...recRef.current,
              [cid]: { ...rec, rev: j.rev, raw: j.state, state: JSON.parse(j.state) },
            }
          }
          continue
        }
        const merged = j && typeof j.state === 'string' ? j.state : raw
        recRef.current = {
          ...recRef.current,
          [cid]: { ...rec, rev: j?.rev ?? rec.rev + 1, raw: merged, state: JSON.parse(merged) },
        }
        setRecords(recRef.current)
        return true
      } catch {
        return false
      }
    }
    return false
  }, [])

  return { records, online, write, refresh: poll }
}
