import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import connectDb from './db/connectDb.js';
import errorHandler from './middleware/error.handler.js';
import indexRoutes from './routes/index.routes.js';
import log from 'morgan'

const PORT = process.env.PORT || 9000;
const DB_URL = process.env.DB_URL;

const app = express();
app.use(express.json());
app.use(cors())
app.use(log("dev"))
connectDb(DB_URL);


app.get("/", async (req, res) => {
  res.status(200).send("<h1>electro-ecommerce API working!</h1>")
})

app.use("/api", indexRoutes)
app.use(errorHandler)

app.listen(PORT, () => {
  console.info(`"Server Is Ruunning on PORT : "${PORT}`)
})