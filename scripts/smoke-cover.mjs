// End-to-end smoke test for cover upload/list/static/delete
import fs from 'fs'
import path from 'path'

const STORY_ID = 'bb06a76f-9bcd-467b-8d87-2a8a165093dc'
const BASE = 'http://localhost:3000'
const FIXTURE = 'C:/Users/HONOR/AppData/Local/Temp/test-cover.jpg'

async function main() {
  const buf = fs.readFileSync(FIXTURE)
  const boundary = '----CoverTest' + Date.now()
  const head = (s) => Buffer.from(s, 'utf-8')

  const parts = []
  parts.push(head(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n来自一千年前的老婆\r\n`))
  parts.push(head(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nsmoke test\r\n`))
  parts.push(head(`--${boundary}\r\nContent-Disposition: form-data; name="cover"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`))
  parts.push(buf)
  parts.push(head(`\r\n--${boundary}--\r\n`))
  const body = Buffer.concat(parts)

  // 1. PUT cover
  console.log('--- PUT /api/stories/:id (multipart) ---')
  const putRes = await fetch(`${BASE}/api/stories/${STORY_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body
  })
  const putJson = await putRes.json()
  console.log('status:', putRes.status, 'success:', putJson.success, 'coverUrl:', putJson.data?.coverUrl)

  if (!putJson.success) process.exit(1)

  // 2. GET to verify
  console.log('\n--- GET /api/stories/:id ---')
  const getRes = await fetch(`${BASE}/api/stories/${STORY_ID}`)
  const getJson = await getRes.json()
  const url = getJson.data.coverUrl
  console.log('coverUrl from list:', url)

  // 3. Static fetch
  console.log('\n--- GET /uploads/... ---')
  const imgRes = await fetch(`${BASE}${url}`)
  console.log('static status:', imgRes.status, 'content-type:', imgRes.headers.get('content-type'), 'bytes:', imgRes.headers.get('content-length'))

  // 4. removeCover via PUT (no new file)
  console.log('\n--- PUT removeCover=true ---')
  const remBoundary = '----CoverTest' + Date.now()
  const remParts = [
    head(`--${remBoundary}\r\nContent-Disposition: form-data; name="title"\r\n\rn来自一千年前的老婆\r\n`),
    head(`--${remBoundary}\r\nContent-Disposition: form-data; name="removeCover"\r\n\r\ntrue\r\n`),
    head(`--${remBoundary}--\r\n`)
  ]
  const remRes = await fetch(`${BASE}/api/stories/${STORY_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': `multipart/form-data; boundary=${remBoundary}` },
    body: Buffer.concat(remParts)
  })
  const remJson = await remRes.json()
  console.log('removeCover success:', remJson.success, 'new coverUrl:', remJson.data?.coverUrl)

  // 5. Verify cover is gone
  const finalRes = await fetch(`${BASE}/api/stories/${STORY_ID}`)
  const finalJson = await finalRes.json()
  console.log('final coverUrl:', finalJson.data.coverUrl)
}

main().catch(e => { console.error(e); process.exit(1) })
