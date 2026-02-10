import mongoose from "mongoose";
import 'dotenv/config'

const connectDb = async (DB_URL) => {
  try {
    const conn = await mongoose.connect(DB_URL)
    console.log("database connected successfully : " + conn.connection.host);
  } catch (error) {
    console.log("Error while Database Connect");
  }
}

export default connectDb;