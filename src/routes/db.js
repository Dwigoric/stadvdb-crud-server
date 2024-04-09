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
const intervals = new Set()

await checkNodes()
intervals.add(setInterval(checkNodes, 5_000)) // every 5 seconds

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

const generateRandomID = () => {
    let id = ''
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

    for (let i = 0; i < 32; i++) {
        id += characters.charAt(Math.floor(Math.random() * characters.length))
    }

    return id
}

// Check status
router.get('/status', function(req, res) {
    res.status(200).send({
        master: masterAvailable,
        luzon: luzonAvailable,
        vismin: visminAvailable
    })
})

// Get Luzon appointments
router.get('/appointments/luzon', async function(req, res) {
    const itemsPerPage = req.query.itemsPerPage ? parseInt(req.query.itemsPerPage) : 10
    const page = req.query.page ? parseInt(req.query.page) : 0

    try {
        const appointments = await readLuzon.appointments_luzon.findMany({
            take: itemsPerPage,
            skip: page * itemsPerPage
        })

        res.status(200).send(appointments)
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get total size of Luzon appointments
router.get('/appointments/luzon/size', async function(req, res) {
    try {
        const size = await readLuzon.appointments_luzon.count()

        res.status(200).send({ size })
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get Vismin appointments
router.get('/appointments/vismin', async function(req, res) {
    const itemsPerPage = req.query.itemsPerPage ? parseInt(req.query.itemsPerPage) : 10
    const page = req.query.page ? parseInt(req.query.page) : 0

    try {
        const appointments = await readVismin.appointments_vismin.findMany({
            take: itemsPerPage,
            skip: page * itemsPerPage
        })

        res.status(200).send(appointments)
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get total size of Vismin appointments
router.get('/appointments/vismin/size', async function(req, res) {
    try {
        const size = await readVismin.appointments_vismin.count()

        res.status(200).send({ size })
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get appointments from both Luzon and Vismin
router.get('/appointments', async function(req, res) {
    const itemsPerPage = req.query.itemsPerPage ? parseInt(req.query.itemsPerPage) : 10
    const page = req.query.page ? parseInt(req.query.page) : 0

    try {
        // Collect from both Luzon and Vismin
        let appointments = await Promise.all([
            readLuzon.appointments_luzon.findMany({
                take: itemsPerPage,
                skip: page * itemsPerPage
            }),
            readVismin.appointments_vismin.findMany({
                take: itemsPerPage,
                skip: page * itemsPerPage
            })
        ])

        // Merge the two arrays
        appointments = appointments[0].concat(appointments[1])

        // Sort appointments apptid
        appointments.sort((a, b) => a.apptid.localeCompare(b.apptid))

        // Only take the first itemsPerPage elements
        appointments = appointments.slice(0, itemsPerPage)

        res.status(200).send(appointments)
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get total size of appointments from both Luzon and Vismin
router.get('/appointments/size', async function(req, res) {
    try {
        // Collect from both Luzon and Vismin
        const sizes = await Promise.all([
            readLuzon.appointments_luzon.count(),
            readVismin.appointments_vismin.count()
        ])

        const size = sizes.reduce((acc, curr) => acc + curr, 0)

        res.status(200).send({ size })
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
                apptid: req.params.id
            }
        })

        if (!appointment) {
            // Find it in Luzon
            appointment = await readLuzon.appointments_luzon.findUnique({
                where: {
                    apptid: req.params.id
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
        const data = {
            apptid: generateRandomID(),
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

        const table = regionsInLuzon.includes(RegionName) ? 'appointments_luzon' : 'appointments_vismin'

        master[table].create({ data })

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
        const data = {
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

        // Check if appointment exists
        let appointment = await master.appointments_luzon.findUnique({
            where: {
                apptid: req.params.id
            }
        })

        if (!appointment) {
            appointment = await master.appointments_vismin.findUnique({
                where: {
                    apptid: req.params.id
                }
            })
        }

        if (!appointment) {
            res.status(404).send('Appointment not found')
            return
        }

        // Check if the RegionName has changed between Luzon and Vismin
        if (appointment.RegionName !== RegionName) {
            // If the new region is from the other region,
            // delete the entry from the old region and create a new one in the new region
            const oldTable = regionsInLuzon.includes(appointment.RegionName) ? 'appointments_luzon' : 'appointments_vismin'
            const newTable = regionsInLuzon.includes(RegionName) ? 'appointments_luzon' : 'appointments_vismin'

            if (oldTable === newTable) {
                // If the region is the same, just update the entry
                await master[oldTable].update({
                    where: { apptid: req.params.id },
                    data
                })
            } else {
                // Delete the old appointment
                await master[oldTable].delete({
                    where: { apptid: req.params.id }
                })

                // Create a new appointment
                await master[newTable].create({ data })
            }
        } else {
            // Update the appointment
            const table = regionsInLuzon.includes(RegionName) ? 'appointments_luzon' : 'appointments_vismin'

            await master[table].update({
                where: { apptid: req.params.id },
                data
            })
        }

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
                apptid: req.params.id
            }
        })

        if (!appointment) {
            await master.appointments_vismin.delete({
                where: {
                    apptid: req.params.id
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
