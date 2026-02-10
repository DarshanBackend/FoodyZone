import axios from "axios";
import { config } from 'dotenv';
config();

const GST_API_HOST = "india-gstin-validator.p.rapidapi.com";
const GST_API_KEY = process.env.RAPIDAPI_KEY || "f3db12d99dmsh0a5a293a042f20cp10c76djsnd707e270b5f0";

export default async function validateGSTIN(gstin) {
  try {
    const response = await axios.get(
      `https://${GST_API_HOST}/validate?gstin=${String(gstin).toUpperCase()}`,
      {
        headers: {
          "x-rapidapi-key": GST_API_KEY,
          "x-rapidapi-host": GST_API_HOST,
        },
      }
    );

    return {
      valid: response.data.valid,
      gstin: response.data.gstin,
      state: response.data.state,
      pan: response.data.pan,
    };
  } catch (error) {
    console.error("GST API ERROR:", error.response?.data || error.message || error);

    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      "Unknown GST API error";

    throw new Error(message);
  }
}