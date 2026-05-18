import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { FastifyInstance } from 'fastify'

const PROFILES_DIR = resolve(process.cwd(), '../../docs/profiles')

export async function initRuntimeProfile(app: FastifyInstance) {
  let files: string[]

  try {
    files = readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'))
  } catch (err: any) {
    app.log.warn(`Profiles directory not found: ${PROFILES_DIR}`)
    return
  }

  if (files.length === 0) {
    app.log.info('No profile JSON files found')
    return
  }

  for (const file of files) {
    const filePath = resolve(PROFILES_DIR, file)
    let profileData: any

    try {
      const raw = readFileSync(filePath, 'utf-8')
      profileData = JSON.parse(raw)
    } catch (err: any) {
      app.log.warn(`Failed to parse profile ${file}: ${err.message}`)
      continue
    }

    const name = profileData.name || file.replace('.json', '')

    // 检查是否已存在同名 Profile
    const existing = await app.prisma.runtimeProfile.findFirst({
      where: { name }
    })

    if (existing) {
      app.log.info(`Runtime Profile "${name}" already exists, skipping`)
      continue
    }

    await app.prisma.runtimeProfile.create({
      data: {
        name,
        identity: profileData.identity || '',
        settings: JSON.stringify(profileData.settings || {}),
        behavior: profileData.behavior || '',
        jailbreak: profileData.jailbreak || null,
        isDefault: profileData.isDefault ?? false
      }
    })

    app.log.info(`Runtime Profile "${name}" initialized from ${file}`)
  }
}
