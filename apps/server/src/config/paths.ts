import { join } from 'path'
import { fileURLToPath } from 'url'

const here = fileURLToPath(new URL('.', import.meta.url))
export const UPLOADS_ROOT = join(here, '..', '..', 'uploads')