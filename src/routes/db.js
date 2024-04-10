// Package imports
import { Router } from 'express'
import debugLogger from 'debug'
import prismaClientPkg from '@prisma/client'

const debug = debugLogger('mco2-server-app:db')
const { PrismaClient } = prismaClientPkg

const router = Router()

// ------ Set up Prisma clients ------
// Connector for Node 1
const node1 = new PrismaClient({ datasources: { db: { url: process.env.NODE1_URL } } })
// Connector for Node 2
const node2 = new PrismaClient({ datasources: { db: { url: process.env.NODE2_URL } } })
// Connector for Node 3
const node3 = new PrismaClient({ datasources: { db: { url: process.env.NODE3_URL } } })
// Source: https://github.com/prisma/prisma/issues/2443#issuecomment-630679118

// Set up availability flags
let node1Available = true
let node2Available = true
let node3Available = true

// Check status of nodes
let defaultNode = null
const intervals = new Set()

await checkNodes()
intervals.add(setInterval(checkNodes, 5_000)) // every 5 seconds

// Constants
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
        node1: node1Available,
        node2: node2Available,
        node3: node3Available
    })
})

// Get appointment
router.get('/appointments', async function(req, res) {
    // If no nodes are available, return 503
    if (!node1Available && !node2Available && !node3Available) {
        res.status(503).send('Data is currently unavailable')
        return
    }

    const itemsPerPage = req.query.itemsPerPage ? parseInt(req.query.itemsPerPage) : 10
    const page = req.query.page ? parseInt(req.query.page) : 0
    const preferredNode = req.query.node ? parseInt(req.query.node) : null

    const node = getNode(preferredNode)

    try {
        // Collect from both Luzon and Vismin
        const appointments = await node.appointments.findMany({
            take: itemsPerPage,
            skip: page * itemsPerPage
        })

        res.status(200).send(appointments)
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get total size of appointments from both Luzon and Vismin
router.get('/appointments/size', async function(req, res) {
    // If no nodes are available, return 503
    if (!node1Available && !node2Available && !node3Available) {
        res.status(503).send('Data is currently unavailable')
        return
    }

    const preferredNode = req.query.node ? parseInt(req.query.node) : null
    const node = getNode(preferredNode)

    try {
        const size = await node.appointments.count()

        res.status(200).send({ size })
    } catch (e) {
        res.status(500).send(e)
    }
})

// Get an appointment
router.get('/appointments/:id', async function(req, res) {
    // If no nodes are available, return 503
    if (!node1Available && !node2Available && !node3Available) {
        res.status(503).send('Data is currently unavailable')
        return
    }

    const preferredNode = req.query.node ? parseInt(req.query.node) : null
    const node = getNode(preferredNode)

    try {
        const appointment = await node.appointments.findUnique({
            where: {
                apptid: req.params.id
            }
        })

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
router.put('/appointments', async function(req, res) {
    // If no nodes are available, return 503
    if (!node1Available && !node2Available && !node3Available) {
        res.status(503).send('Data updates are currently unavailable')
        return
    }

    const preferredNode = req.body.node ? parseInt(req.body.node) : null
    const node = getNode(preferredNode)

    try {
        const apptid = generateRandomID()

        const { data } = req.body
        data.apptid = apptid

        node.appointments.create({ data })

        res.status(201).send({ apptid })
    } catch (e) {
        res.status(500).send(e)
    }
})

// Update an appointment
router.patch('/appointments/:id', async function(req, res) {
    // If no nodes are available, return 503
    if (!node1Available && !node2Available && !node3Available) {
        res.status(503).send('Data updates are currently unavailable')
        return
    }

    const preferredNode = req.body.node ? parseInt(req.body.node) : null
    const node = getNode(preferredNode)

    try {
        const { data } = req.body

        // Check if appointment exists
        const appointment = await node.appointments.findUnique({
            where: {
                apptid: req.params.id
            }
        })

        if (!appointment) {
            res.status(404).send('Appointment not found')
            return
        }

        // Update the appointment
        await node.appointments.update({
            where: { apptid: req.params.id },
            data
        })

        res.status(200).send('Appointment updated')
    } catch (e) {
        res.status(500).send(e)
    }
})

// Delete an appointment
router.delete('/appointments/:id', async function(req, res) {
    // If no nodes are available, return 503
    if (!node1Available && !node2Available && !node3Available) {
        res.status(503).send('Data updates are currently unavailable')
        return
    }

    const preferredNode = req.body.node ? parseInt(req.body.node) : null
    const node = getNode(preferredNode)

    try {
        await node.appointments.delete({
            where: {
                apptid: req.params.id
            }
        })

        res.status(200).send('Appointment deleted')
    } catch (e) {
        res.status(500).send(e)
    }
})

export default router

async function checkNodes() {
    const availableNodes = []

    // Check Node 1
    try {
        await node1.$queryRaw`SELECT 1`
        node1Available = true
        availableNodes.push(node1)
    } catch (e) {
        debug('Node 1 down')
        debug(e)
        node1Available = false
    }

    // Check Node 2
    try {
        await node2.$queryRaw`SELECT 1`
        node2Available = true
        availableNodes.push(node2)
    } catch (e) {
        debug('Node 2 down')
        debug(e)
        node2Available = false
    }

    // Check Node 3
    try {
        await node3.$queryRaw`SELECT 1`
        node3Available = true
        availableNodes.push(node3)
    } catch (e) {
        debug('Node 3 down')
        debug(e)
        node3Available = false
    }

    // Set default node randomly
    defaultNode = availableNodes[Math.floor(Math.random() * availableNodes.length)]
}

function getNode(preferredNode) {
    let node = defaultNode
    if (preferredNode === 1 && node1Available) node = node1
    else if (preferredNode === 2 && node2Available) node = node2
    else if (preferredNode === 3 && node3Available) node = node3

    return node
}
