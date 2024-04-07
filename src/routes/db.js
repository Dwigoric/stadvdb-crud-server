// Package imports
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'

const router = Router()

// ------ Set up Prisma clients ------
// Connector for the master node (write operations)
const master = new PrismaClient({ datasources: { db: { url: process.env.MASTER_URL } } })
// Connector for Luzon load balancer
const readLuzon = new PrismaClient({ datasources: { db: { url: process.env.LUZON_URL } } })
// Connector for Vismin load balancer
const readVismin = new PrismaClient({ datasources: { db: { url: process.env.VISMIN_URL } } })
// Source: https://github.com/prisma/prisma/issues/2443#issuecomment-630679118

router.get('/', function(req, res, next) {
    res.send('Hello there!')
})

// TODO: Add routes for CRUD operations

export default router
