import express from 'express'
import cookieParser from 'cookie-parser'
import logger from 'morgan'

import dbRouter from './routes/db.js'

const app = express()

app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(express.static('public'))

app.use('/', dbRouter)

export default app
