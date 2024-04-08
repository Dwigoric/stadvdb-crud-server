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

// Set up availability flags
let masterAvailable = true
let luzonAvailable = true
let visminAvailable = true

// Check status of nodes
await checkNodes()
const roundRobin = setInterval(checkNodes, 10_000) // every 10 seconds

// Constants
const regionsInLuzon = [
    'National Capital Region (NCR)',
    'CALABARZON (IV-A)',
    'Ilocos Region (I)',
    'Cagayan Valley (II)',
    'Central Luzon (III)',
    'MIMAROPA (IV-B)',
    'Bicol Region (V)',
    'Cordillera Administrative Region (CAR)'
]

// Check status
router.get('/status', function(req, res) {
    res.status(200).send({
        master: masterAvailable,
        luzon: luzonAvailable,
        vismin: visminAvailable
    })
})

// Get all appointments
router.get('/appointments/:offset?', async function(req, res) {
    try {
        // Collect from both Luzon and Vismin
        const appointments = await Promise.all([
            readLuzon.appointments_luzon.findMany({
                take: 500,
                skip: req.params.offset ? parseInt(req.params.offset) : 0
            }),
            readVismin.appointments_vismin.findMany({
                take: 500,
                skip: req.params.offset ? parseInt(req.params.offset) : 0
            })
        ])

        res.status(200).send(appointments)
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get an appointment
router.get('/appointment/:id', async function(req, res) {
    try {
        // Find it in Vismin first
        let appointment = await readVismin.appointments_vismin.findUnique({
            where: {
                id: req.params.id
            }
        })

        if (!appointment) {
            // Find it in Luzon
            appointment = await readLuzon.appointments_luzon.findUnique({
                where: {
                    id: req.params.id
                }
            })
        }

        if (!appointment) {
            res.status(404).send('Appointment not found')
            return
        }

        res.status(200).send(appointment)
    } catch (e) {
        res.status(500).send(e)
    }
})

// Create a new appointment
router.put('/appointment', async function(req, res) {
    try {
        // If master is not available, return 503
        if (!masterAvailable) {
            res.status(503).send('Data updates are currently unavailable')
            return
        }

        const {
            pxid,
            clinicid,
            doctorid,
            status,
            TimeQueued,
            QueueDate,
            StartTime,
            EndTime,
            type,
            isVirtual,
            City,
            Province,
            RegionName
        } = req.body

        const table = regionsInLuzon.includes(RegionName) ? 'appointments_luzon' : 'appointments_vismin'

        master[table].create({
            data: {
                pxid,
                clinicid,
                doctorid,
                status,
                TimeQueued,
                QueueDate,
                StartTime,
                EndTime,
                type,
                isVirtual,
                City,
                Province,
                RegionName
            }
        })

        res.status(201).send('Appointment created')
    } catch (e) {
        res.status(500).send(e)
    }
})

// Update an appointment
router.patch('/appointment/:id', async function(req, res) {
    try {
        // If master is not available, return 503
        if (!masterAvailable) {
            res.status(503).send('Data updates are currently unavailable')
            return
        }

        const {
            pxid,
            clinicid,
            doctorid,
            status,
            TimeQueued,
            QueueDate,
            StartTime,
            EndTime,
            type,
            isVirtual,
            City,
            Province,
            RegionName
        } = req.body

        const table = regionsInLuzon.includes(RegionName) ? 'appointments_luzon' : 'appointments_vismin'

        master[table].update({
            where: {
                id: req.params.id
            },
            data: {
                pxid,
                clinicid,
                doctorid,
                status,
                TimeQueued,
                QueueDate,
                StartTime,
                EndTime,
                type,
                isVirtual,
                City,
                Province,
                RegionName
            }
        })

        res.status(200).send('Appointment updated')
    } catch (e) {
        res.status(500).send(e)
    }
})

// Delete an appointment
router.delete('/appointment/:id', async function(req, res) {
    try {
        // If master is not available, return 503
        if (!masterAvailable) {
            res.status(503).send('Data updates are currently unavailable')
            return
        }

        const appointment = await master.appointments_luzon.delete({
            where: {
                id: req.params.id
            }
        })

        if (!appointment) {
            await master.appointments_vismin.delete({
                where: {
                    id: req.params.id
                }
            })
        }

        res.status(200).send('Appointment deleted')
    } catch (e) {
        res.status(500).send(e)
    }
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
