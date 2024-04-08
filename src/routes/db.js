// Package imports
import { Router } from 'express'
import debugLogger from 'debug'
import prismaClientPkg from '@prisma/client'

const debug = debugLogger('mco2-server-app:db')
const { PrismaClient } = prismaClientPkg

const router = Router()

// ------ Set up Prisma clients ------
// Connector for the master node (write operations)
const master = new PrismaClient({ datasources: { db: { url: process.env.MASTER_URL } } })
// Connector for Luzon
const readLuzon = new PrismaClient({ datasources: { db: { url: process.env.LUZON_URL } } })
// Connector for Vismin
const readVismin = new PrismaClient({ datasources: { db: { url: process.env.VISMIN_URL } } })
// Source: https://github.com/prisma/prisma/issues/2443#issuecomment-630679118

let masterAvailable = true
let luzonAvailable = true
let visminAvailable = true

await checkNodes()
const roundRobin = setInterval(checkNodes, 10_000) // every 10 seconds

router.get('/', function(req, res) {
    res.send('Hello there!')
})

export default router

async function checkNodes() {
    // Check Master
    try {
        await master.$queryRaw`SELECT 1`
        // Stay on Master
        masterAvailable = true
    } catch (e) {
        debug('Master is down')
        debug(e)

        masterAvailable = false
        // Revert to Luzon and Vismin replicas
        luzonAvailable = true
        visminAvailable = true
    }

    // Check Luzon, fallback to Master
    try {
        await readLuzon.$queryRaw`SELECT 1`
        // Stay/switch to Luzon
        luzonAvailable = true
    } catch (e) {
        debug('Luzon is down')
        debug(e)
        luzonAvailable = false
    }

    // Check Vismin, fallback to Master
    try {
        await readVismin.$queryRaw`SELECT 1`
        // Stay/switch to Vismin
        visminAvailable = true
    } catch (e) {
        debug('Vismin is down')
        debug(e)
        visminAvailable = false
    }
}
