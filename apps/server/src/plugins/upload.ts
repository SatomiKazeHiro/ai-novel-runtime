import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'

export const uploadPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024,
      files: 1
    },
    attachFieldsToBody: false
  })
})