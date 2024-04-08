// Package imports
import { Router } from 'express'
import prismaClientPkg from '@prisma/client'

const { PrismaClient, Prisma: { Sql } } = prismaClientPkg

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
let luzonNode = readLuzon
let visminNode = readVismin

const roundRobin = setInterval(async () => {
    // Check Master
    try {
        await master.$queryRaw(Sql`SELECT 1`)
        // Stay on Master
        masterAvailable = true
    } catch (e) {
        console.error('Master is down')
        masterAvailable = false
        // Revert to Luzon and Vismin replicas
        luzonNode = readLuzon
        visminNode = readVismin
    }

    // Check Luzon, fallback to Master
    try {
        await luzonNode.$queryRaw(Sql`SELECT 1`)
        // Stay/switch to Luzon
        luzonNode = readLuzon
    } catch (e) {
        console.error('Luzon is down, falling back to master')
        luzonNode = master
    }

    // Check Vismin, fallback to Master
    try {
        await visminNode.$queryRaw(Sql`SELECT 1`)
        // Stay/switch to Vismin
        visminNode = readVismin
    } catch (e) {
        console.error('Vismin is down, falling back to master')
        visminNode = master
    }
}, 10_000) // every 10 seconds

router.get('/', function(req, res, next) {
    res.send('Hello there!')
})

// TODO: Add routes for CRUD operations

export default router
